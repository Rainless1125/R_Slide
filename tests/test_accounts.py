import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setenv("RSLIDE_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("ALLOW_REGISTRATION", raising=False)


def new_client(username="alice", password="secret123"):
    c = TestClient(app_module.app)
    res = c.post("/api/auth/register", json={"username": username, "password": password})
    assert res.status_code == 200, res.text
    return c


def item(id="a1", title="簡報", slides=2, **kw):
    base = {"id": id, "title": title, "input": {"content": "素材", "num_pages": slides},
            "data": {"presentation_title": title, "slides": [{"page_number": i + 1} for i in range(slides)]}}
    base.update(kw)
    return base


def test_password_hash_roundtrip():
    h = store.hash_password("pw-123456")
    assert h.startswith("scrypt$") and "pw-123456" not in h
    assert store.verify_password("pw-123456", h)
    assert not store.verify_password("wrong", h)
    assert not store.verify_password("x", "garbage")


def test_register_login_logout():
    c = new_client()
    assert c.get("/api/auth/me").json()["username"] == "alice"
    assert c.post("/api/auth/logout").status_code == 200
    assert c.get("/api/auth/me").json()["username"] is None

    assert c.post("/api/auth/login", json={"username": "alice", "password": "nope"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "nobody", "password": "secret123"}).status_code == 401
    res = c.post("/api/auth/login", json={"username": "ALICE", "password": "secret123"})  # 帳號不分大小寫
    assert res.status_code == 200 and res.json()["username"] == "alice"


def test_register_validation():
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": "a", "password": "secret123"}).status_code == 400
    assert c.post("/api/auth/register", json={"username": "has space", "password": "secret123"}).status_code == 400
    assert c.post("/api/auth/register", json={"username": "bob", "password": "123"}).status_code == 400
    new_client("bob")
    assert c.post("/api/auth/register", json={"username": "Bob", "password": "secret123"}).status_code == 409


def test_registration_can_be_disabled(monkeypatch):
    monkeypatch.setenv("ALLOW_REGISTRATION", "false")
    c = TestClient(app_module.app)
    assert c.get("/api/auth/me").json()["allow_registration"] is False
    assert c.post("/api/auth/register", json={"username": "carol", "password": "secret123"}).status_code == 403


def test_history_requires_login():
    c = TestClient(app_module.app)
    assert c.get("/api/history").status_code == 401
    assert c.post("/api/history", json=item()).status_code == 401
    c.cookies.set("rslide_session", "forged")
    assert c.get("/api/history").status_code == 401


def test_history_crud():
    c = new_client()
    assert c.get("/api/history").json() == []
    assert c.post("/api/history", json=item("a1", "第一份", createdAt=1000)).status_code == 200
    assert c.post("/api/history", json=item("b2", "第二份", slides=3, createdAt=2000)).status_code == 200

    lst = c.get("/api/history").json()
    assert [h["id"] for h in lst] == ["b2", "a1"]                 # 新的在前
    assert lst[0]["pages"] == 3 and "data" not in lst[0]          # 列表只有摘要
    assert lst[0]["input"]["content"] == "素材"

    full = c.get("/api/history/a1").json()
    assert full["data"]["presentation_title"] == "第一份"

    new_data = {"presentation_title": "改過", "slides": [{"page_number": 1}]}
    assert c.patch("/api/history/a1", json={"title": "改名", "data": new_data}).status_code == 200
    full = c.get("/api/history/a1").json()
    assert full["title"] == "改名" and full["pages"] == 1 and full["data"] == new_data
    assert c.patch("/api/history/zz", json={"title": "x"}).status_code == 404

    assert c.delete("/api/history/a1").status_code == 200
    assert c.get("/api/history/a1").status_code == 404
    assert c.delete("/api/history").status_code == 200
    assert c.get("/api/history").json() == []


def test_history_is_per_user():
    alice, bob = new_client("alice"), new_client("bob")
    alice.post("/api/history", json=item("same", "Alice 的"))
    bob.post("/api/history", json=item("same", "Bob 的"))           # 不同使用者可用相同 id

    assert [h["title"] for h in alice.get("/api/history").json()] == ["Alice 的"]
    assert bob.get("/api/history/same").json()["title"] == "Bob 的"
    bob.delete("/api/history")
    assert alice.get("/api/history/same").status_code == 200


def test_history_import_and_trim(monkeypatch):
    monkeypatch.setattr(store, "MAX_HISTORY_PER_USER", 3)
    c = new_client()
    items = [item(f"i{n}", f"舊紀錄{n}", createdAt=n) for n in range(1, 4)]
    res = c.post("/api/history/import", json={"items": items})
    assert res.json() == {"imported": 3}
    c.post("/api/history", json=item("new", "新的", createdAt=99))
    assert [h["id"] for h in c.get("/api/history").json()] == ["new", "i3", "i2"]   # 超過上限時刪最舊的


def test_history_rejects_bad_payload():
    c = new_client()
    assert c.post("/api/history", json=item(id="../x")).status_code == 400
    assert c.post("/api/history", json={"id": "a"}).status_code == 400
    assert c.post("/api/history", content=b"not json",
                  headers={"content-type": "application/json"}).status_code == 400
    assert c.patch("/api/history/a1", json={"title": ""}).status_code == 400


def test_password_reset_revokes_sessions():
    c = new_client()
    assert store.set_password("alice", "newpass99")
    assert c.get("/api/history").status_code == 401
    assert c.post("/api/auth/login", json={"username": "alice", "password": "newpass99"}).status_code == 200
    assert not store.set_password("ghost", "whatever1")
