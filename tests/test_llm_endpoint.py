"""OpenAI 相容端點（OPENAI_BASE_URL / OPENAI_MODELS）與呼叫 LLM 時附加的標頭（LLM_EXTRA_HEADERS）。"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
from app import parse_extra_headers  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def test_extra_headers_parsing():
    assert parse_extra_headers(None) == {}
    assert parse_extra_headers("  ") == {}
    assert parse_extra_headers('{"system_name": "R_Slide", "use_area": "F12", "site": 3}') == \
        {"system_name": "R_Slide", "use_area": "F12", "site": "3"}


@pytest.mark.parametrize("value, message", [
    ("system_name=R_Slide", "JSON 物件"),
    ('["R_Slide"]', "JSON 物件"),
    ('{"use_area": "研發部"}', "不支援中文"),
    ('{"use area": "F12"}', "標頭名稱"),
    ('{"use_area": {"a": 1}}', "文字或數字"),
    ('{"use_area": "F12\\r\\nX-Evil: 1"}', "只能使用英數字"),
])
def test_invalid_extra_headers_are_rejected(value, message):
    with pytest.raises(ValueError) as e:
        parse_extra_headers(value)
    assert message in str(e.value)


def test_rejects_unlisted_openai_model():
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("openai", "gpt-unknown", "sys", "prompt", app_module.SlideImageReadings, 0.2)
    assert e.value.status_code == 400


class _Gateway(BaseHTTPRequestHandler):
    """假的 OpenAI 相容端點：記錄請求的標頭；第一次拒絕結構化輸出，驗證會改用提示詞附 schema 的方式。"""
    requests = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        type(self).requests.append({"path": self.path, "headers": dict(self.headers), "body": body})
        if "response_format" in body:
            self._send(400, {"error": {"message": "response_format json_schema is not supported", "type": "invalid_request_error"}})
            return
        self._send(200, {"id": "x", "object": "chat.completion", "created": 0, "model": body["model"],
                         "choices": [{"index": 0, "finish_reason": "stop",
                                      "message": {"role": "assistant", "content": '{"images": []}'}}]})

    def _send(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


def test_openai_compatible_endpoint_with_extra_headers():
    """以獨立行程載入 app（設定在啟動時讀取），呼叫本機的假端點。"""
    _Gateway.requests = []
    server = HTTPServer(("127.0.0.1", 0), _Gateway)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    env = {**os.environ, "OPENAI_API_KEY": "internal", "OPENAI_BASE_URL": f"http://127.0.0.1:{server.server_port}/v1/",
           "OPENAI_MODELS": "corp-llm-large, corp-llm-small",
           "LLM_EXTRA_HEADERS": '{"system_name": "R_Slide", "use_area": "F12"}', "NO_PROXY": "127.0.0.1"}
    code = """
import json, app
from fastapi.testclient import TestClient
print(json.dumps({
    "catalog": TestClient(app.app).get("/api/models").json()["openai"],
    "reply": app.call_llm("openai", "", "sys", "prompt", app.SlideImageReadings, 0.2),
    "gemini_headers": app.gemini_client._api_client._http_options.headers,
}))
"""
    try:
        out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    finally:
        server.shutdown()
    assert out.returncode == 0, out.stderr[-2000:]
    result = json.loads(out.stdout.strip().splitlines()[-1])
    assert result["catalog"] == {"available": True, "models": ["corp-llm-large", "corp-llm-small"]}
    assert result["reply"] == {"images": []}                         # 不支援結構化輸出時改用提示詞附 schema
    assert [r["path"] for r in _Gateway.requests] == ["/v1/chat/completions"] * 2
    assert all(r["body"]["model"] == "corp-llm-large" for r in _Gateway.requests)   # 未指定時用清單第一個
    for r in _Gateway.requests:
        headers = {k.lower(): v for k, v in r["headers"].items()}
        assert headers["system_name"] == "R_Slide" and headers["use_area"] == "F12"
    assert result["gemini_headers"]["system_name"] == "R_Slide"


def test_invalid_extra_headers_stop_startup():
    env = {**os.environ, "LLM_EXTRA_HEADERS": '{"use_area": "研發部"}'}
    out = subprocess.run([sys.executable, "-c", "import app"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert out.returncode != 0 and "不支援中文" in out.stderr
