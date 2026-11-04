"""AI 一次修改多個元素：/api/regenerate-elements 送出框選 / Shift 多選的元素，
各自修改並互相呼應（回傳與選取數量相同的元素），或合併成一個元素。"""
import pytest
from fastapi.testclient import TestClient

import app as app_module

CHART = {"type": "bar", "title": "滿意度", "unit": "分", "labels": ["研發", "業務"],
         "datasets": [{"label": "分數", "values": [4.1, 3.6]}], "colors": [], "ref_lines": [], "highlight": []}
BODY = {
    "content": "研發部 4.1 分、業務部 3.6 分、行政部 3.9 分",
    "slide_title": "各部門滿意度",
    "slide_html": '<div class="w-full h-full grid grid-cols-3"><div data-rs-target="1">研發</div>'
                  '<div data-rs-target="2">業務</div><div data-rs-target="3">行政</div></div>',
    "elements": [{"html": '<div class="col-span-1">研發 4.1</div>', "width": 300, "height": 200},
                 {"html": '<div class="col-span-1">業務 3.6</div>', "width": 310, "height": 210},
                 {"html": '<div class="col-span-1"><div data-rs-chart="0"></div></div>', "width": 320, "height": 220}],
    "charts": [CHART],
    "custom_prompt": "改成三步驟流程",
    "merge_width": 960, "merge_height": 240,
}


def capture(monkeypatch, reply):
    captured = {}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None, thinking=None):
        captured.update(system=system_instruction, prompt=prompt, schema=schema)
        usage.update(provider=provider, model=model or "m")
        return dict(reply)

    monkeypatch.setattr(app_module, "call_llm", fake)
    return captured


@pytest.fixture
def client():
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": "alice", "password": "secret123"}).status_code == 200
    return c


EACH_REPLY = {"elements": [{"html_content": "<div>步驟 1</div>"}, {"html_content": "<div>步驟 2</div>"},
                           {"html_content": '<div><div data-rs-chart="0"></div></div>'}], "charts": [CHART]}


def test_requires_login(monkeypatch):
    capture(monkeypatch, EACH_REPLY)
    assert TestClient(app_module.app).post("/api/regenerate-elements", json=BODY).status_code == 401


def test_each_mode_returns_same_count_and_prompt_lists_every_element(monkeypatch, client):
    captured = capture(monkeypatch, EACH_REPLY)
    res = client.post("/api/regenerate-elements", json=BODY)
    assert res.status_code == 200
    data = res.json()
    assert data["elements"] == ["<div>步驟 1</div>", "<div>步驟 2</div>", '<div><div data-rs-chart="0"></div></div>']
    assert data["charts"][0]["labels"] == ["研發", "業務"]
    assert captured["schema"] is app_module.ElementsRewrite
    assert "各自修改、互相呼應" in captured["system"] and "剛好 3 筆" in captured["system"]
    assert "{count}" not in captured["system"] and "{width}" not in captured["system"]
    for text in ("元素 1（寬 300 px、高 200 px）", "元素 3（寬 320 px、高 220 px）", "研發 4.1", "改成三步驟流程", "滿意度"):
        assert text in captured["prompt"]


def test_merge_mode_returns_single_element(monkeypatch, client):
    captured = capture(monkeypatch, {"html_content": "<div>流程圖</div>", "charts": []})
    res = client.post("/api/regenerate-elements", json={**BODY, "merge": True})
    assert res.status_code == 200
    assert res.json() == {"elements": ["<div>流程圖</div>"], "charts": []}
    assert captured["schema"] is app_module.ElementRewrite
    assert "合併成一個元素" in captured["system"] and "960 × 240 px" in captured["system"]


def test_wrong_element_count_is_an_error(monkeypatch, client):
    capture(monkeypatch, {"elements": [{"html_content": "<div>只有一個</div>"}], "charts": []})
    res = client.post("/api/regenerate-elements", json=BODY)
    assert res.status_code == 502 and "數量不符" in res.json()["detail"]


def test_merge_without_html_is_an_error(monkeypatch, client):
    capture(monkeypatch, {"html_content": "  ", "charts": []})
    assert client.post("/api/regenerate-elements", json={**BODY, "merge": True}).status_code == 502


def test_element_count_limits(monkeypatch, client):
    capture(monkeypatch, EACH_REPLY)
    one = {**BODY, "elements": BODY["elements"][:1]}
    assert client.post("/api/regenerate-elements", json=one).status_code == 422
    many = {**BODY, "elements": [BODY["elements"][0]] * (app_module.MAX_MULTI_ELEMENTS + 1)}
    assert client.post("/api/regenerate-elements", json=many).status_code == 422


def test_rejects_empty_or_too_large_elements(monkeypatch, client):
    capture(monkeypatch, EACH_REPLY)
    empty = {**BODY, "elements": [{**BODY["elements"][0], "html": "  "}, *BODY["elements"][1:]]}
    assert client.post("/api/regenerate-elements", json=empty).status_code == 400
    big = "x" * (app_module.MAX_SLIDE_HTML_CHARS // 2 + 1)
    huge = {**BODY, "elements": [{**e, "html": big} for e in BODY["elements"][:2]]}
    assert client.post("/api/regenerate-elements", json=huge).status_code == 400
