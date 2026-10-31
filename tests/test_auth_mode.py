"""登入方式（AUTH_MODE）：system 為內建帳號，ldap 以公司 LDAP 驗證並自動建立本機帳號、不開放註冊。"""
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import accounts  # noqa: E402
import ldap_auth  # noqa: E402
import store  # noqa: E402


@pytest.fixture
def ldap_mode(monkeypatch):
    """切換成 LDAP 登入，ldap_authenticate 改為檢查固定的帳號密碼，回傳實際收到的參數。"""
    monkeypatch.setenv("AUTH_MODE", "ldap")
    calls = []

    def fake(username, password):
        calls.append((username, password))
        if password == "down":
            raise ldap_auth.LdapUnavailable("無法連線公司 LDAP 伺服器，請稍後再試或聯絡管理員")
        return password == "corp-pass"

    monkeypatch.setattr(accounts, "ldap_authenticate", fake)
    return calls


def test_system_mode_is_default():
    me = TestClient(app_module.app).get("/api/auth/me").json()
    assert me["auth_mode"] == "system" and me["allow_registration"] is True


def test_ldap_mode_disables_registration(ldap_mode):
    c = TestClient(app_module.app)
    me = c.get("/api/auth/me").json()
    assert me["auth_mode"] == "ldap" and me["allow_registration"] is False
    res = c.post("/api/auth/register", json={"username": "alice", "password": "secret123"})
    assert res.status_code == 403 and "公司帳號" in res.json()["detail"]


def test_ldap_login_creates_local_account_once(ldap_mode):
    c = TestClient(app_module.app)
    res = c.post("/api/auth/login", json={"username": "E12345", "password": "corp-pass"})
    assert res.status_code == 200 and res.json()["username"] == "E12345"
    assert c.get("/api/auth/me").json()["username"] == "E12345"
    first = store.session_user(c.cookies.get(accounts.SESSION_COOKIE))

    c2 = TestClient(app_module.app)
    assert c2.post("/api/auth/login", json={"username": "e12345", "password": "corp-pass"}).status_code == 200
    assert store.session_user(c2.cookies.get(accounts.SESSION_COOKIE))["id"] == first["id"]   # 不分大小寫，同一個帳號
    with store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1


def test_ldap_account_has_no_usable_local_password(ldap_mode, monkeypatch):
    TestClient(app_module.app).post("/api/auth/login", json={"username": "bob", "password": "corp-pass"})
    assert store.authenticate("bob", "") is None
    assert store.authenticate("bob", "corp-pass") is None
    monkeypatch.setenv("AUTH_MODE", "system")   # 改回內建帳號：LDAP 帳號無法以任何密碼登入
    res = TestClient(app_module.app).post("/api/auth/login", json={"username": "bob", "password": "external$ldap"})
    assert res.status_code == 401


def test_ldap_reuses_existing_local_account_and_history(monkeypatch):
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": "carol", "password": "secret123"}).status_code == 200
    user = store.session_user(c.cookies.get(accounts.SESSION_COOKIE))
    store.add_history(user["id"], [{"id": "h1", "title": "舊簡報", "input": {}, "data": {"slides": []}}])

    monkeypatch.setenv("AUTH_MODE", "ldap")
    monkeypatch.setattr(accounts, "ldap_authenticate", lambda u, p: True)
    c2 = TestClient(app_module.app)
    assert c2.post("/api/auth/login", json={"username": "Carol", "password": "x"}).status_code == 200
    assert [h["id"] for h in c2.get("/api/history").json()] == ["h1"]


def test_ldap_wrong_password_counts_toward_lockout(ldap_mode):
    c = TestClient(app_module.app)
    res = c.post("/api/auth/login", json={"username": "alice", "password": "wrong"})
    assert res.status_code == 401 and "帳號或密碼錯誤" in res.json()["detail"]
    with store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM login_failures").fetchone()[0] == 1


def test_ldap_unavailable_is_503_and_not_a_failed_attempt(ldap_mode):
    c = TestClient(app_module.app)
    res = c.post("/api/auth/login", json={"username": "alice", "password": "down"})
    assert res.status_code == 503 and "LDAP" in res.json()["detail"]
    with store.connect() as conn:
        assert conn.execute("SELECT COUNT(*) FROM login_failures").fetchone()[0] == 0


@pytest.mark.parametrize("username", ["a*)(uid=*", "has space", "x" * 65, ""])
def test_ldap_rejects_unsafe_usernames_without_querying(ldap_mode, username):
    res = TestClient(app_module.app).post("/api/auth/login", json={"username": username, "password": "corp-pass"})
    assert res.status_code == 401
    assert ldap_mode == []


# ---------- ldap_auth：直接綁定與先搜尋再綁定 ----------
class FakeConn:
    def __init__(self, ok=True, entries=()):
        self.ok, self.entries, self.searches, self.result = ok, list(entries), [], {"description": "invalidCredentials"}

    def search(self, base, search_filter, **kw):
        self.searches.append((base, search_filter))

    def unbind(self):
        pass


def fake_ldap(monkeypatch, user_ok=True, service_ok=True, entries=("cn=Alice,ou=people,dc=corp",)):
    binds = []
    service = FakeConn(service_ok, [SimpleNamespace(entry_dn=dn) for dn in entries])

    def bind(server, user, password):
        binds.append((user, password))
        if user == os.getenv("LDAP_BIND_DN") or user is None:
            return service, service.ok
        return FakeConn(user_ok), user_ok

    monkeypatch.setattr(ldap_auth, "_server", lambda: object())
    monkeypatch.setattr(ldap_auth, "_bind", bind)
    return binds, service


def test_direct_bind_uses_escaped_template(monkeypatch):
    monkeypatch.setenv("LDAP_USER_DN_TEMPLATE", "{username}@corp.example.com")
    binds, _ = fake_ldap(monkeypatch)
    assert ldap_auth.ldap_authenticate("alice", "pw")
    assert binds == [("alice@corp.example.com", "pw")]


def test_empty_password_never_binds(monkeypatch):
    monkeypatch.setenv("LDAP_USER_DN_TEMPLATE", "{username}@corp.example.com")
    binds, _ = fake_ldap(monkeypatch)
    assert not ldap_auth.ldap_authenticate("alice", "")
    assert binds == []


def test_search_then_bind(monkeypatch):
    monkeypatch.delenv("LDAP_USER_DN_TEMPLATE", raising=False)
    monkeypatch.setenv("LDAP_SEARCH_BASE", "dc=corp")
    monkeypatch.setenv("LDAP_BIND_DN", "cn=svc,dc=corp")
    monkeypatch.setenv("LDAP_BIND_PASSWORD", "svc-pw")
    monkeypatch.setenv("LDAP_USER_FILTER", "(&(sAMAccountName={username})(memberOf=cn=rslide,dc=corp))")
    binds, service = fake_ldap(monkeypatch)
    assert ldap_auth.ldap_authenticate("alice", "pw")
    assert binds == [("cn=svc,dc=corp", "svc-pw"), ("cn=Alice,ou=people,dc=corp", "pw")]
    assert service.searches == [("dc=corp", "(&(sAMAccountName=alice)(memberOf=cn=rslide,dc=corp))")]


@pytest.mark.parametrize("entries", [(), ("cn=a,dc=corp", "cn=b,dc=corp")])
def test_search_requires_exactly_one_user(monkeypatch, entries):
    monkeypatch.delenv("LDAP_USER_DN_TEMPLATE", raising=False)
    monkeypatch.setenv("LDAP_SEARCH_BASE", "dc=corp")
    binds, _ = fake_ldap(monkeypatch, entries=entries)
    assert not ldap_auth.ldap_authenticate("alice", "pw")
    assert len(binds) == 1    # 只有服務帳號綁定，沒有拿密碼去試


def test_service_account_failure_is_unavailable(monkeypatch):
    monkeypatch.delenv("LDAP_USER_DN_TEMPLATE", raising=False)
    monkeypatch.setenv("LDAP_SEARCH_BASE", "dc=corp")
    monkeypatch.setenv("LDAP_BIND_DN", "cn=svc,dc=corp")
    fake_ldap(monkeypatch, service_ok=False)
    with pytest.raises(ldap_auth.LdapUnavailable):
        ldap_auth.ldap_authenticate("alice", "pw")


def test_unreachable_server_is_unavailable(monkeypatch):
    monkeypatch.setenv("LDAP_SERVER", "ldap://127.0.0.1:1")   # 沒有服務的連接埠，連線立即被拒
    monkeypatch.setenv("LDAP_USER_DN_TEMPLATE", "{username}@corp.example.com")
    monkeypatch.setenv("LDAP_TIMEOUT", "1")
    with pytest.raises(ldap_auth.LdapUnavailable):
        ldap_auth.ldap_authenticate("alice", "pw")


# ---------- 啟動時的設定檢查 ----------
@pytest.mark.parametrize("env, message", [
    ({"AUTH_MODE": "ad"}, "AUTH_MODE"),
    ({"AUTH_MODE": "ldap"}, "LDAP_SERVER"),
    ({"AUTH_MODE": "ldap", "LDAP_SERVER": "ldap://x"}, "LDAP_USER_DN_TEMPLATE"),
    ({"AUTH_MODE": "ldap", "LDAP_SERVER": "ldap://x", "LDAP_USER_DN_TEMPLATE": "uid=alice"}, "{username}"),
    ({"AUTH_MODE": "ldap", "LDAP_SERVER": "ldap://x", "LDAP_SEARCH_BASE": "dc=x", "LDAP_USER_FILTER": "(uid=x)"}, "LDAP_USER_FILTER"),
])
def test_check_config_rejects_incomplete_settings(monkeypatch, env, message):
    for k in ("LDAP_SERVER", "LDAP_USER_DN_TEMPLATE", "LDAP_SEARCH_BASE", "LDAP_USER_FILTER"):
        monkeypatch.delenv(k, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    with pytest.raises(ValueError, match=message.replace("{", r"\{").replace("}", r"\}")):
        ldap_auth.check_config()


def test_check_config_accepts_valid_settings(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "ldap")
    monkeypatch.setenv("LDAP_SERVER", "ldaps://ldap.example.com")
    monkeypatch.setenv("LDAP_USER_DN_TEMPLATE", "{username}@corp.example.com")
    ldap_auth.check_config()
    monkeypatch.setenv("AUTH_MODE", "system")
    ldap_auth.check_config()
