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
