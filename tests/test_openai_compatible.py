"""OpenAI 與 OpenAI 相容端點（OPENAI_BASE_URL）：結構化輸出、備援路徑、模型清單與平台名稱。"""
import os
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from openai import BadRequestError
from pydantic import BaseModel

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402


class Reply(BaseModel):
    title: str
    count: int


def bad_request():
    request = httpx.Request("POST", "https://ai-gateway.example.com/v1/chat/completions")
    return BadRequestError("response_format not supported", response=httpx.Response(400, request=request), body=None)


class FakeClient:
    """模擬 OpenAI SDK：parse 走結構化輸出，create 走提示詞附 schema 的備援。"""

    def __init__(self, parse_result=None, parse_error=None, create_text=""):
        self.calls = []

        def parse(**kwargs):
            self.calls.append(("parse", kwargs))
            if parse_error:
                raise parse_error
            return parse_result

        def create(**kwargs):
            self.calls.append(("create", kwargs))
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=create_text))])

        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)))
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))


def use_endpoint(monkeypatch, client, models=("corp-llm-a", "corp-llm-b"), base_url="https://ai-gateway.example.com/v1"):
    """模擬設定了 OPENAI_BASE_URL 的自訂端點。"""
    monkeypatch.setattr(app_module, "openai_client", client)
    monkeypatch.setattr(app_module, "OPENAI_BASE_URL", base_url)
    monkeypatch.setitem(app_module.MODEL_CATALOG, "openai", list(models))


def test_parse_model_list():
    assert app_module.parse_model_list(" a, b ,,a ,c ") == ["a", "b", "c"]
    assert app_module.parse_model_list(None) == []


def test_structured_output_used_when_supported(monkeypatch):
    parsed = SimpleNamespace(refusal=None, parsed=Reply(title="t", count=2), content="")
    client = FakeClient(parse_result=SimpleNamespace(choices=[SimpleNamespace(message=parsed)]))
    use_endpoint(monkeypatch, client)
    data = app_module.call_llm("openai", "", "sys", "prompt", Reply, 0.6)
    assert data == {"title": "t", "count": 2}
    assert [c[0] for c in client.calls] == ["parse"]
    assert client.calls[0][1]["model"] == "corp-llm-a"  # 未指定時使用清單第一個


def test_custom_endpoint_falls_back_to_prompted_json_when_schema_rejected(monkeypatch):
    client = FakeClient(parse_error=bad_request(),
                        create_text='好的：\n```json\n{"title": "簡報", "count": 3}\n```')
    use_endpoint(monkeypatch, client)
    data = app_module.call_llm("openai", "corp-llm-b", "sys", "prompt", Reply, 0.6)
    assert data == {"title": "簡報", "count": 3}
    kind, kwargs = client.calls[-1]
    assert kind == "create" and kwargs["model"] == "corp-llm-b"
    assert '"count"' in kwargs["messages"][0]["content"]  # schema 附在系統提示詞中


def test_official_openai_does_not_fall_back(monkeypatch):
    client = FakeClient(parse_error=bad_request())
    use_endpoint(monkeypatch, client, models=("gpt-6-luna",), base_url=None)
    with pytest.raises(BadRequestError):
        app_module.call_llm("openai", "gpt-6-luna", "sys", "prompt", Reply, 0.6)


def test_rejects_unlisted_model(monkeypatch):
    use_endpoint(monkeypatch, FakeClient())
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("openai", "secret-expensive-model", "sys", "prompt", Reply, 0.6)
    assert e.value.status_code == 400


def test_unconfigured_openai(monkeypatch):
    monkeypatch.setattr(app_module, "openai_client", None)
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("openai", "", "sys", "prompt", Reply, 0.6)
    assert "OPENAI_API_KEY" in e.value.detail


def test_databricks_provider_is_removed():
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("databricks", "", "sys", "prompt", Reply, 0.6)
    assert e.value.status_code == 400


def test_models_endpoint_shows_custom_endpoint_name(monkeypatch):
    from fastapi.testclient import TestClient
    use_endpoint(monkeypatch, FakeClient())
    monkeypatch.setattr(app_module, "OPENAI_DISPLAY_NAME", "公司 AI 閘道")
    data = TestClient(app_module.app).get("/api/models").json()
    assert data["openai"] == {"available": True, "models": ["corp-llm-a", "corp-llm-b"], "name": "公司 AI 閘道", "custom": True}
    assert "databricks" not in data
