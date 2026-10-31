import os

import anyio.to_thread
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")

import app as app_module  # noqa: E402


def test_startup_raises_thread_limit(monkeypatch):
    monkeypatch.setenv("THREAD_POOL_SIZE", "123")
    seen = {}

    @app_module.app.get("/__thread_limit")
    async def thread_limit():
        seen["total"] = anyio.to_thread.current_default_thread_limiter().total_tokens
        return {}

    try:
        with TestClient(app_module.app) as client:
            client.get("/__thread_limit")
    finally:
        app_module.app.router.routes.pop()
    assert seen["total"] == 123


def test_thread_pool_size_bounds(monkeypatch):
    monkeypatch.delenv("THREAD_POOL_SIZE", raising=False)
    assert app_module.thread_pool_size() == 200
    monkeypatch.setenv("THREAD_POOL_SIZE", "5")
    assert app_module.thread_pool_size() == 40
    monkeypatch.setenv("THREAD_POOL_SIZE", "abc")
    assert app_module.thread_pool_size() == 200
