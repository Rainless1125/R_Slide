"""複製頁面後改寫內容：標題、版型與講者備註仍是原頁的資料，送給 AI 時要以頁面上目前的內容為準，
否則 AI 會依舊標題與原始素材把使用者改好的文字改回原頁的內容。"""
import pytest
from fastapi.testclient import TestClient

import app as app_module

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

SOURCE = "原始素材：第三季營收成長 18%，海外市場貢獻主要成長。"
EDITED_HTML = "<div><h1>年度員工旅遊</h1><p>員工旅遊預計十月前往花蓮三天兩夜</p></div>"


def capture(monkeypatch, reply):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt)
        return dict(reply)

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


def regen_slide(monkeypatch, notes_stale):
    slide = {"page_number": 2, "layout_concept": "KPI 大數字", "slide_title": "年度員工旅遊", "html_content": EDITED_HTML,
             "charts": [], "speaker_notes": "這頁說明第三季營收成長 18%。", "notes_stale": notes_stale}
    captured = capture(monkeypatch, slide)
    res = client.post("/api/regenerate-slide", json={"content": SOURCE, "slide_index": 0, "slides": [slide]})
    assert res.status_code == 200
    return captured


def test_regenerate_slide_marks_stale_notes(monkeypatch):
    captured = regen_slide(monkeypatch, True)
    assert "備註可能已過時，僅供參考" in captured["prompt"]
    assert "原版型概念（可能已過時）" in captured["prompt"]
    assert "原標題、原版型概念與原講者備註可能是舊資料" in captured["system"]


def test_regenerate_slide_without_stale_notes(monkeypatch):
    captured = regen_slide(monkeypatch, False)
    assert "備註可能已過時" not in captured["prompt"]


def test_regenerate_slide_accepts_old_slides_without_flag(monkeypatch):
    slide = {"page_number": 1, "layout_concept": "x", "slide_title": "t", "html_content": "<div></div>"}
    capture(monkeypatch, {**slide, "charts": [], "speaker_notes": ""})
    assert client.post("/api/regenerate-slide", json={"content": SOURCE, "slide_index": 0, "slides": [slide]}).status_code == 200


def test_element_edit_prefers_current_content(monkeypatch):
    captured = capture(monkeypatch, {"html_content": "<p>新的</p>", "charts": []})
    res = client.post("/api/regenerate-element", json={
        "content": SOURCE, "slide_title": "年度員工旅遊", "slide_html": EDITED_HTML,
        "element_html": "<p>員工旅遊預計十月前往花蓮三天兩夜</p>", "element_width": 400, "element_height": 100})
    assert res.status_code == 200
    assert "【以頁面上目前的內容為準】" in captured["system"]
    prompt = captured["prompt"]
    # 原始素材移到元素與需求之後，並標示為背景參考
    assert prompt.index("員工旅遊預計十月前往花蓮三天兩夜") < prompt.index(SOURCE)
    assert "【原始素材內容】（產生簡報時的背景資料，僅供參考" in prompt
    assert "【此頁標題】（取自頁面上顯示的標題）：年度員工旅遊" in prompt


def test_multi_element_edit_prefers_current_content(monkeypatch):
    captured = capture(monkeypatch, {"elements": [{"html_content": "<p>a</p>"}, {"html_content": "<p>b</p>"}], "charts": []})
    res = client.post("/api/regenerate-elements", json={
        "content": SOURCE, "slide_title": "年度員工旅遊", "slide_html": EDITED_HTML,
        "elements": [{"html": "<h1>年度員工旅遊</h1>", "width": 400, "height": 80},
                     {"html": "<p>員工旅遊預計十月前往花蓮三天兩夜</p>", "width": 400, "height": 100}]})
    assert res.status_code == 200
    assert "【以頁面上目前的內容為準】" in captured["system"]
    assert captured["prompt"].index("員工旅遊預計十月前往花蓮三天兩夜") < captured["prompt"].index(SOURCE)
