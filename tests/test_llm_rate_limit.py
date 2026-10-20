"""生成 / 重產的次數上限（每小時、24 小時、同時進行）與欄位長度上限。"""
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app as app_module
import manage_users
import store

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}
REGEN = {"content": "素材", "slide_index": 0, "slides": [SLIDE]}


def new_client(username="alice"):
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": username, "password": "secret123"}).status_code == 200
    return c


@pytest.fixture
def llm(monkeypatch):
    """假的 LLM：記錄被呼叫的次數；error 可指定要丟出的例外。"""
    state = {"calls": 0, "error": None}

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None):
        state["calls"] += 1
        usage.update(provider=provider, model=model or "m")
        if state["error"]:
            raise state["error"]
        if schema is app_module.AdaptiveSlide:
            return dict(SLIDE)
        return {"presentation_title": "t", "slides": [SLIDE]}

    monkeypatch.setattr(app_module, "call_llm", fake)
    return state


def generate(c, **kw):
    return c.post("/api/generate", json={"content": "素材", **kw})


def statuses():
    with store.connect() as conn:
        return [r[0] for r in conn.execute("SELECT status FROM llm_usage ORDER BY id")]


def test_default_limits():
    assert store.llm_limit("LLM_RATE_LIMIT_PER_HOUR") == 20
    assert store.llm_limit("LLM_RATE_LIMIT_PER_DAY") == 100
    assert store.llm_limit("LLM_MAX_CONCURRENT") == 2


def test_hourly_limit_counts_generate_and_regenerate(llm):
    c = new_client()
    for i in range(20):
        res = generate(c) if i % 2 else c.post("/api/regenerate-slide", json=REGEN)
        assert res.status_code == 200
    res = generate(c)
    assert res.status_code == 429
    assert res.json()["detail"].startswith("本帳號每小時最多可生成 / 重產 20 次")
    assert 3590 < int(res.headers["Retry-After"]) <= 3600
    assert c.post("/api/regenerate-slide", json=REGEN).status_code == 429
    assert llm["calls"] == 20                                   # 被擋下的請求不會呼叫 LLM
    assert statuses() == ["ok"] * 20 + ["rate_limited"] * 2


def test_hourly_limit_slides_out(llm, monkeypatch):
    c = new_client()
    for _ in range(20):
        generate(c)
    real_now = store.now_ms
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + store.HOUR_MS + 1000)
    assert generate(c).status_code == 200


def test_failed_calls_count(llm):
    c = new_client()
    llm["error"] = HTTPException(status_code=502, detail="AI 輸出超過長度上限（MAX_TOKENS）")
    for _ in range(20):
        assert generate(c).status_code == 502
    llm["error"] = None
    assert generate(c).status_code == 429


def test_daily_limit(llm):
    c = new_client()
    user = store.session_user(c.cookies.get("rslide_session"))
    now = store.now_ms()
    for i in range(100):                                        # 過去 23 小時內平均分布，每小時都不超過 20 次
        store.log_llm_usage({"user_id": user["id"], "username": "alice", "action": "generate", "provider": "gemini",
                             "model": "m", "input_chars": 1, "status": "ok", "created_at": now - 2 * store.HOUR_MS - i * 700_000})
    res = generate(c)
    assert res.status_code == 429 and res.json()["detail"].startswith("本帳號每 24 小時最多可生成 / 重產 100 次")
    assert "小時" in res.json()["detail"].split("請於")[1]       # 需等待超過 1 小時，以小時 + 分鐘顯示
    assert llm["calls"] == 0


def test_limits_are_per_user(llm):
    alice, bob = new_client("alice"), new_client("bob")
    for _ in range(20):
        generate(alice)
    assert generate(alice).status_code == 429
    assert generate(bob).status_code == 200


def test_limits_can_be_disabled(llm, monkeypatch):
    monkeypatch.setenv("LLM_RATE_LIMIT_PER_HOUR", "0")
    monkeypatch.setenv("LLM_RATE_LIMIT_PER_DAY", "0")
    c = new_client()
    for _ in range(25):
        assert generate(c).status_code == 200


def test_concurrent_limit(llm, monkeypatch):
    started, release = threading.Semaphore(0), threading.Event()
    real = app_module.call_llm

    def slow(*args, **kw):
        started.release()
        release.wait(10)
        return real(*args, **kw)

    monkeypatch.setattr(app_module, "call_llm", slow)
    c = new_client()
    with ThreadPoolExecutor(max_workers=2) as pool:
        running = [pool.submit(generate, c) for _ in range(2)]
        assert started.acquire(timeout=5) and started.acquire(timeout=5)
        res = generate(c)
        assert res.status_code == 429 and "同時最多進行 2 個" in res.json()["detail"]
        release.set()
        assert [f.result().status_code for f in running] == [200, 200]
    assert generate(c).status_code == 200                      # 完成後就能再送


def test_stale_pending_is_not_counted_as_running(llm):
    c = new_client()
    user = store.session_user(c.cookies.get("rslide_session"))
    for _ in range(2):                                          # 服務在呼叫途中重啟，留下未結束的紀錄
        store.log_llm_usage({"user_id": user["id"], "username": "alice", "action": "generate", "provider": "gemini",
                             "model": "m", "input_chars": 1, "status": "pending",
                             "created_at": store.now_ms() - store.PENDING_STALE_MS - 1000})
    assert generate(c).status_code == 200


def test_burst_cannot_exceed_hourly_limit(llm, monkeypatch):
    monkeypatch.setenv("LLM_MAX_CONCURRENT", "0")
    c = new_client()
    with ThreadPoolExecutor(max_workers=15) as pool:
        codes = list(pool.map(lambda _: generate(c).status_code, range(30)))
    assert llm["calls"] == 20
    assert codes.count(200) == 20 and codes.count(429) == 10


@pytest.mark.parametrize("field,limit", [("content", 50_000), ("target_audience", 200), ("style_preference", 1000),
                                         ("model", 100), ("provider", 100)])
def test_generate_field_limits(llm, field, limit):
    c = new_client()
    res = generate(c, **{field: "a" * (limit + 1)})
    assert res.status_code == 400 and "過長" in res.json()["detail"]
    assert llm["calls"] == 0 and statuses() == []               # 格式不符的請求不算次數


def test_generate_accepts_values_at_limit(llm):
    c = new_client()
    res = generate(c, content="a" * 50_000, target_audience="a" * 200, style_preference="a" * 1000)
    assert res.status_code == 200


@pytest.mark.parametrize("patch", [
    {"custom_prompt": "a" * 2001},
    {"presentation_title": "a" * 201},
    {"slides": [SLIDE] * 61},
    {"slides": [dict(SLIDE, slide_title="a" * 501)]},
    {"slides": [dict(SLIDE, layout_concept="a" * 501)]},
    {"slides": [dict(SLIDE, html_content="a" * 50_001)]},
    {"slides": [dict(SLIDE, speaker_notes="a" * 5001)]},
    {"slides": [dict(SLIDE, charts=[{"labels": ["a" * 20_000]}])]},
])
def test_regenerate_field_limits(llm, patch):
    c = new_client()
    res = c.post("/api/regenerate-slide", json={**REGEN, **patch})
    assert res.status_code == 400
    assert llm["calls"] == 0 and statuses() == []


def test_regenerate_accepts_values_at_limit(llm):
    c = new_client()
    slides = [dict(SLIDE, html_content="a" * 50_000, speaker_notes="a" * 5000)] + [SLIDE] * 59
    res = c.post("/api/regenerate-slide", json={**REGEN, "slides": slides, "custom_prompt": "a" * 2000,
                                                "presentation_title": "a" * 200})
    assert res.status_code == 200


def test_oversized_body_rejected_before_parsing(llm):
    c = new_client()
    res = c.post("/api/generate", content=b'{"content": "' + b"a" * (2 * 1024 * 1024) + b'"}',
                 headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert llm["calls"] == 0


def test_usage_report_counts_rate_limited_separately(llm, capsys):
    c = new_client()
    for _ in range(22):
        generate(c)
    [row] = store.usage_by_user(0)
    assert row["calls"] == 20 and row["rate_limited"] == 2 and row["generates"] == 20
    assert store.usage_by_day("alice", 0)[0]["calls"] == 20
    manage_users.main(["usage"])
    out = capsys.readouterr().out
    assert "限流" in out and "alice" in out
