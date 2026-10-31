import pytest
from fastapi.testclient import TestClient

import app as app_module
import store

ADMIN = {"username": "root", "password": "admin-pass1"}


@pytest.fixture(autouse=True)
def admin_env(monkeypatch):
    monkeypatch.setenv("ADMIN_USERNAME", ADMIN["username"])
    monkeypatch.setenv("ADMIN_PASSWORD", ADMIN["password"])


def admin_client():
    c = TestClient(app_module.app)
    assert c.post("/api/admin/login", json=ADMIN).status_code == 200
    return c


def test_admin_page_served():
    res = TestClient(app_module.app).get("/admin")
    assert res.status_code == 200 and "後台" in res.text


def test_admin_disabled_without_env(monkeypatch):
    monkeypatch.delenv("ADMIN_PASSWORD")
    c = TestClient(app_module.app)
    assert c.get("/api/admin/me").json()["status"] == "not_configured"
    assert c.post("/api/admin/login", json=ADMIN).status_code == 503
    assert c.get("/api/admin/users").status_code == 503


def test_admin_weak_password_not_enabled(monkeypatch):
    monkeypatch.setenv("ADMIN_PASSWORD", "short")
    c = TestClient(app_module.app)
    assert c.get("/api/admin/me").json()["status"] == "weak_password"
    assert c.post("/api/admin/login", json={"username": "root", "password": "short"}).status_code == 503


def test_admin_login_required_and_wrong_password():
    c = TestClient(app_module.app)
    assert c.get("/api/admin/users").status_code == 401
    assert c.post("/api/admin/login", json={"username": "root", "password": "wrong-pass1"}).status_code == 401
    assert c.post("/api/admin/login", json={"username": "ROOT", "password": ADMIN["password"]}).status_code == 401
    me = c.get("/api/admin/me").json()
    assert me["status"] == "ok" and me["username"] is None


def test_admin_login_shares_ip_lockout():
    c = TestClient(app_module.app)
    for _ in range(store.LOGIN_MAX_FAILURES):
        c.post("/api/admin/login", json={"username": "root", "password": "wrong-pass1"})
    assert c.post("/api/admin/login", json=ADMIN).status_code == 429


def test_admin_session_and_logout():
    c = admin_client()
    assert c.get("/api/admin/me").json()["username"] == "root"
    assert c.get("/api/admin/users").status_code == 200
    c.post("/api/admin/logout")
    assert c.get("/api/admin/users").status_code == 401


def test_admin_session_invalid_after_password_change(monkeypatch):
    c = admin_client()
    monkeypatch.setenv("ADMIN_PASSWORD", "another-pass2")
    assert c.get("/api/admin/users").status_code == 401


def test_user_session_cannot_access_admin():
    c = TestClient(app_module.app)
    c.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    assert c.get("/api/admin/users").status_code == 401
    # 管理者帳號也不能登入主畫面
    assert TestClient(app_module.app).post("/api/auth/login", json=ADMIN).status_code == 401


def test_admin_manage_users():
    c = admin_client()
    assert c.post("/api/admin/users", json={"username": "bob", "password": "123"}).status_code == 400
    assert c.post("/api/admin/users", json={"username": "a", "password": "secret123"}).status_code == 400
    assert c.post("/api/admin/users", json={"username": "bob", "password": "secret123"}).status_code == 200
    assert c.post("/api/admin/users", json={"username": "BOB", "password": "secret123"}).status_code == 409

    user = TestClient(app_module.app)
    assert user.post("/api/auth/login", json={"username": "bob", "password": "secret123"}).status_code == 200
    user.post("/api/history", json={"id": "h1", "title": "t", "input": {}, "data": {"slides": []}})
    rows = c.get("/api/admin/users").json()
    assert [(r["username"], r["history_count"]) for r in rows] == [("bob", 1)]

    assert c.put("/api/admin/users/bob/password", json={"password": "weak"}).status_code == 400
    assert c.put("/api/admin/users/nobody/password", json={"password": "newpass123"}).status_code == 404
    assert c.put("/api/admin/users/bob/password", json={"password": "newpass123"}).status_code == 200
    assert user.get("/api/history").status_code == 401        # 改密碼後原本的 session 失效
    assert user.post("/api/auth/login", json={"username": "bob", "password": "newpass123"}).status_code == 200

    assert c.delete("/api/admin/users/bob").status_code == 200
    assert c.delete("/api/admin/users/bob").status_code == 404
    assert c.get("/api/admin/users").json() == []
    assert user.get("/api/history").status_code == 401


def test_admin_overview_usage_feedback_lockouts():
    c = admin_client()
    u = store.create_user("carol", "secret123")
    entry = {"user_id": u["id"], "username": "carol", "action": "generate", "provider": "gemini", "model": "m",
             "input_chars": 10, "content_hash": "x", "status": "ok", "input_tokens": 5, "output_tokens": 7,
             "total_tokens": 12}
    store.log_llm_usage(entry)
    store.add_feedback(u, "很好用 <script>", 5)
    store.add_feedback(u, "", 3)
    with store.connect() as conn:
        conn.execute("INSERT INTO login_lockouts (ip, locked_until) VALUES (?, ?)", ("10.0.0.9", store.now_ms() + 60000))

    o = c.get("/api/admin/overview?days=7").json()
    assert (o["users"], o["llm_calls"], o["llm_total_tokens"], o["active_users"]) == (1, 1, 12, 1)
    assert (o["feedback"], o["feedback_avg_rating"], o["lockouts"]) == (2, 4.0, 1)
    assert c.get("/api/admin/overview?days=0").status_code == 422

    usage = c.get("/api/admin/usage").json()
    assert usage[0]["username"] == "carol" and usage[0]["total_tokens"] == 12
    assert c.get("/api/admin/usage/carol").json()[0]["calls"] == 1

    fb = c.get("/api/admin/feedback").json()
    assert len(fb) == 2 and {r["content"] for r in fb} == {"很好用 <script>", ""}
    assert c.get("/api/admin/feedback?username=nobody").json() == []

    assert [r["ip"] for r in c.get("/api/admin/lockouts").json()] == ["10.0.0.9"]
    assert c.delete("/api/admin/lockouts/10.0.0.9").json() == {"was_locked": True}
    assert c.get("/api/admin/lockouts").json() == []


# ---------- 公司 LDAP 登入（AUTH_MODE=ldap）：帳號與密碼由公司管理 ----------
def test_users_list_shows_account_source():
    c = admin_client()
    c.post("/api/admin/users", json={"username": "local1", "password": "secret123"})
    store.get_or_create_external_user("E12345")
    users = {u["username"]: u["source"] for u in c.get("/api/admin/users").json()}
    assert users == {"local1": "local", "E12345": "ldap"}
    assert c.get("/api/admin/me").json()["auth_mode"] == "system"


def test_ldap_mode_blocks_creating_accounts_and_resetting_passwords(monkeypatch):
    c = admin_client()
    assert c.post("/api/admin/users", json={"username": "old_local", "password": "secret123"}).status_code == 200
    store.get_or_create_external_user("E12345")
    monkeypatch.setenv("AUTH_MODE", "ldap")
    assert c.get("/api/admin/me").json()["auth_mode"] == "ldap"
    res = c.post("/api/admin/users", json={"username": "new_local", "password": "secret123"})
    assert res.status_code == 409 and "公司 LDAP" in res.json()["detail"]
    for name in ("old_local", "E12345"):
        res = c.put(f"/api/admin/users/{name}/password", json={"password": "newpass123"})
        assert res.status_code == 409 and "公司系統修改" in res.json()["detail"]
    assert store.authenticate("old_local", "secret123") is not None     # 密碼沒有被改動
    assert {u["username"] for u in c.get("/api/admin/users").json()} == {"old_local", "E12345"}
    # 刪除仍可使用（例如離職員工）；之後再以公司帳號登入會建立新的空帳號
    assert c.delete("/api/admin/users/E12345").status_code == 200


def test_manage_users_cli_refuses_in_ldap_mode(monkeypatch, capsys):
    import manage_users
    monkeypatch.setenv("AUTH_MODE", "ldap")
    for cmd in (["add", "someone"], ["reset-password", "someone"]):
        with pytest.raises(SystemExit) as e:
            manage_users.main(cmd)
        assert "公司 LDAP" in str(e.value)
    store.get_or_create_external_user("E12345")
    manage_users.main(["list"])
    assert "E12345\t0 筆紀錄\t公司帳號（LDAP）" in capsys.readouterr().out
