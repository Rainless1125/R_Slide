import os

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    """每個測試使用各自的暫存資料庫，不會寫到 data/rslide.db。"""
    monkeypatch.setenv("RSLIDE_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.delenv("ALLOW_REGISTRATION", raising=False)
    monkeypatch.delenv("AUTH_MODE", raising=False)
    # 其他測試會從同一個 IP 註冊多個帳號；註冊次數限制只在 test_register_limit.py 測試（該檔會移除這個設定）
    monkeypatch.setenv("REGISTER_LIMIT_PER_IP_PER_DAY", "0")


TEST_USER = {"id": 1, "username": "tester"}


@pytest.fixture
def logged_in():
    """略過登入：生成類 API 需要登入，只測生成邏輯的測試以固定使用者代替。"""
    import app as app_module
    from accounts import current_user

    app_module.app.dependency_overrides[current_user] = lambda: TEST_USER
    yield TEST_USER
    app_module.app.dependency_overrides.pop(current_user, None)
