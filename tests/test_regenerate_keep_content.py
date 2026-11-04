"""重產此頁：預設保留此頁目前的內容（含使用者手動修改），只換版面；keep_content=False 時才可依原始素材重寫內容。
兩種方式都以此頁目前的內容為準，不可改回原始素材的說法。"""
import pytest
from fastapi.testclient import TestClient

import app as app_module

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

EDITED_HTML = "<div><h1>營收成長 18%</h1><p>使用者手動改過的說明</p></div>"
SLIDE = {"page_number": 2, "layout_concept": "KPI", "slide_title": "營收成長 12%", "html_content": EDITED_HTML,
         "charts": [], "speaker_notes": ""}


def regenerate(monkeypatch, **extra):
    captured = {}

    def fake_llm(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt)
        return dict(SLIDE)

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    res = client.post("/api/regenerate-slide",
                      json={"content": "原始素材：營收成長 12%", "slide_index": 0, "slides": [SLIDE], **extra})
    assert res.status_code == 200
    return captured


def test_keeps_content_by_default(monkeypatch):
    captured = regenerate(monkeypatch)
    assert "【重產方式：保留內容，只換版面】" in captured["system"]
    assert "【重產方式：重寫此頁】" not in captured["system"]
    assert "只重新設計版面與視覺呈現" in captured["prompt"]
    assert "明顯不同" not in captured["prompt"]


def test_rewrite_when_keep_content_off(monkeypatch):
    captured = regenerate(monkeypatch, keep_content=False)
    assert "【重產方式：重寫此頁】" in captured["system"]
    assert "【重產方式：保留內容，只換版面】" not in captured["system"]
    assert "請重新設計這一頁的版面與內容" in captured["prompt"]


@pytest.mark.parametrize("keep", [True, False])
def test_current_content_takes_priority_over_source_material(monkeypatch, keep):
    captured = regenerate(monkeypatch, keep_content=keep)
    prompt = captured["prompt"]
    # 目前的內容（含手動修改）放在前面並標示為最新版本，原始素材放在後面、標示為僅供參考
    assert "【此頁目前的內容】（HTML，包含使用者手動修改，為最新版本）" in prompt
    assert prompt.index(EDITED_HTML) < prompt.index("原始素材：營收成長 12%")
    assert "以此頁目前的內容為準" in prompt
    assert "不可改回素材的說法" in captured["system"]


def test_custom_prompt_still_applies(monkeypatch):
    captured = regenerate(monkeypatch, custom_prompt="改成左右對照")
    assert "改成左右對照" in captured["prompt"]
    assert "（無，請保留此頁內容" not in captured["prompt"]
