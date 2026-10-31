"""整份簡報的設計規範（theme）、版型目錄與頁面節奏：生成時先決定 theme，重產時沿用。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
from deck_design import MAX_THEME_TEXT, theme_from_input  # noqa: E402

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入

THEME = {
    "design_direction": "白底極簡、深藍強調",
    "page_background": "bg-white",
    "text_primary": "text-slate-900",
    "text_secondary": "text-slate-500",
    "accent": "indigo-600",
    "accent_soft": "indigo-50",
    "card_style": "bg-slate-50 border border-slate-200 rounded-2xl p-6",
    "heading_style": "text-4xl font-bold tracking-tight text-slate-900",
    "eyebrow_style": "text-xs font-semibold uppercase tracking-widest text-indigo-600",
    "chart_colors": ["#4f46e5", "#0ea5e9", "#f59e0b"],
}
SLIDE = {"page_number": 1, "layout_concept": "封面", "slide_title": "第三季報告", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}


def capture_llm(monkeypatch, result):
    captured = {}

    def fake_llm(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt, schema=schema)
        return dict(result)

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    return captured


def test_theme_is_required_and_comes_before_slides():
    schema = app_module.AdaptivePresentation.model_json_schema()
    assert "theme" in schema["required"]
    keys = list(schema["properties"])
    assert keys.index("theme") < keys.index("slides")     # LLM 依欄位順序輸出：先決定 theme 再產生每一頁
    assert set(schema["$defs"]["DeckTheme"]["required"]) == set(THEME)


def test_generate_prompt_has_theme_catalog_and_rhythm(monkeypatch):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "theme": THEME, "slides": [SLIDE]})
    res = client.post("/api/generate", json={"content": "素材"})
    assert res.status_code == 200
    for section in ("【整份簡報的設計規範", "【版型目錄", "【整份簡報的節奏】", "2×2 矩陣", "theme.chart_colors",
                    "以畫面結構判斷", "折線圖至少要有 3 個時間點", "空間分配要平衡", "沒有功能的裝飾元素",
                    "不要用 justify-between、mt-auto", "圖表標題只寫一次", "每個數字都要附上單位", "都必須在所屬的卡片或容器內",
                    "【內容正確性】", "必須完整列出所有符合的項目", "各不要超過約 60px",
                    "只有一個項目的前後比較", "必須畫出兩條座標軸"):
        assert section in captured["system"]
    assert res.json()["theme"] == THEME


def test_generate_cleans_theme(monkeypatch):
    messy = {**THEME, "accent": "  indigo-600 \n", "card_style": "x" * 1000, "chart_colors": ["#4f46e5", "red", 3],
             "extra": "ignored"}
    capture_llm(monkeypatch, {"presentation_title": "t", "theme": messy, "slides": [SLIDE]})
    theme = client.post("/api/generate", json={"content": "素材"}).json()["theme"]
    assert theme["accent"] == "indigo-600"
    assert len(theme["card_style"]) == MAX_THEME_TEXT
    assert theme["chart_colors"] == ["#4f46e5"]
    assert "extra" not in theme


def test_outline_mode_keeps_page_order(monkeypatch):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "theme": THEME, "slides": [SLIDE]})
    outline = {"presentation_title": "t", "slides": [{"slide_title": "封面", "key_points": ["a"], "layout_concept": "封面"}]}
    assert client.post("/api/generate", json={"content": "素材", "outline": outline}).status_code == 200
    assert "節奏】只用來決定每頁的版型" in captured["prompt"]


def test_outline_suggests_layouts_from_catalog(monkeypatch):
    captured = capture_llm(monkeypatch, {"presentation_title": "t", "slides": []})
    assert client.post("/api/outline", json={"content": "素材"}).status_code == 200
    assert "【版型目錄" in captured["system"] and "【整份簡報的節奏】" in captured["system"]
    assert "【內容正確性】" in captured["system"]


def regenerate(monkeypatch, **extra):
    captured = capture_llm(monkeypatch, SLIDE)
    res = client.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE], **extra})
    assert res.status_code == 200
    return captured


def test_regenerate_follows_deck_theme(monkeypatch):
    captured = regenerate(monkeypatch, theme=THEME)
    assert "必須沿用其中的頁面背景" in captured["prompt"]
    assert THEME["card_style"] in captured["prompt"] and "#0ea5e9" in captured["prompt"]
    assert "【版型目錄" in captured["system"]
    assert "空間分配要平衡" in captured["system"] and "折線圖至少要有 3 個時間點" in captured["system"]
    assert "【內容正確性】" in captured["system"]


def test_regenerate_without_theme_follows_existing_style(monkeypatch):
    for extra in ({}, {"theme": None}, {"theme": {"unknown": "x"}}):
        captured = regenerate(monkeypatch, **extra)
        assert "沒有記錄設計規範" in captured["prompt"]


def test_theme_from_input_filters_values():
    assert theme_from_input(None) is None
    assert theme_from_input("bg-white") is None
    assert theme_from_input({"chart_colors": ["#fff"]}) is None          # 只有圖表色碼不算設計規範
    assert theme_from_input({"accent": "  ", "text_primary": 3}) is None
    assert theme_from_input({"accent": "rose-500", "chart_colors": "#fff"}) == {"accent": "rose-500", "chart_colors": []}
    colors = theme_from_input({"accent": "a", "chart_colors": ["#000000"] * 10})["chart_colors"]
    assert len(colors) == 6
