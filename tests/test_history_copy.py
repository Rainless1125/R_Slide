"""歷史記錄「複製給其他帳號」：對方多一筆獨立的紀錄（新的 id、標示來源帳號），之後各自修改互不影響。"""
from fastapi.testclient import TestClient

import app as app_module
import store

DECK = {"presentation_title": "季度報告", "slides": [{"slide_title": "第一頁"}, {"slide_title": "第二頁"}]}
INPUT = {"content": "素材", "deck_mode": "document"}


def new_client(username):
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": username, "password": "secret123"}).status_code == 200
    return c


def add_item(c, item_id="deck1", title="季度報告"):
    assert c.post("/api/history", json={"id": item_id, "title": title, "input": INPUT, "data": DECK}).status_code == 200


def test_copy_creates_independent_item_for_target():
    alice, bob = new_client("alice"), new_client("Bob")
    add_item(alice)
    res = alice.post("/api/history/deck1/copy", json={"username": "  bob "})     # 帳號不分大小寫、前後空白忽略
    assert res.status_code == 200 and res.json()["username"] == "Bob"

    [summary] = bob.get("/api/history").json()
    assert summary["id"] != "deck1" and summary["title"] == "季度報告"
    assert summary["sharedFrom"] == "alice" and summary["pages"] == 2 and summary["input"] == INPUT
    assert bob.get(f"/api/history/{summary['id']}").json()["data"] == DECK

    # 兩份各自獨立：Bob 修改自己的，Alice 的不變
    edited = {**DECK, "presentation_title": "季度報告（Bob 修改）"}
    assert bob.patch(f"/api/history/{summary['id']}", json={"title": "Bob 版", "data": edited}).status_code == 200
    assert alice.get("/api/history/deck1").json()["data"] == DECK
    assert [h["sharedFrom"] for h in alice.get("/api/history").json()] == [None]

    # 再複製回去：Alice 多一筆來自 Bob 的紀錄，原本的保留
    assert bob.post(f"/api/history/{summary['id']}/copy", json={"username": "alice"}).status_code == 200
    items = alice.get("/api/history").json()
    assert [(h["title"], h["sharedFrom"]) for h in items] == [("Bob 版", "Bob"), ("季度報告", None)]
    assert alice.get(f"/api/history/{items[0]['id']}").json()["data"] == edited


def test_copy_errors():
    alice = new_client("alice")
    add_item(alice)
    assert alice.post("/api/history/deck1/copy", json={"username": "nobody"}).status_code == 404
    assert alice.post("/api/history/deck1/copy", json={"username": "ALICE"}).status_code == 400
    assert alice.post("/api/history/deck1/copy", json={"username": "  "}).status_code == 400
    new_client("bob")
    assert alice.post("/api/history/missing/copy", json={"username": "bob"}).status_code == 404
    assert TestClient(app_module.app).post("/api/history/deck1/copy", json={"username": "bob"}).status_code == 401


def test_cannot_copy_other_users_item():
    alice, bob = new_client("alice"), new_client("bob")
    add_item(alice)
    new_client("carol")
    assert bob.post("/api/history/deck1/copy", json={"username": "carol"}).status_code == 404


def test_copy_rate_limit(monkeypatch):
    monkeypatch.setattr(store, "HISTORY_COPY_LIMIT_PER_HOUR", 2)
    alice, bob = new_client("alice"), new_client("bob")
    add_item(alice)
    for _ in range(2):
        assert alice.post("/api/history/deck1/copy", json={"username": "bob"}).status_code == 200
    res = alice.post("/api/history/deck1/copy", json={"username": "bob"})
    assert res.status_code == 429 and "Retry-After" in res.headers
    # 對方刪除收到的紀錄不會讓次數歸還
    assert bob.delete("/api/history").status_code == 200
    assert alice.post("/api/history/deck1/copy", json={"username": "bob"}).status_code == 429
    assert len(bob.get("/api/history").json()) == 0


def test_migration_adds_shared_from_column(tmp_path, monkeypatch):
    import sqlite3
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE history (user_id INTEGER NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL, "
                     "input_json TEXT NOT NULL, data_json TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 0, "
                     "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id))")
        conn.execute("INSERT INTO history VALUES (1, 'a', 't', '{}', '{}', 0, 1, 1)")
    monkeypatch.setenv("RSLIDE_DB_PATH", str(path))
    assert store.list_history(1) == [{"id": "a", "title": "t", "createdAt": 1, "pages": 0, "input": {}, "sharedFrom": None}]
