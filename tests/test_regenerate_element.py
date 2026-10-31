"""AI 修改單一元素：/api/regenerate-element 只送出並回傳選取的元素，頁面其他部分由前端保留。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402

CHART = {"type": "bar", "title": "滿意度", "unit": "分", "labels": ["研發", "業務"],
         "datasets": [{"label": "分數", "values": [4.1, 3.6]}], "colors": [], "ref_lines": [], "highlight": []}
BODY = {
    "content": "研發部 4.1 分、業務部 3.6 分",
    "slide_title": "各部門滿意度",
    "slide_html": '<div class="w-full h-full"><div data-rs-target="1" class="col-span-2">研發部 4.1</div><div>其他</div></div>',
    "element_html": '<div class="col-span-2">研發部 4.1</div>',
    "element_width": 420, "element_height": 180,
    "charts": [CHART],
    "custom_prompt": "改成長條圖",
}


def capture(monkeypatch, reply=None):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt, schema=schema, thinking=thinking)
        usage.update(provider=provider, model=model or "m")
        return dict(reply if reply is not None else {"html_content": '<div class="col-span-2"><div data-rs-chart="0"></div></div>',
                                                     "charts": [CHART]})

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


def new_client():
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": "alice", "password": "secret123"}).status_code == 200
    return c


def test_requires_login(monkeypatch):
    capture(monkeypatch)
    assert TestClient(app_module.app).post("/api/regenerate-element", json=BODY).status_code == 401


def test_prompt_contains_element_context_and_size(monkeypatch):
    captured = capture(monkeypatch)
    res = new_client().post("/api/regenerate-element", json={**BODY, "thinking": "high"})
    assert res.status_code == 200
    data = res.json()
    assert data["html_content"].startswith('<div class="col-span-2">')
    assert data["charts"][0]["labels"] == ["研發", "業務"]
    assert data["charts"][0]["datasets"][0]["values"] == [4.1, 3.6]
    assert captured["schema"] is app_module.ElementRewrite and captured["thinking"] == "high"
    assert "【只修改單一元素" in captured["system"] and "420 × 180 px" in captured["system"]
    assert "{width}" not in captured["system"]
    for text in ("data-rs-target", '<div class="col-span-2">研發部 4.1</div>', "改成長條圖", "各部門滿意度", "滿意度"):
        assert text in captured["prompt"]


def test_blank_prompt_lets_ai_optimize(monkeypatch):
    captured = capture(monkeypatch)
    assert new_client().post("/api/regenerate-element", json={**BODY, "custom_prompt": ""}).status_code == 200
    assert "請你自行優化這個元素" in captured["prompt"]


def test_counts_as_regenerate_usage(monkeypatch):
    capture(monkeypatch)
    new_client().post("/api/regenerate-element", json=BODY)
    with store.connect() as conn:
        assert [r[0] for r in conn.execute("SELECT action FROM llm_usage")] == ["element"]
    assert store.usage_by_user(0)[0]["regenerates"] == 1


def test_empty_reply_is_error(monkeypatch):
    capture(monkeypatch, {"html_content": "  ", "charts": []})
    res = new_client().post("/api/regenerate-element", json=BODY)
    assert res.status_code == 502 and "沒有回傳" in res.json()["detail"]


@pytest.mark.parametrize("patch, message", [
    ({"element_html": " "}, "缺少要修改的元素"),
    ({"element_html": "x" * (app_module.MAX_SLIDE_HTML_CHARS + 1)}, "此元素內容過多"),
    ({"slide_html": "x" * (app_module.MAX_SLIDE_HTML_CHARS + 1)}, "此頁內容過多"),
    ({"custom_prompt": "x" * (app_module.MAX_CUSTOM_PROMPT_CHARS + 1)}, "重產提示詞過長"),
    ({"charts": [{"labels": ["x" * app_module.MAX_SLIDE_CHARTS_CHARS]}]}, "圖表資料過多"),
])
def test_rejects_oversized_input_without_calling_llm(monkeypatch, patch, message):
    captured = capture(monkeypatch)
    res = new_client().post("/api/regenerate-element", json={**BODY, **patch})
    assert res.status_code == 400 and message in res.json()["detail"]
    assert captured == {}


def test_element_schema_has_no_defaults():
    # Gemini 的 response_schema 不支援預設值
    for field in app_module.ElementRewrite.model_fields.values():
        assert field.is_required()
