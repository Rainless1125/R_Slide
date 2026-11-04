"""前端頁面的快取版本號：送出 HTML 時依 JS / CSS 檔案內容自動加上 ?v=<雜湊>，修改檔案後版本號跟著變。"""
import os
import re

from fastapi.testclient import TestClient

import app as app_module
import static_assets

client = TestClient(app_module.app)
VERSIONED = re.compile(r'(?:src|href)="(/static/[^"?]+\.(?:js|css))\?v=([0-9a-f]{10})"')


def refs(html):
    return dict(VERSIONED.findall(html))


def test_pages_get_content_hash_versions():
    for path, must in [("/", "/static/app/core.js"), ("/admin", "/static/admin/admin.js")]:
        res = client.get(path)
        assert res.status_code == 200 and res.headers["content-type"].startswith("text/html")
        assert res.headers["cache-control"] == "no-cache"
        versions = refs(res.text)
        assert must in versions
        # 本機的 JS / CSS 全部都有版本號，且與檔案內容一致
        local = re.findall(r'(?:src|href)="(/static/[^"]+\.(?:js|css))[^"]*"', res.text)
        assert local and all(p in versions for p in local)
        for p, v in versions.items():
            assert v == static_assets.file_version(app_module.STATIC_DIR / p[len("/static/"):])


def test_shared_file_has_same_version_on_both_pages():
    # 以前手動維護時，admin.html 的 app.css 版本號落後主畫面很多
    assert refs(client.get("/").text)["/static/app/app.css"] == refs(client.get("/admin").text)["/static/app/app.css"]


def test_html_source_has_no_manual_versions():
    for name in ("index.html", "admin.html"):
        assert "?v=" not in (app_module.STATIC_DIR / name).read_text(encoding="utf-8")


def test_version_changes_when_file_changes(tmp_path):
    (tmp_path / "app").mkdir()
    js = tmp_path / "app" / "a.js"
    js.write_text("console.log(1)")
    (tmp_path / "page.html").write_text('<script src="/static/app/a.js?v=3"></script><link href="/static/missing.css" rel="stylesheet">')
    first = static_assets.versioned_html(tmp_path, "page.html")
    v1 = refs(first)["/static/app/a.js"]
    assert '?v=3' not in first
    assert 'href="/static/missing.css"' in first              # 找不到的檔案不加版本號
    js.write_text("console.log(2)")
    os.utime(js, ns=(js.stat().st_atime_ns, js.stat().st_mtime_ns + 1_000_000))
    v2 = refs(static_assets.versioned_html(tmp_path, "page.html"))["/static/app/a.js"]
    assert v1 != v2


def test_paths_outside_static_are_ignored(tmp_path):
    (tmp_path / "static").mkdir()
    (tmp_path / "secret.js").write_text("x")
    (tmp_path / "static" / "page.html").write_text('<script src="/static/../secret.js"></script>')
    assert "?v=" not in static_assets.versioned_html(tmp_path / "static", "page.html")


def test_versioned_static_files_are_cached_long():
    version = refs(client.get("/").text)["/static/app/core.js"]
    res = client.get(f"/static/app/core.js?v={version}")
    assert res.status_code == 200 and "immutable" in res.headers["cache-control"]
    plain = client.get("/static/app/core.js")
    assert "immutable" not in plain.headers.get("cache-control", "")
    assert "immutable" not in client.get("/static/app/missing.js?v=abc").headers.get("cache-control", "")
