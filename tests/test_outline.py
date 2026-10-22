"""先確認大綱：/api/outline 產生大綱，/api/generate 帶入使用者確認後的大綱時依大綱生成。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}
OUTLINE = {"presentation_title": "第三季報告", "slides": [
    {"slide_title": "封面", "key_points": ["第三季成果"], "layout_concept": "封面"},
    {"slide_title": "營收成長 18%", "key_points": ["新客戶擴張", "續約率 95%"], "layout_concept": "KPI 大數字"},
]}


def capture_llm(monkeypatch, result):
    captured = {}

    def fake_llm(provider, model, system_instruction, prompt, schema, temperature, usage=None):
        captured.update(system=system_instruction, prompt=prompt, schema=schema)
        return dict(result)

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    return captured


def test_outline_returns_cleaned_outline(monkeypatch):
    raw = {"presentation_title": "t", "slides": [
        {"slide_title": "a", "key_points": [" 重點 ", "", "  "] + [f"p{i}" for i in range(10)], "layout_concept": "x"}]}
    captured = capture_llm(monkeypatch, raw)
    res = client.post("/api/outline", json={"content": "素材", "num_pages": 4, "deck_mode": "document"})
    assert res.status_code == 200
    assert captured["schema"] is app_module.DeckOutline
    assert "必須剛好 4 頁" in captured["prompt"]
    assert "Document Deck" in captured["system"]
    points = res.json()["slides"][0]["key_points"]
    assert points[0] == "重點" and len(points) == app_module.MAX_OUTLINE_POINTS


def test_outline_is_logged_and_counts_toward_quota(monkeypatch):
    capture_llm(monkeypatch, OUTLINE)
    assert client.post("/api/outline", json={"content": "素材"}).status_code == 200
    with store.connect() as conn:
        row = conn.execute("SELECT action, status, slides_returned FROM llm_usage").fetchone()
    assert dict(row) == {"action": "outline", "status": "ok", "slides_returned": 2}
    assert store.llm_quota(1)["hour"]["used"] == 1


def test_outline_ignores_outline_field(monkeypatch):
    captured = capture_llm(monkeypatch, OUTLINE)
    res = client.post("/api/outline", json={"content": "素材", "outline": OUTLINE})
    assert res.status_code == 200
    assert "使用者確認的大綱" not in captured["prompt"]


def test_generate_follows_confirmed_outline(monkeypatch):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": [SLIDE, SLIDE]})
    res = client.post("/api/generate", json={"content": "素材", "num_pages": 6, "outline": OUTLINE})
    assert res.status_code == 200
    prompt = captured["prompt"]
    assert "使用者確認的大綱" in prompt and "必須剛好 2 頁" in prompt and "必須剛好 6 頁" not in prompt
    assert "第 2 頁｜營收成長 18%｜建議版型：KPI 大數字" in prompt and "- 續約率 95%" in prompt


def test_generate_without_outline_is_unchanged(monkeypatch):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": [SLIDE]})
    assert client.post("/api/generate", json={"content": "素材", "num_pages": 3}).status_code == 200
    assert "使用者確認的大綱" not in captured["prompt"] and "必須剛好 3 頁" in captured["prompt"]


@pytest.mark.parametrize("outline, message", [
    ({"presentation_title": "t", "slides": []}, "至少需要 1 頁"),
    ({"presentation_title": "t", "slides": [OUTLINE["slides"][0]] * 21}, "超過 20 頁"),
    ({"presentation_title": "t", "slides": [{**OUTLINE["slides"][0], "key_points": ["p"] * 9}]}, "重點超過"),
    ({"presentation_title": "t", "slides": [{**OUTLINE["slides"][0], "key_points": ["長" * 301]}]}, "重點過長"),
    ({"presentation_title": "t", "slides": [{**OUTLINE["slides"][0], "slide_title": "長" * 501}]}, "標題過長"),
    ({"presentation_title": "長" * 201, "slides": OUTLINE["slides"]}, "簡報標題過長"),
])
def test_generate_rejects_invalid_outline_without_calling_llm(monkeypatch, outline, message):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": [SLIDE]})
    res = client.post("/api/generate", json={"content": "素材", "outline": outline})
    assert res.status_code == 400 and message in res.json()["detail"]
    assert not captured
    with store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM llm_usage").fetchone()[0] == 0
