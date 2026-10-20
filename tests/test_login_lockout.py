import os
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402


def client(ip="10.0.0.1"):
    return TestClient(app_module.app, client=(ip, 50000))


def login(c, password="wrong-pw", username="alice"):
    return c.post("/api/auth/login", json={"username": username, "password": password})


def setup_user():
    store.create_user("alice", "secret123")
    store.create_user("bob", "secret123")


def test_three_failures_lock_ip():
    setup_user()
    c = client()
    first, second = login(c), login(c)
    assert first.status_code == 401 and "再錯 2 次" in first.json()["detail"]
    assert second.status_code == 401 and "再錯 1 次" in second.json()["detail"]
    third = login(c)
    assert third.status_code == 429 and "已鎖定 15 分鐘" in third.json()["detail"]

    # 鎖定期間密碼正確、換帳號都一樣被擋
    res = login(c, "secret123")
    assert res.status_code == 429
    assert 0 < int(res.headers["Retry-After"]) <= 15 * 60
    assert login(c, "secret123", "bob").status_code == 429
    assert "rslide_session" not in res.cookies


def test_lock_is_per_ip():
    setup_user()
    c = client("10.0.0.1")
    for _ in range(3):
        login(c)
    assert login(c, "secret123").status_code == 429
    assert login(client("10.0.0.2"), "secret123").status_code == 200


def test_lock_expires_after_15_minutes(monkeypatch):
    setup_user()
    c = client()
    for _ in range(3):
        login(c)
    real_now = store.now_ms
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + 15 * 60 * 1000 - 5000)
    assert login(c, "secret123").status_code == 429
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + 15 * 60 * 1000 + 1000)
    assert login(c, "secret123").status_code == 200
    assert login(c).status_code == 401           # 解鎖後重新計算次數


def test_failures_outside_window_do_not_count(monkeypatch):
    setup_user()
    c = client()
    login(c)
    login(c)
    real_now = store.now_ms
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + 15 * 60 * 1000 + 1000)
    res = login(c)
    assert res.status_code == 401 and "再錯 2 次" in res.json()["detail"]


def test_third_attempt_with_correct_password_succeeds():
    setup_user()
    c = client()
    login(c)
    login(c)
    assert login(c, "secret123").status_code == 200
    assert store.list_login_lockouts() == []


def test_successful_login_does_not_reset_failures():
    """攻擊者不能穿插登入自己的帳號來重設失敗次數。"""
    setup_user()
    c = client()
    login(c)
    login(c)
    assert login(c, "secret123", "bob").status_code == 200
    assert login(c).status_code == 429


def test_concurrent_attempts_cannot_exceed_limit(monkeypatch):
    setup_user()
    calls = []
    real_auth = store.authenticate
    monkeypatch.setattr(store, "authenticate", lambda u, p: calls.append(1) or real_auth(u, p))
    c = client()
    with ThreadPoolExecutor(max_workers=10) as pool:
        codes = list(pool.map(lambda _: login(c).status_code, range(10)))
    assert len(calls) == 3
    assert codes.count(401) == 2 and codes.count(429) == 8


def test_admin_unlock():
    setup_user()
    c = client()
    for _ in range(3):
        login(c)
    assert [r["ip"] for r in store.list_login_lockouts()] == ["10.0.0.1"]
    assert store.unlock_login_ip("10.0.0.1")
    assert not store.unlock_login_ip("10.0.0.1")
    res = login(c)
    assert res.status_code == 401 and "再錯 2 次" in res.json()["detail"]   # 失敗紀錄一併清除
