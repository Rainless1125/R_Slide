import os
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402

LIMIT = store.DEFAULT_REGISTER_LIMIT_PER_IP


def client(ip="10.0.0.1"):
    return TestClient(app_module.app, client=(ip, 50000))


def register(c, username, password="secret123"):
    return c.post("/api/auth/register", json={"username": username, "password": password})


def test_default_limit_is_five_per_day():
    assert LIMIT == 5


def test_same_ip_is_limited():
    c = client()
    for i in range(LIMIT):
        assert register(c, f"user{i}").status_code == 200
    res = register(c, "one-more")
    assert res.status_code == 429
    assert f"最多可註冊 {LIMIT} 個帳號" in res.json()["detail"]
    assert 24 * 3600 - 10 < int(res.headers["Retry-After"]) <= 24 * 3600
    assert "rslide_session" not in res.cookies
    assert store.authenticate("one-more", "secret123") is None


def test_limit_is_per_ip():
    c = client("10.0.0.1")
    for i in range(LIMIT):
        register(c, f"user{i}")
    assert register(c, "blocked").status_code == 429
    assert register(client("10.0.0.2"), "other-ip").status_code == 200


def test_failed_registrations_do_not_count():
    c = client()
    register(c, "taken")
    for _ in range(LIMIT + 2):
        assert register(c, "taken").status_code == 409          # 帳號重複
        assert register(c, "bad", "123").status_code == 400      # 密碼不符規則
    for i in range(LIMIT - 1):
        assert register(c, f"user{i}").status_code == 200
    assert register(c, "blocked").status_code == 429


def test_window_slides_after_24_hours(monkeypatch):
    c = client()
    now = store.now_ms()
    monkeypatch.setattr(store, "now_ms", lambda: now)
    for i in range(LIMIT):
        register(c, f"user{i}")
    assert register(c, "blocked").status_code == 429
    monkeypatch.setattr(store, "now_ms", lambda: now + store.DAY_MS + 1)
    assert register(c, "next-day").status_code == 200


def test_limit_from_env(monkeypatch):
    monkeypatch.setenv("REGISTER_LIMIT_PER_IP_PER_DAY", "1")
    c = client()
    assert register(c, "first").status_code == 200
    assert register(c, "second").status_code == 429


def test_zero_disables_limit(monkeypatch):
    monkeypatch.setenv("REGISTER_LIMIT_PER_IP_PER_DAY", "0")
    c = client()
    for i in range(LIMIT + 3):
        assert register(c, f"user{i}").status_code == 200


def test_invalid_env_falls_back_to_default(monkeypatch):
    monkeypatch.setenv("REGISTER_LIMIT_PER_IP_PER_DAY", "abc")
    assert store.register_limit() == LIMIT


def test_admin_created_accounts_do_not_count():
    for i in range(LIMIT + 2):
        store.create_user(f"staff{i}", "secret123")
    assert register(client(), "self-signup").status_code == 200


def test_concurrent_registrations_cannot_exceed_limit():
    c = client()
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda i: register(c, f"user{i}").status_code, range(LIMIT + 5)))
    assert codes.count(200) == LIMIT
    assert codes.count(429) == 5
