"""AI 轉換圖片：選取使用者上傳的圖片（例如表格截圖）交給 AI，附上圖片本身讓 AI 讀出內容，轉成表格、圖表或條列取代圖片。"""
import base64

import pytest
from fastapi.testclient import TestClient

import app as app_module

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
PNG_URL = "data:image/png;base64," + base64.b64encode(PNG).decode()
BODY = {
    "content": "素材",
    "slide_title": "各部門滿意度",
    "slide_html": '<div class="w-full h-full"><img data-rs-target="1" data-rs-img src="rs-img:0" class="w-1/2"></div>',
    "element_html": '<img data-rs-img src="rs-img:0" class="w-1/2">',
    "element_width": 480, "element_height": 270,
}


def capture(monkeypatch, reply=None, error=None):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None, **kwargs):
        captured.update(system=system_instruction, prompt=prompt, kwargs=kwargs)
        if error:
            raise error
        return dict(reply or {"html_content": "<table><tr><td>研發</td><td>4.1</td></tr></table>", "charts": []})

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


def test_image_is_sent_to_model_with_convert_rules(monkeypatch):
    captured = capture(monkeypatch)
    res = client.post("/api/regenerate-element", json={**BODY, "source_image": PNG_URL, "custom_prompt": "轉成表格"})
    assert res.status_code == 200
    assert res.json()["html_content"].startswith("<table>")
    assert captured["kwargs"]["images"] == [(PNG, "image/png")]
    assert "【辨識並轉換圖片（最優先）】" in captured["system"]
    assert "看不清楚的字以「?」標示" in captured["system"]
    assert "轉成表格" in captured["prompt"]


def test_default_need_for_image(monkeypatch):
    captured = capture(monkeypatch)
    assert client.post("/api/regenerate-element", json={**BODY, "source_image": PNG_URL}).status_code == 200
    assert "請依圖片內容轉成最適合的呈現" in captured["prompt"]


def test_without_image_keeps_original_behaviour(monkeypatch):
    captured = capture(monkeypatch)
    body = {**BODY, "element_html": "<p>文字</p>"}
    assert client.post("/api/regenerate-element", json=body).status_code == 200
    assert "images" not in captured["kwargs"]
    assert "辨識並轉換圖片" not in captured["system"]
    assert "請你自行優化這個元素" in captured["prompt"]


@pytest.mark.parametrize("value", ["data:text/html;base64,PGI+", "https://example.com/a.png", "data:image/png;base64,"])
def test_rejects_invalid_image(monkeypatch, value):
    capture(monkeypatch)
    assert client.post("/api/regenerate-element", json={**BODY, "source_image": value}).status_code == 400


def test_rejects_too_large_image(monkeypatch):
    capture(monkeypatch)
    monkeypatch.setattr(app_module, "MAX_SOURCE_IMAGE_BYTES", 10)
    assert client.post("/api/regenerate-element", json={**BODY, "source_image": PNG_URL}).status_code == 413


def test_model_without_vision_gives_clear_error(monkeypatch):
    capture(monkeypatch, error=RuntimeError("this model does not support image input"))
    res = client.post("/api/regenerate-element", json={**BODY, "source_image": PNG_URL})
    assert res.status_code == 502
    assert "可能不支援圖片輸入" in res.json()["detail"] and "does not support image" in res.json()["detail"]
