import os
import re
from pathlib import Path

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

from app import MODEL_CATALOG  # noqa: E402

GENERATE_JS = Path(__file__).resolve().parent.parent / "static" / "app" / "generate.js"


def test_frontend_fallback_models_match_backend_catalog():
    """/api/models 失敗時前端改用 generate.js 內建的備用清單，必須與後端一致。"""
    block = re.search(r"let modelCatalog = \{(.*?)\n\};", GENERATE_JS.read_text(encoding="utf-8"), re.S).group(1)
    for provider in ("gemini", "openai"):
        models = re.search(rf"{provider}: \{{ models: \[(.*?)\] \}}", block).group(1)
        assert re.findall(r"'([^']+)'", models) == MODEL_CATALOG[provider]


def test_parse_model_aliases():
    from app import MAX_MODEL_ALIAS_CHARS, parse_model_aliases
    assert parse_model_aliases(None) == {}
    assert parse_model_aliases(" gemini-3.8-flash = 高效能模型 ,gemini-3.5-flash=經濟模型,壞掉的項目,=沒有模型,x=") == {
        "gemini-3.8-flash": "高效能模型", "gemini-3.5-flash": "經濟模型"}
    assert len(parse_model_aliases("m=" + "字" * 50)["m"]) == MAX_MODEL_ALIAS_CHARS


def test_models_api_returns_aliases_and_hide_option(monkeypatch):
    """MODEL_ALIASES 只回傳清單中的模型；HIDE_SINGLE_MODEL 以 options 告訴前端（每次讀取環境變數）。"""
    from fastapi.testclient import TestClient
    import app as app_module
    monkeypatch.setattr(app_module, "MODEL_ALIASES", {"gemini-3.8-flash": "高效能模型", "not-in-catalog": "x"})
    client = TestClient(app_module.app)
    monkeypatch.delenv("HIDE_SINGLE_MODEL", raising=False)
    data = client.get("/api/models").json()
    assert data["gemini"]["labels"] == {"gemini-3.8-flash": "高效能模型"}
    assert data["gemini"]["models"] == MODEL_CATALOG["gemini"]            # 送出時仍使用實際的模型名稱
    assert data["openai"]["labels"] == {}
    assert data["options"] == {"hide_single_model": False}
    monkeypatch.setenv("HIDE_SINGLE_MODEL", "true")
    assert client.get("/api/models").json()["options"] == {"hide_single_model": True}
