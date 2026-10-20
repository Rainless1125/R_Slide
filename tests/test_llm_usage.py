"""LLM 使用紀錄：生成類 API 需要登入，每次呼叫（含失敗）都會寫入 llm_usage，可依使用者統計用量。"""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

import app as app_module
import manage_users
import store

SLIDE = {"page_number": 1, "layout_concept": "KPI", "slide_title": "營收", "html_content": "<div></div>",
         "charts": [], "speaker_notes": "x"}


def new_client(username="alice"):
    c = TestClient(app_module.app)
    assert c.post("/api/auth/register", json={"username": username, "password": "secret123"}).status_code == 200
    return c


def fake_llm(monkeypatch, result=None, error=None, tokens=(100, 50)):
    calls = []

    def fake(provider, model, system_instruction, prompt, schema, temperature, usage=None):
        calls.append(provider)
        usage.update(provider=provider, model=model or "default-model",
                     **app_module.token_usage(*tokens))
        if error:
            raise error
        return dict(result or {"presentation_title": "t", "slides": [SLIDE, SLIDE]})

    monkeypatch.setattr(app_module, "call_llm", fake)
    return calls


def usage_rows():
    with store.connect() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM llm_usage ORDER BY id").fetchall()]


def test_llm_endpoints_require_login(monkeypatch):
    calls = fake_llm(monkeypatch)
    c = TestClient(app_module.app)
    assert c.post("/api/generate", json={"content": "素材"}).status_code == 401
    assert c.post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE]}).status_code == 401
    assert calls == [] and usage_rows() == []


def test_generate_logs_usage_without_storing_content(monkeypatch):
    fake_llm(monkeypatch)
    c = new_client()
    res = c.post("/api/generate", json={"content": "機密素材內容", "num_pages": 4, "deck_mode": "document",
                                        "provider": "openai", "model": "gpt-x"})
    assert res.status_code == 200
    [row] = usage_rows()
    assert row["username"] == "alice" and row["action"] == "generate"
    assert (row["provider"], row["model"], row["deck_mode"], row["num_pages"]) == ("openai", "gpt-x", "document", 4)
    assert (row["input_tokens"], row["output_tokens"], row["total_tokens"]) == (100, 50, 150)
    assert row["slides_returned"] == 2 and row["status"] == "ok" and row["http_status"] == 200
    assert row["input_chars"] == len("機密素材內容") and len(row["content_hash"]) == 64
    assert row["latency_ms"] >= 0 and row["client_ip"]
    assert "機密素材內容" not in str(row)   # 不存素材原文


def test_failed_call_is_logged_with_tokens_already_used(monkeypatch):
    fake_llm(monkeypatch, error=HTTPException(status_code=502, detail="AI 輸出超過長度上限（MAX_TOKENS）"))
    res = new_client().post("/api/generate", json={"content": "素材"})
    assert res.status_code == 502
    [row] = usage_rows()
    assert row["status"] == "error" and row["http_status"] == 502 and "MAX_TOKENS" in row["error"]
    assert row["total_tokens"] == 150 and row["slides_returned"] is None


def test_unexpected_error_is_logged_as_500(monkeypatch):
    fake_llm(monkeypatch, error=RuntimeError("boom"))
    assert new_client().post("/api/generate", json={"content": "素材"}).status_code == 500
    [row] = usage_rows()
    assert row["http_status"] == 500 and row["error"] == "boom"


def test_regenerate_is_logged(monkeypatch):
    fake_llm(monkeypatch, result=SLIDE)
    res = new_client().post("/api/regenerate-slide", json={"content": "素材", "slide_index": 0, "slides": [SLIDE]})
    assert res.status_code == 200
    [row] = usage_rows()
    assert row["action"] == "regenerate" and row["slides_returned"] == 1


def test_logging_failure_does_not_break_generation(monkeypatch):
    fake_llm(monkeypatch)

    def broken(entry):
        raise RuntimeError("disk full")

    monkeypatch.setattr(store, "finish_llm_call", broken)
    assert new_client().post("/api/generate", json={"content": "素材"}).status_code == 200


# ===================== 各平台的 token 數 =====================
def test_gemini_usage():
    response = SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=10, candidates_token_count=5, total_token_count=16,
        cached_content_token_count=None, thoughts_token_count=1))
    assert app_module.gemini_usage(response) == {"input_tokens": 10, "output_tokens": 5, "total_tokens": 16,
                                                 "cached_tokens": None, "reasoning_tokens": 1}
    assert app_module.gemini_usage(SimpleNamespace()) == {}


def test_openai_usage_computes_missing_total():
    completion = SimpleNamespace(usage=SimpleNamespace(prompt_tokens=7, completion_tokens=3, total_tokens=None))
    assert app_module.openai_usage(completion)["total_tokens"] == 10
    assert app_module.openai_usage(SimpleNamespace(usage=None)) == {}   # Databricks 部分模型不回傳 usage


class Reply(BaseModel):
    title: str


def test_call_llm_fills_usage_for_databricks_fallback(monkeypatch):
    import httpx
    from openai import BadRequestError

    def parse(**kwargs):
        request = httpx.Request("POST", "https://example.com")
        raise BadRequestError("unsupported", response=httpx.Response(400, request=request), body=None)

    def create(**kwargs):
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"title": "ok"}'))],
                               usage=SimpleNamespace(prompt_tokens=20, completion_tokens=8, total_tokens=28))

    client = SimpleNamespace(beta=SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse))),
                             chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(app_module, "databricks_client", client)
    monkeypatch.setitem(app_module.MODEL_CATALOG, "databricks", ["system.ai.model-a"])
    usage = {}
    assert app_module.call_llm("databricks", "", "sys", "prompt", Reply, 0.6, usage) == {"title": "ok"}
    assert usage["model"] == "system.ai.model-a" and usage["fallback"] == 1 and usage["total_tokens"] == 28


# ===================== 查詢與保留期限 =====================
def log(user_id, username, created_at=None, **kw):
    entry = {"user_id": user_id, "username": username, "action": "generate", "provider": "gemini", "model": "m",
             "input_chars": 10, "content_hash": "h1", "input_tokens": 100, "output_tokens": 50,
             "total_tokens": 150, "status": "ok", **kw}
    if created_at is not None:
        entry["created_at"] = created_at
    store.log_llm_usage(entry)


def test_usage_by_user_sorts_by_tokens_and_counts_repeated_content():
    alice = store.create_user("alice", "secret123")
    bob = store.create_user("bob", "secret123")
    log(alice["id"], "alice")
    for _ in range(3):
        log(bob["id"], "bob")                                   # 同一份素材生成 3 次
    log(bob["id"], "bob", action="regenerate")                  # 重產沿用原素材，不算重複
    log(bob["id"], "bob", status="error", input_tokens=None, output_tokens=None, total_tokens=None)
    rows = store.usage_by_user(0)
    assert [r["username"] for r in rows] == ["bob", "alice"]
    assert rows[0]["calls"] == 5 and rows[0]["errors"] == 1 and rows[0]["regenerates"] == 1
    assert rows[0]["total_tokens"] == 600 and rows[0]["max_same_content"] == 4   # 失敗的生成也算
    assert rows[1]["max_same_content"] == 1


def test_usage_by_user_respects_since_and_keeps_deleted_users():
    log(99, "ghost")                                            # 帳號已刪除，仍以紀錄中的名稱顯示
    log(99, "ghost", created_at=1000)
    [row] = store.usage_by_user(store.now_ms() - store.DAY_MS)
    assert row["username"] == "ghost" and row["calls"] == 1


def test_usage_by_day_groups_by_model():
    alice = store.create_user("alice", "secret123")
    log(alice["id"], "alice", model="a")
    log(alice["id"], "alice", model="a")
    log(alice["id"], "alice", model="b", total_tokens=10)
    rows = store.usage_by_day("ALICE", 0)
    assert {(r["model"], r["calls"], r["total_tokens"]) for r in rows} == {("a", 2, 300), ("b", 1, 10)}
    assert store.usage_by_day("nobody", 0) == []


def test_old_usage_is_purged(monkeypatch):
    monkeypatch.setenv("LLM_USAGE_RETENTION_DAYS", "30")
    log(1, "a", created_at=store.now_ms() - 31 * store.DAY_MS)
    log(1, "a")
    assert len(usage_rows()) == 1
    monkeypatch.setenv("LLM_USAGE_RETENTION_DAYS", "0")         # 0 = 永久保留
    log(1, "a", created_at=1000)
    log(1, "a")
    assert len(usage_rows()) == 3


def test_manage_users_usage_command(capsys):
    alice = store.create_user("alice", "secret123")
    log(alice["id"], "alice", total_tokens=1234)
    manage_users.main(["usage", "--days", "7"])
    out = capsys.readouterr().out
    assert "alice" in out and "1,234" in out
    manage_users.main(["usage", "alice"])
    assert "1,234" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        manage_users.main(["usage", "--days", "x"])
