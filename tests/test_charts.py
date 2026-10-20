import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
from charts import MAX_CHARTS_PER_SLIDE, MAX_LABELS, normalize_chart, normalize_charts  # noqa: E402

client = TestClient(app_module.app)
pytestmark = pytest.mark.usefixtures("logged_in")   # 生成類 API 需要登入


def chart(**kw):
    base = {"type": "bar", "title": "營收", "unit": "億元", "labels": ["2022", "2023", "2024"],
            "datasets": [{"label": "營收", "values": [1, 2, 3]}], "colors": ["#2563eb"]}
    base.update(kw)
    return base


def test_valid_chart_passes_through():
    assert normalize_chart(chart()) == chart(datasets=[{"label": "營收", "values": [1.0, 2.0, 3.0]}], ref_lines=[])


def test_ref_lines_are_cleaned_and_limited():
    c = normalize_chart(chart(ref_lines=[{"label": "目標", "value": "2.5"}, {"label": "上限", "value": 4, "color": "#dc2626"},
                                         {"label": "壞色", "value": 1, "color": "red"}, {"label": "無值"}, "x",
                                         {"label": "第四條", "value": 9}]))
    assert c["ref_lines"] == [{"label": "目標", "value": 2.5}, {"label": "上限", "value": 4.0, "color": "#dc2626"},
                              {"label": "壞色", "value": 1.0}]


def test_pie_has_no_ref_lines():
    c = normalize_chart(chart(type="doughnut", ref_lines=[{"label": "目標", "value": 2}]))
    assert c["ref_lines"] == []


def test_values_are_aligned_to_labels_and_coerced():
    c = normalize_chart(chart(datasets=[{"label": "a", "values": ["1,200", "35%", None, 4, 5]},
                                        {"label": "b", "values": [float("nan")]}]))
    assert c["datasets"][0]["values"] == [1200.0, 35.0, 0.0]
    assert c["datasets"][1]["values"] == [0.0, 0.0, 0.0]


def test_rejects_unknown_type_or_empty_data():
    assert normalize_chart(chart(type="radar")) is None
    assert normalize_chart(chart(labels=[])) is None
    assert normalize_chart(chart(datasets=[])) is None
    assert normalize_chart("not a dict") is None


def test_pie_keeps_only_first_dataset():
    c = normalize_chart(chart(type="pie", datasets=[{"label": "a", "values": [1, 2, 3]},
                                                    {"label": "b", "values": [3, 2, 1]}]))
    assert [d["label"] for d in c["datasets"]] == ["a"]


def test_invalid_colors_are_dropped():
    c = normalize_chart(chart(colors=["#fff", "red", "#12345", "url(x)", " #A1B2C3 "]))
    assert c["colors"] == ["#fff", "#A1B2C3"]


def test_limits():
    c = normalize_chart(chart(labels=[str(i) for i in range(30)], title="x" * 100))
    assert len(c["labels"]) == MAX_LABELS
    assert len(c["title"]) == 40
    assert len(normalize_charts([chart()] * 5)) == MAX_CHARTS_PER_SLIDE
    assert normalize_charts(None) == []


def test_llm_schema_has_no_defaults():
    # Gemini 的 response_schema 不支援 default，LLM 用的 schema 必須全部必填
    schema = app_module.AdaptivePresentation.model_json_schema()

    def walk(node):
        if isinstance(node, dict):
            assert "default" not in node
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
    walk(schema)
    assert "charts" in schema["$defs"]["AdaptiveSlide"]["required"]


SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>"}


def regenerate(monkeypatch, slides, llm_result):
    captured = {}

    def fake_llm(provider, model, system_instruction, prompt, schema, temperature, usage=None):
        captured["prompt"] = prompt
        return dict(llm_result)

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    res = client.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": slides})
    return res, captured


def test_regenerate_accepts_old_slides_without_charts_and_normalizes(monkeypatch):
    res, captured = regenerate(monkeypatch, [SLIDE], {**SLIDE, "page_number": 9,
                                                      "charts": [chart(type="radar"), chart()]})
    assert res.status_code == 200
    data = res.json()
    assert data["page_number"] == 1
    assert data["charts"][0] is None and data["charts"][1]["type"] == "bar"  # 保留索引，對應 data-rs-chart="1"
    assert "原圖表資料" in captured["prompt"] and "（無）" in captured["prompt"]


def test_normalize_charts_keeps_indices_of_valid_charts():
    out = normalize_charts([chart(type="radar"), chart(title="第二張"), chart(labels=[])])
    assert out[0] is None
    assert out[1]["title"] == "第二張"
    assert len(out) == 2  # 結尾無效的圖表不需要佔位


def test_regenerate_keeps_user_charts_beyond_default_limit(monkeypatch):
    charts = [chart(title=f"圖{i}") for i in range(3)]
    res, _ = regenerate(monkeypatch, [{**SLIDE, "charts": [*charts[:1], None, *charts[1:]]}],
                        {**SLIDE, "charts": [*charts, chart(title="多的")]})
    assert res.status_code == 200
    assert [c["title"] for c in res.json()["charts"]] == ["圖0", "圖1", "圖2", "多的"]


def test_regenerate_sends_existing_chart_data_to_llm(monkeypatch):
    res, captured = regenerate(monkeypatch, [{**SLIDE, "charts": [chart(title="市佔率")]}], {**SLIDE, "charts": []})
    assert res.status_code == 200
    assert "市佔率" in captured["prompt"]


def test_generate_normalizes_charts(monkeypatch):
    def fake_llm(*args, **kwargs):
        return {"presentation_title": "t", "slides": [{**SLIDE, "charts": [chart(labels=[])]}]}

    monkeypatch.setattr(app_module, "call_llm", fake_llm)
    res = client.post("/api/generate", json={"content": "素材"})
    assert res.status_code == 200
    assert res.json()["slides"][0]["charts"] == []
