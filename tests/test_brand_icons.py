"""企業 / 品牌識別圖示：列出 brand_icon 資料夾中的圖片並提供下載，只開放清單中的檔名。"""
import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("GEMINI_API_KEY", "test-key")  # app.py 啟動時需要至少一組 Key，測試不會實際呼叫 LLM

import app as app_module  # noqa: E402
import brand_icons  # noqa: E402

client = TestClient(app_module.app)
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32


@pytest.fixture
def folder(tmp_path, monkeypatch):
    d = tmp_path / "brand_icon"
    d.mkdir()
    monkeypatch.setenv("BRAND_ICON_DIR", str(d))
    return d


def test_requires_login(folder):
    (folder / "logo.png").write_bytes(PNG)
    assert client.get("/api/brand-icons").status_code == 401
    assert client.get("/api/brand-icons/logo.png").status_code == 401


def test_lists_supported_images_sorted(folder, logged_in):
    for name in ["公司 Logo.png", "b.SVG", "a.jpeg", "說明.md", ".hidden.png", "x.exe"]:
        (folder / name).write_bytes(PNG)
    (folder / "sub").mkdir()
    (folder / "sub" / "inner.png").write_bytes(PNG)
    assert client.get("/api/brand-icons").json() == [
        {"name": "a", "file": "a.jpeg"}, {"name": "b", "file": "b.SVG"}, {"name": "公司 Logo", "file": "公司 Logo.png"}]


def test_missing_folder_is_empty(tmp_path, monkeypatch, logged_in):
    monkeypatch.setenv("BRAND_ICON_DIR", str(tmp_path / "nope"))
    assert client.get("/api/brand-icons").json() == []


def test_skips_oversized_files(folder, logged_in, monkeypatch):
    monkeypatch.setattr(brand_icons, "MAX_BRAND_ICON_BYTES", 10)
    (folder / "big.png").write_bytes(PNG)
    assert client.get("/api/brand-icons").json() == []


def test_serves_file_with_type(folder, logged_in):
    (folder / "公司 Logo.png").write_bytes(PNG)
    res = client.get("/api/brand-icons/公司 Logo.png")
    assert res.status_code == 200 and res.content == PNG
    assert res.headers["content-type"] == "image/png"
    assert res.headers["x-content-type-options"] == "nosniff"


def test_svg_is_sandboxed(folder, logged_in):
    (folder / "mark.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    res = client.get("/api/brand-icons/mark.svg")
    assert res.headers["content-type"].startswith("image/svg+xml")
    assert "sandbox" in res.headers["content-security-policy"]


@pytest.mark.parametrize("name", ["..%2Fsecret.png", "sub%2Finner.png", "notes.md", "missing.png", ".hidden.png"])
def test_only_listed_files_are_served(folder, logged_in, name):
    (folder.parent / "secret.png").write_bytes(PNG)
    (folder / "sub").mkdir()
    (folder / "sub" / "inner.png").write_bytes(PNG)
    (folder / "notes.md").write_text("x")
    (folder / ".hidden.png").write_bytes(PNG)
    assert client.get(f"/api/brand-icons/{name}").status_code == 404


def test_default_folder_has_only_readme():
    # 專案內附的 brand_icon 資料夾只放說明，預設沒有任何圖示（不顯示「品牌」按鈕）
    assert brand_icons.DEFAULT_BRAND_ICON_DIR.is_dir()
    assert (brand_icons.DEFAULT_BRAND_ICON_DIR / "README.md").is_file()
