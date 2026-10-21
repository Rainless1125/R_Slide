import os
from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402

MAX = store.LOGIN_MAX_FAILURES
LOCK_MS = store.LOGIN_LOCKOUT_MS


def client(ip="10.0.0.1"):
    return TestClient(app_module.app, client=(ip, 50000))


def login(c, password="wrong-pw", username="alice"):
    return c.post("/api/auth/login", json={"username": username, "password": password})


def fail(c, times):
    return [login(c) for _ in range(times)]


def setup_user():
    store.create_user("alice", "secret123")
    store.create_user("bob", "secret123")


def test_policy_is_five_failures_thirty_minutes():
    assert MAX == 5
    assert LOCK_MS == 30 * 60 * 1000


def test_failures_lock_ip():
    setup_user()
    c = client()
    for i, res in enumerate(fail(c, MAX - 1), 1):
        assert res.status_code == 401 and f"再錯 {MAX - i} 次" in res.json()["detail"]
    last = login(c)
    assert last.status_code == 429 and "已鎖定 30 分鐘" in last.json()["detail"]

    # 鎖定期間密碼正確、換帳號都一樣被擋
    res = login(c, "secret123")
    assert res.status_code == 429 and "30 分鐘後再試" in res.json()["detail"]
    assert LOCK_MS // 1000 - 5 < int(res.headers["Retry-After"]) <= LOCK_MS // 1000
    assert login(c, "secret123", "bob").status_code == 429
    assert "rslide_session" not in res.cookies


def test_lock_is_per_ip():
    setup_user()
    c = client("10.0.0.1")
    fail(c, MAX)
    assert login(c, "secret123").status_code == 429
    assert login(client("10.0.0.2"), "secret123").status_code == 200


def test_lock_expires(monkeypatch):
    setup_user()
    c = client()
    fail(c, MAX)
    real_now = store.now_ms
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + LOCK_MS - 5000)
    assert login(c, "secret123").status_code == 429
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + LOCK_MS + 1000)
    assert login(c, "secret123").status_code == 200
    res = login(c)                                   # 解鎖後重新計算次數
    assert res.status_code == 401 and f"再錯 {MAX - 1} 次" in res.json()["detail"]


def test_failures_outside_window_do_not_count(monkeypatch):
    setup_user()
    c = client()
    fail(c, MAX - 1)
    real_now = store.now_ms
    monkeypatch.setattr(store, "now_ms", lambda: real_now() + LOCK_MS + 1000)
    res = login(c)
    assert res.status_code == 401 and f"再錯 {MAX - 1} 次" in res.json()["detail"]


def test_last_attempt_with_correct_password_succeeds():
    setup_user()
    c = client()
    fail(c, MAX - 1)
    assert login(c, "secret123").status_code == 200
    assert store.list_login_lockouts() == []


def test_successful_login_does_not_reset_failures():
    """攻擊者不能穿插登入自己的帳號來重設失敗次數。"""
    setup_user()
    c = client()
    fail(c, MAX - 1)
    assert login(c, "secret123", "bob").status_code == 200
    assert login(c).status_code == 429


def test_concurrent_attempts_cannot_exceed_limit(monkeypatch):
    setup_user()
    calls = []
    real_auth = store.authenticate
    monkeypatch.setattr(store, "authenticate", lambda u, p: calls.append(1) or real_auth(u, p))
    c = client()
    with ThreadPoolExecutor(max_workers=20) as pool:
        codes = list(pool.map(lambda _: login(c).status_code, range(20)))
    assert len(calls) == MAX
    assert codes.count(401) == MAX - 1 and codes.count(429) == 20 - (MAX - 1)


def test_admin_unlock():
    setup_user()
    c = client()
    fail(c, MAX)
    assert [r["ip"] for r in store.list_login_lockouts()] == ["10.0.0.1"]
    assert store.unlock_login_ip("10.0.0.1")
    assert not store.unlock_login_ip("10.0.0.1")
    res = login(c)
    assert res.status_code == 401 and f"再錯 {MAX - 1} 次" in res.json()["detail"]   # 失敗紀錄一併清除
