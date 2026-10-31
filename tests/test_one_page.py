"""一頁式簡報報告：頁數為 1 時，提示詞加入一頁式報告的規則（不做成封面），其他頁數不加。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}
MARK = "【一頁式簡報報告"


def capture(monkeypatch):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt)
        if schema is app_module.DeckOutline:
            return {"presentation_title": "t", "slides": [{"slide_title": "a", "key_points": ["b"], "layout_concept": "c"}]}
        if schema is app_module.AdaptiveSlide:
            return dict(SLIDE)
        return {"presentation_title": "t", "slides": [SLIDE]}

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


@pytest.mark.parametrize("pages, expected", [(1, True), (0, False), (2, False), (6, False)])
def test_generate_one_page_rules(monkeypatch, pages, expected):
    captured = capture(monkeypatch)
    assert client.post("/api/generate", json={"content": "素材", "num_pages": pages}).status_code == 200
    assert (MARK in captured["system"]) is expected
    if expected:
        assert "必須剛好 1 頁" in captured["prompt"]


def test_generate_from_one_page_outline(monkeypatch):
    captured = capture(monkeypatch)
    outline = {"presentation_title": "t", "slides": [{"slide_title": "摘要", "key_points": ["a"], "layout_concept": "一頁式報告"}]}
    assert client.post("/api/generate", json={"content": "素材", "num_pages": 5, "outline": outline}).status_code == 200
    assert MARK in captured["system"]


@pytest.mark.parametrize("pages, expected", [(1, True), (3, False)])
def test_outline_one_page_rules(monkeypatch, pages, expected):
    captured = capture(monkeypatch)
    assert client.post("/api/outline", json={"content": "素材", "num_pages": pages}).status_code == 200
    assert ("【一頁式簡報報告】" in captured["system"]) is expected


@pytest.mark.parametrize("slides, expected", [(1, True), (2, False)])
def test_regenerate_single_page_report(monkeypatch, slides, expected):
    captured = capture(monkeypatch)
    res = client.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE] * slides})
    assert res.status_code == 200
    assert (MARK in captured["system"]) is expected
