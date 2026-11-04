"""前端頁面的快取版本號：送出 HTML 時，依每個 /static/ 的 JS 與 CSS 檔案內容自動加上 ?v=<雜湊>。

以前要在修改前端檔案後，手動把 index.html 裡的 ?v=N 加 1：容易忘記（使用者的瀏覽器繼續用舊檔），
兩個 PR 同時改到相鄰的版本號也會互相衝突。現在 HTML 裡直接寫 /static/... 路徑即可，檔案內容一改，版本號就跟著變。

帶有版本號的請求內容不會變，回應可以讓瀏覽器長期快取（見 cache_control_for）；HTML 本身則每次重新確認。
"""
import hashlib
import re
from pathlib import Path

# src="/static/....js" 或 href="/static/....css"；原本手寫的 ?v=N 一併取代
STATIC_REF_RE = re.compile(r'((?:src|href)=")(/static/([^"?#]+\.(?:js|css)))(?:\?[^"#]*)?(")')
HASH_LEN = 10
LONG_CACHE = "public, max-age=31536000, immutable"   # 帶版本號的靜態檔案
NO_CACHE = "no-cache"                                 # HTML：每次向伺服器確認，才拿得到新的版本號

_hash_cache: dict[Path, tuple[int, int, str]] = {}    # 路徑 -> (修改時間, 大小, 雜湊)


def file_version(path: Path) -> str | None:
    """檔案內容的雜湊（前 10 碼）；檔案不存在時回傳 None。以修改時間與大小判斷是否需要重算。"""
    try:
        st = path.stat()
    except OSError:
        return None
    cached = _hash_cache.get(path)
    if cached and cached[0] == st.st_mtime_ns and cached[1] == st.st_size:
        return cached[2]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_LEN]
    _hash_cache[path] = (st.st_mtime_ns, st.st_size, digest)
    return digest


def versioned_html(static_dir: Path, name: str) -> str:
    """讀取 static_dir 下的 HTML，把引用的 /static/ JS 與 CSS 加上內容雜湊的版本號。
    只處理 static_dir 內的檔案；找不到的檔案保持原樣（不加版本號）。"""
    root = static_dir.resolve()
    html = (static_dir / name).read_text(encoding="utf-8")

    def add_version(m: re.Match) -> str:
        target = (static_dir / m.group(3)).resolve()
        if root not in target.parents:
            return m.group(0)
        version = file_version(target)
        return f"{m.group(1)}{m.group(2)}?v={version}{m.group(4)}" if version else m.group(1) + m.group(2) + m.group(4)

    return STATIC_REF_RE.sub(add_version, html)


def cache_control_for(path: str, query: str) -> str | None:
    """/static/ 的請求帶有 v= 版本號時，內容不會變，讓瀏覽器長期快取。"""
    if path.startswith("/static/") and re.search(r"(?:^|&)v=", query):
        return LONG_CACHE
    return None
