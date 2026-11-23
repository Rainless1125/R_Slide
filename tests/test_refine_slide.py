"""AI 精修此頁：附上畫面截圖與程式量測到的問題，請 AI 找出版面問題並只修正版面；沒有問題時不修改。"""
import base64

import pytest
from fastapi.testclient import TestClient

import app as app_module

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
BODY = {
    "slide_html": '<div class="w-full h-full p-10"><h1>營收成長 18%</h1></div>',
    "image": "data:image/png;base64," + base64.b64encode(PNG).decode(),
    "hints": ["「營收」區塊的內容超出區塊下緣", "  "],
    "slide_title": "營收", "deck_mode": "dense", "theme": None,
}


def capture(monkeypatch, reply=None, error=None):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None, **kwargs):
        captured.update(system=system_instruction, prompt=prompt, schema=schema, kwargs=kwargs)
        if error:
            raise error
        return dict(reply)

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


def test_sends_screenshot_hints_and_rules(monkeypatch):
    captured = capture(monkeypatch, {"issues": ["標題太小"], "needs_fix": True, "html_content": "<div>修正後</div>"})
    res = client.post("/api/refine-slide", json=BODY)
    assert res.status_code == 200
    assert res.json() == {"issues": ["標題太小"], "needs_fix": True, "html_content": "<div>修正後</div>"}
    assert captured["schema"] is app_module.SlideRefinement
    assert captured["kwargs"]["images"] == [(PNG, "image/png")]
    assert "【AI 精修：依畫面截圖檢查並修正版面" in captured["system"]
    assert "不可新增、刪除或改寫任何文字、數字與項目" in captured["system"]
    assert "密集資訊模式" in captured["system"]
    assert "- 「營收」區塊的內容超出區塊下緣" in captured["prompt"]
    assert "<h1>營收成長 18%</h1>" in captured["prompt"]


def test_no_fix_needed(monkeypatch):
    capture(monkeypatch, {"issues": [], "needs_fix": False, "html_content": "<div>不該使用</div>"})
    res = client.post("/api/refine-slide", json=BODY)
    assert res.json() == {"issues": [], "needs_fix": False, "html_content": ""}


def test_fix_without_html_is_an_error(monkeypatch):
    capture(monkeypatch, {"issues": ["x"], "needs_fix": True, "html_content": "  "})
    assert client.post("/api/refine-slide", json=BODY).status_code == 502


def test_model_without_vision_gives_clear_error(monkeypatch):
    capture(monkeypatch, error=RuntimeError("image input is not supported"))
    res = client.post("/api/refine-slide", json=BODY)
    assert res.status_code == 502 and "不支援圖片輸入" in res.json()["detail"]


def test_rejects_bad_input(monkeypatch):
    capture(monkeypatch, {"issues": [], "needs_fix": False, "html_content": ""})
    assert client.post("/api/refine-slide", json={**BODY, "image": "https://example.com/a.png"}).status_code == 400
    assert client.post("/api/refine-slide", json={**BODY, "slide_html": "  "}).status_code == 400
    assert client.post("/api/refine-slide", json={**BODY, "hints": ["x"] * 21}).status_code == 422
    assert client.post("/api/refine-slide", json={k: v for k, v in BODY.items() if k != "image"}).status_code == 422
