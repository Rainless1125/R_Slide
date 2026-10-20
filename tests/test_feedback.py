"""意見回饋：登入後可送出一段文字，寫入 feedback 資料表，並可用 manage_users.py feedback 查看。"""
from fastapi.testclient import TestClient

import app as app_module
import manage_users
import store


def new_client(username="alice"):
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": username, "password": "secret123"}).status_code == 200
    return c


def test_feedback_requires_login():
    res = TestClient(app_module.app).post("/api/feedback", json={"content": "很好用"})
    assert res.status_code == 401
    assert store.list_feedback(0) == []


def test_feedback_is_saved_with_username():
    res = new_client().post("/api/feedback", json={"content": "  希望可以匯出可編輯的 PPTX\n謝謝  "})
    assert res.status_code == 200
    [row] = store.list_feedback(0)
    assert row["username"] == "alice" and row["content"] == "希望可以匯出可編輯的 PPTX\n謝謝"


def test_feedback_rejects_empty_and_too_long():
    c = new_client()
    assert c.post("/api/feedback", json={"content": "   "}).status_code == 400
    assert c.post("/api/feedback", json={"content": "字" * (store.MAX_FEEDBACK_CHARS + 1)}).status_code == 422
    assert c.post("/api/feedback", json={"content": "字" * store.MAX_FEEDBACK_CHARS}).status_code == 200
    assert len(store.list_feedback(0)) == 1


def test_feedback_rate_limit_is_per_user():
    a = new_client("alice")
    for i in range(store.FEEDBACK_RATE_LIMIT):
        assert a.post("/api/feedback", json={"content": f"第 {i} 則"}).status_code == 200
    assert a.post("/api/feedback", json={"content": "太多了"}).status_code == 429
    assert new_client("bob").post("/api/feedback", json={"content": "我還可以送"}).status_code == 200
    assert len(store.list_feedback(0)) == store.FEEDBACK_RATE_LIMIT + 1


def test_manage_users_feedback_lists_newest_first(capsys):
    new_client("alice").post("/api/feedback", json={"content": "第一則"})
    new_client("bob").post("/api/feedback", json={"content": "第二則\n第二行"})
    manage_users.main(["feedback"])
    out = capsys.readouterr().out
    assert "共 2 則" in out and out.index("第二則") < out.index("第一則") and "  第二行" in out
    manage_users.main(["feedback", "ALICE", "--days", "7"])
    out = capsys.readouterr().out
    assert "第一則" in out and "第二則" not in out
