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
