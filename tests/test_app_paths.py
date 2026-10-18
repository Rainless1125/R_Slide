import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_serves_static_files_when_started_from_another_directory(tmp_path):
    """靜態檔路徑以 app.py 所在位置為基準，不受啟動時的工作目錄影響。"""
    code = ("from fastapi.testclient import TestClient; import app; c = TestClient(app.app); "
            "print(c.get('/').status_code, c.get('/static/favicon.svg').status_code, c.get('/favicon.ico').status_code)")
    env = {**os.environ, "GEMINI_API_KEY": "test-key", "PYTHONPATH": str(ROOT)}
    out = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env=env, capture_output=True, text=True, check=True)
    assert out.stdout.split() == ["200", "200", "200"]
