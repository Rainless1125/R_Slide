import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from google.genai import types

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

from app import gemini_response_text  # noqa: E402


def reply(text=None, finish=None, block=None):
    return SimpleNamespace(
        text=text,
        prompt_feedback=SimpleNamespace(block_reason=block) if block else None,
        candidates=[SimpleNamespace(finish_reason=finish)] if finish else [],
    )


def test_returns_text():
    assert gemini_response_text(reply('{"a": 1}', types.FinishReason.STOP)) == '{"a": 1}'


@pytest.mark.parametrize("response, expected", [
    (reply(block=types.BlockedReason.SAFETY), "拒絕回應"),
    (reply(finish=types.FinishReason.SAFETY), "拒絕回應"),
    (reply('{"slides": [', types.FinishReason.MAX_TOKENS), "MAX_TOKENS"),   # 截斷的 JSON 不可當成格式錯誤
    (reply(), "沒有回傳內容"),
])
def test_explains_missing_or_unusable_output(response, expected):
    with pytest.raises(HTTPException) as e:
        gemini_response_text(response)
    assert e.value.status_code == 502
    assert expected in e.value.detail
