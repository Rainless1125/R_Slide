import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import store  # noqa: E402
from app import app  # noqa: E402
from test_extract import make_pdf  # noqa: E402

client = TestClient(app)
pytestmark = pytest.mark.usefixtures("logged_in")


def scan_pdf(blank=False) -> bytes:
    """只有一張圖片、沒有文字層的 PDF（模擬掃描檔）。"""
    im = Image.new("RGB", (850, 1100), "white")
    if not blank:
        draw = ImageDraw.Draw(im)
        draw.rectangle((80, 80, 770, 200), fill="black")
        for y in range(300, 1000, 60):
            draw.line((80, y, 700, y), fill="gray", width=12)
    buf = io.BytesIO()
    im.save(buf, "PDF", resolution=100)
    return buf.getvalue()


def merge(*pdfs: bytes) -> bytes:
    writer = PdfWriter()
    for data in pdfs:
        for page in PdfReader(io.BytesIO(data)).pages:
            writer.add_page(page)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


@pytest.fixture
def fake_vision(monkeypatch):
    calls = []

    def fake(provider, model, system, prompt, schema, temperature, usage=None, images=None):
        calls.append({"prompt": prompt, "images": images})
        if usage is not None:
            usage.update(provider=provider, model=model or "fake", total_tokens=500)
        page = prompt.split("第 ")[1].split(" 頁")[0]
        return {"images": [{"kind": "text", "content": f"掃描頁內容 P{page}"}]}

    monkeypatch.setattr(app_module, "call_llm", fake)
    return calls


def upload(data: bytes, **form):
    return client.post("/api/extract", files={"file": ("scan.pdf", data)}, data=form)


def test_scanned_pdf_is_read_by_ai(fake_vision):
    res = upload(scan_pdf())
    assert res.status_code == 200
    body = res.json()
    assert body["text"] == "【第 1 頁（AI 辨識）】\n掃描頁內容 P1"
    assert body["images"] == 1 and body["images_read"] == 1
    image, mime = fake_vision[0]["images"][0]
    assert mime == "image/jpeg"
    assert max(Image.open(io.BytesIO(image)).size) == 2000


def test_mixed_pdf_only_sends_scanned_pages_in_page_order(fake_vision):
    data = merge(make_pdf([["Quarterly revenue grew 12 percent"]]), scan_pdf(), make_pdf([["Next steps: launch in Q4"]]))
    body = upload(data).json()
    assert body["pages"] == 3
    assert len(fake_vision) == 1 and "第 2 頁" in fake_vision[0]["prompt"]
    text = body["text"]
    assert text.index("Quarterly revenue") < text.index("掃描頁內容 P2") < text.index("Next steps")


def test_text_pdf_does_not_call_ai(fake_vision):
    body = upload(make_pdf([["Quarterly revenue grew 12 percent"]])).json()
    assert fake_vision == []
    assert "images" not in body


def test_blank_pages_are_not_sent(fake_vision):
    body = upload(merge(scan_pdf(), scan_pdf(blank=True))).json()
    assert len(fake_vision) == 1
    assert body["images"] == 1


def test_blank_only_pdf_is_rejected(fake_vision):
    res = upload(scan_pdf(blank=True))
    assert res.status_code == 422
    assert "空白" in res.json()["detail"]
    assert fake_vision == []


def test_scanned_pdf_with_recognition_disabled_is_rejected(fake_vision, monkeypatch):
    monkeypatch.setenv("EXTRACT_IMAGES", "false")
    res = upload(scan_pdf())
    assert res.status_code == 422
    assert "未開啟圖片辨識" in res.json()["detail"]
    assert fake_vision == []


def test_failed_recognition_explains_why(monkeypatch):
    def fake(*a, **k):
        raise RuntimeError("model does not support images")

    monkeypatch.setattr(app_module, "call_llm", fake)
    res = upload(scan_pdf())
    assert res.status_code == 422
    assert "does not support images" in res.json()["detail"]


def test_scanned_pdf_is_logged_as_one_usage(fake_vision):
    upload(merge(scan_pdf(), scan_pdf()))
    assert len(fake_vision) == 2
    with store.connect() as conn:
        rows = conn.execute("SELECT action, status, total_tokens FROM llm_usage").fetchall()
    assert [tuple(r) for r in rows] == [("extract", "ok", 1000)]


def test_page_limit_from_env(fake_vision, monkeypatch):
    monkeypatch.setenv("EXTRACT_IMAGE_MAX", "1")
    body = upload(merge(scan_pdf(), scan_pdf())).json()
    assert len(fake_vision) == 1
    assert "掃描頁內容 P1" in body["text"]
    assert any("超過辨識上限" in n for n in body["notices"])
