"""思考長度（畫面上的「中等」「更高」）：thinking = medium / high 傳給 LLM，並記在使用紀錄。"""
import os
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from google.genai import types
from openai import BadRequestError
from pydantic import BaseModel

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}


class Reply(BaseModel):
    title: str


def capture(monkeypatch):
    calls = []

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        calls.append(thinking)
        usage.update(provider=provider, model=model or "m")
        if schema is app_module.DeckOutline:
            return {"presentation_title": "t", "slides": [{"slide_title": "a", "key_points": ["b"], "layout_concept": "c"}]}
        if schema is app_module.AdaptiveSlide:
            return dict(SLIDE)
        return {"presentation_title": "t", "slides": [SLIDE]}

    monkeypatch.setattr(app_module, "call_llm", fake)
    return calls


def new_client():
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": "alice", "password": "secret123"}).status_code == 200
    return c


def test_thinking_passed_to_every_llm_endpoint(monkeypatch):
    calls = capture(monkeypatch)
    c = new_client()
    assert c.post("/api/generate", json={"content": "素材"}).status_code == 200                       # 預設中等
    assert c.post("/api/generate", json={"content": "素材", "thinking": "high"}).status_code == 200
    assert c.post("/api/outline", json={"content": "素材", "thinking": "high"}).status_code == 200
    assert c.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE],
                                                 "thinking": "high"}).status_code == 200
    assert calls == ["medium", "high", "high", "high"]
    with store.connect() as conn:
        assert [r[0] for r in conn.execute("SELECT thinking FROM llm_usage ORDER BY id")] == ["medium", "high", "high", "high"]


@pytest.mark.parametrize("value", ["low", "xhigh", "", "HIGH"])
def test_rejects_unknown_thinking(monkeypatch, value):
    calls = capture(monkeypatch)
    res = new_client().post("/api/generate", json={"content": "素材", "thinking": value})
    assert res.status_code == 422 and calls == []


def test_gemini_thinking_level(monkeypatch):
    configs = []

    def generate_content(model, contents, config):
        configs.append(config.thinking_config)
        return SimpleNamespace(text='{"title": "ok"}', prompt_feedback=None, candidates=[], usage_metadata=None)

    monkeypatch.setattr(app_module, "gemini_client", SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    for thinking in ("medium", "high", None):
        assert app_module.call_llm("gemini", "", "sys", "p", Reply, 0.5, thinking=thinking) == {"title": "ok"}
    assert [c.thinking_level for c in configs] == [types.ThinkingLevel.MEDIUM, types.ThinkingLevel.HIGH, None]
    assert configs[2].thinking_budget == 0     # 沒有指定（例如辨識圖片）時維持不思考


def bad_request(message):
    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    return BadRequestError(message, response=httpx.Response(400, request=request), body=None)


def openai_client(monkeypatch, parse):
    client = SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse))))
    monkeypatch.setattr(app_module, "openai_client", client)
    monkeypatch.setattr(app_module, "OPENAI_BASE_URL", None)


def parsed_reply():
    msg = SimpleNamespace(refusal=None, parsed=Reply(title="ok"), content="")
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=None)


def test_openai_reasoning_effort(monkeypatch):
    seen = []

    def parse(**kw):
        seen.append(kw.get("reasoning_effort"))
        return parsed_reply()

    openai_client(monkeypatch, parse)
    assert app_module.call_llm("openai", "", "sys", "p", Reply, 0.5, thinking="high") == {"title": "ok"}
    assert app_module.call_llm("openai", "", "sys", "p", Reply, 0.5) == {"title": "ok"}
    assert seen == ["high", None]


def test_openai_model_without_reasoning_retries_without_effort(monkeypatch):
    seen = []

    def parse(**kw):
        seen.append(kw.get("reasoning_effort"))
        if "reasoning_effort" in kw:
            raise bad_request("Unsupported parameter: 'reasoning_effort' is not supported with this model.")
        return parsed_reply()

    openai_client(monkeypatch, parse)
    assert app_module.call_llm("openai", "", "sys", "p", Reply, 0.5, thinking="medium") == {"title": "ok"}
    assert seen == ["medium", None]


def test_openai_other_bad_request_not_retried(monkeypatch):
    seen = []

    def parse(**kw):
        seen.append(kw.get("reasoning_effort"))
        raise bad_request("context length exceeded")

    openai_client(monkeypatch, parse)
    with pytest.raises(BadRequestError):
        app_module.call_llm("openai", "", "sys", "p", Reply, 0.5, thinking="medium")
    assert seen == ["medium"]
