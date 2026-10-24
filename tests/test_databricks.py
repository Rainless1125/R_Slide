import os
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException
from openai import BadRequestError
from pydantic import BaseModel

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402


class Reply(BaseModel):
    title: str
    count: int


def bad_request():
    request = httpx.Request("POST", "https://example.cloud.databricks.com/serving-endpoints/chat/completions")
    return BadRequestError("response_format not supported", response=httpx.Response(400, request=request), body=None)


class FakeClient:
    """模擬 OpenAI SDK：parse 走結構化輸出，create 走提示詞附 schema 的備援。"""

    def __init__(self, parse_result=None, parse_error=None, create_text=""):
        self.calls = []

        def parse(**kwargs):
            self.calls.append(("parse", kwargs))
            if parse_error:
                raise parse_error
            return parse_result

        def create(**kwargs):
            self.calls.append(("create", kwargs))
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=create_text))])

        self.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)))
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))


def use_databricks(monkeypatch, client, models=("system.ai.model-a", "system.ai.model-b")):
    monkeypatch.setattr(app_module, "databricks_client", client)
    monkeypatch.setitem(app_module.MODEL_CATALOG, "databricks", list(models))


def test_parse_model_list():
    assert app_module.parse_model_list(" a, b ,,a ,c ") == ["a", "b", "c"]
    assert app_module.parse_model_list(None) == []


@pytest.mark.parametrize("host, base_url, expected", [
    ("https://adb-1.azuredatabricks.net/", None, "https://adb-1.azuredatabricks.net/serving-endpoints"),
    ("dbc-1.cloud.databricks.com", "", "https://dbc-1.cloud.databricks.com/serving-endpoints"),
    ("https://x.cloud.databricks.com", "https://x.cloud.databricks.com/ai-gateway/mlflow/v1/",
     "https://x.cloud.databricks.com/ai-gateway/mlflow/v1"),
    (None, None, None),
])
def test_databricks_base_url(host, base_url, expected):
    assert app_module.databricks_base_url(host, base_url) == expected


def test_structured_output_used_when_supported(monkeypatch):
    parsed = SimpleNamespace(refusal=None, parsed=Reply(title="t", count=2), content="")
    client = FakeClient(parse_result=SimpleNamespace(choices=[SimpleNamespace(message=parsed)]))
    use_databricks(monkeypatch, client)
    data = app_module.call_llm("databricks", "", "sys", "prompt", Reply, 0.6)
    assert data == {"title": "t", "count": 2}
    assert [c[0] for c in client.calls] == ["parse"]
    assert client.calls[0][1]["model"] == "system.ai.model-a"  # 未指定時使用清單第一個


def test_falls_back_to_prompted_json_when_schema_rejected(monkeypatch):
    client = FakeClient(parse_error=bad_request(),
                        create_text='好的：\n```json\n{"title": "簡報", "count": 3}\n```')
    use_databricks(monkeypatch, client)
    data = app_module.call_llm("databricks", "system.ai.model-b", "sys", "prompt", Reply, 0.6)
    assert data == {"title": "簡報", "count": 3}
    kind, kwargs = client.calls[-1]
    assert kind == "create" and kwargs["model"] == "system.ai.model-b"
    assert '"count"' in kwargs["messages"][0]["content"]  # schema 附在系統提示詞中


def test_openai_does_not_fall_back(monkeypatch):
    client = FakeClient(parse_error=bad_request())
    monkeypatch.setattr(app_module, "openai_client", client)
    with pytest.raises(BadRequestError):
        app_module.call_llm("openai", "gpt-6-luna", "sys", "prompt", Reply, 0.6)


def test_rejects_unlisted_databricks_model(monkeypatch):
    use_databricks(monkeypatch, FakeClient())
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("databricks", "system.ai.secret-expensive", "sys", "prompt", Reply, 0.6)
    assert e.value.status_code == 400


def test_unconfigured_databricks(monkeypatch):
    monkeypatch.setattr(app_module, "databricks_client", None)
    with pytest.raises(HTTPException) as e:
        app_module.call_llm("databricks", "", "sys", "prompt", Reply, 0.6)
    assert "DATABRICKS_TOKEN" in e.value.detail


def test_models_endpoint_lists_databricks(monkeypatch):
    from fastapi.testclient import TestClient
    use_databricks(monkeypatch, FakeClient())
    data = TestClient(app_module.app).get("/api/models").json()
    assert data["databricks"] == {"available": True, "models": ["system.ai.model-a", "system.ai.model-b"]}
