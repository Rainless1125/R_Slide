"""簡報模式（演講型 / 閱讀型）：規則會依 deck_mode 送進 LLM 指令，未帶欄位時預設為演講型。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>"}


def capture_llm(monkeypatch, result):
    captured = {}

    def fake_llm(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt)
        return dict(result)

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    return captured


def generate(monkeypatch, **body):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": [{**SLIDE, "charts": [], "speaker_notes": "x"}]})
    res = client.post("/api/generate", json={"content": "素材", **body})
    return res, captured


def test_generate_defaults_to_speaker_mode(monkeypatch):
    res, captured = generate(monkeypatch)
    assert res.status_code == 200
    assert "Speaker Deck" in captured["system"] and "Document Deck" not in captured["system"]
    assert app_module.DECK_MODE_LABELS["speaker"] in captured["prompt"]


def test_generate_document_mode_uses_document_rules(monkeypatch):
    res, captured = generate(monkeypatch, deck_mode="document")
    assert res.status_code == 200
    assert "Document Deck" in captured["system"] and "Speaker Deck" not in captured["system"]
    assert app_module.DECK_MODE_LABELS["document"] in captured["prompt"]


def test_generate_rejects_unknown_mode(monkeypatch):
    res, _ = generate(monkeypatch, deck_mode="poster")
    assert res.status_code == 422


def test_regenerate_follows_deck_mode(monkeypatch):
    captured = capture_llm(monkeypatch, {**SLIDE, "charts": [], "speaker_notes": "x"})
    res = client.post("/api/regenerate-slide",
                      json={"content": "素材", "slide_index": 0, "slides": [SLIDE], "deck_mode": "document"})
    assert res.status_code == 200
    assert "Document Deck" in captured["system"]
    assert app_module.DECK_MODE_LABELS["document"] in captured["prompt"]


def test_fixed_page_count_forbids_extra_pages(monkeypatch):
    res, captured = generate(monkeypatch, deck_mode="document", num_pages=4)
    assert res.status_code == 200
    assert "必須剛好 4 頁" in captured["prompt"] and "不可增加頁數" in captured["prompt"]


def test_ai_decided_page_count_has_no_fixed_hint(monkeypatch):
    res, captured = generate(monkeypatch, num_pages=0)
    assert res.status_code == 200
    assert "自行決定" in captured["prompt"] and "必須剛好" not in captured["prompt"]


def test_document_mode_allows_rich_single_page_layouts(monkeypatch):
    """詳細模式：同一主題盡量在同一頁完整呈現，卡片可分小段、加結果標籤並與圖表並列（例如多欄分類卡 + 圖表）。"""
    res, captured = generate(monkeypatch, deck_mode="document")
    assert res.status_code == 200
    system = captured["system"]
    for text in ("同一個主題的資訊盡量在同一頁完整呈現", "卡片可以分成 2 ~ 3 個小段", "底部可放一個結果標籤",
                 "3 欄分類卡加 1 欄圖表", "卡片內距 p-4 ~ p-5", "分類比較卡：2~4 欄並排的類別"):
        assert text in system
    assert "絕對不要把所有文字硬塞進同一頁" not in system


def test_speaker_mode_stays_minimal(monkeypatch):
    res, captured = generate(monkeypatch)
    system = captured["system"]
    assert "條列最多 3 點、每點不超過 15 字" in system and "卡片內距 p-5 ~ p-6" in system
    assert "卡片可以分成 2 ~ 3 個小段" not in system


def test_dense_mode_uses_dashboard_rules_and_examples(monkeypatch):
    """密集資訊模式：每頁是儀表板，附上範例頁；頁數由 AI 決定時建議 1~4 頁。"""
    res, captured = generate(monkeypatch, deck_mode="dense", num_pages=0)
    assert res.status_code == 200
    system = captured["system"]
    assert "【簡報模式：密集資訊模式（儀表板型 / Dashboard）】" in system
    assert "【範例頁（只學版面結構、層次與設計手法）】" in system
    for name, _ in app_module.DENSE_EXAMPLES:
        assert f"▍範例：{name}" in system
    assert "範例中的主題、文字與數字都是虛構的" in system
    assert app_module.DECK_MODE_LABELS["dense"] in captured["prompt"]
    assert "建議 1~4 頁" in captured["prompt"]


def test_examples_only_in_dense_mode(monkeypatch):
    for mode in ("speaker", "document"):
        _, captured = generate(monkeypatch, deck_mode=mode)
        assert "【範例頁" not in captured["system"]


def test_dense_one_page_skips_one_page_report_rules(monkeypatch):
    _, captured = generate(monkeypatch, deck_mode="dense", num_pages=1)
    assert "【一頁式簡報報告" not in captured["system"]
    _, captured = generate(monkeypatch, deck_mode="document", num_pages=1)
    assert "【一頁式簡報報告" in captured["system"]


def test_dense_mode_allows_four_charts_per_slide(monkeypatch):
    chart = {"type": "bar", "title": "t", "unit": "", "labels": ["a", "b"], "datasets": [{"label": "s", "values": [1, 2]}],
             "colors": [], "ref_lines": [], "highlight": []}
    slide = {**SLIDE, "charts": [chart] * 5, "speaker_notes": "x"}
    for mode, expected in (("dense", 4), ("document", 2)):
        capture_llm(monkeypatch, {"presentation_title": "t", "slides": [slide]})
        res = client.post("/api/generate", json={"content": "素材", "deck_mode": mode})
        assert len(res.json()["slides"][0]["charts"]) == expected


def test_regenerate_and_outline_accept_dense_mode(monkeypatch):
    captured = capture_llm(monkeypatch, {**SLIDE, "charts": [], "speaker_notes": "x"})
    res = client.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE], "deck_mode": "dense"})
    assert res.status_code == 200 and "【範例頁" in captured["system"] and "密集資訊模式" in captured["system"]
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": []})
    res = client.post("/api/outline", json={"content": "素材", "deck_mode": "dense", "num_pages": 0})
    assert res.status_code == 200 and "密集資訊模式" in captured["system"] and "建議 1~4 頁" in captured["prompt"]
    assert client.post("/api/generate", json={"content": "素材", "deck_mode": "unknown"}).status_code == 422
