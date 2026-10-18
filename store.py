"""SQLite 儲存：使用者帳號、登入 session 與各使用者的簡報歷史記錄。

資料庫是單一檔案（預設為專案目錄下的 data/rslide.db，可用 RSLIDE_DB_PATH 指定），備份時複製該檔即可。
每次操作開一個新連線：SQLite 開連線很便宜，也不必處理跨執行緒共用連線的問題。
"""
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from contextlib import closing, contextmanager

# 以本檔所在位置為基準（與 app.py 的 STATIC_DIR 相同），從其他目錄啟動 uvicorn 也會用同一個資料庫
DEFAULT_DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rslide.db")

SESSION_TTL_SECONDS = 30 * 24 * 3600
MAX_HISTORY_PER_USER = 200          # 超過時自動刪除最舊的紀錄

# scrypt 參數（約 16 MB 記憶體、數十毫秒），格式：scrypt$n$r$p$salt$hash
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    title      TEXT NOT NULL,
    input_json TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    pages      INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,          -- 毫秒，與前端 Date.now() 一致
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_history_user_created ON history(user_id, created_at DESC);
"""


def db_path() -> str:
    # 每次讀環境變數：.env 在 app.py 匯入本模組之後才載入，測試也能各自指定暫存資料庫
    return os.getenv("RSLIDE_DB_PATH") or DEFAULT_DB_PATH


_ready_paths: set[str] = set()


def init_db(path: str):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as conn:
        conn.execute("PRAGMA journal_mode = WAL")   # 讀寫可同時進行，多人使用時不互卡
        conn.executescript(SCHEMA)
        conn.commit()


@contextmanager
def connect():
    """開一個連線並在區塊結束時 commit（發生例外則 rollback）後關閉；第一次使用時自動建立資料表。"""
    path = db_path()
    if path not in _ready_paths:
        init_db(path)
        _ready_paths.add(path)
    with closing(sqlite3.connect(path, timeout=10)) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        with conn:
            yield conn


def now_ms() -> int:
    return int(time.time() * 1000)


# ===================== 密碼 =====================
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
        if algo != "scrypt":
            return False
        calc = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(calc.hex(), digest)


# 帳號不存在時也做一次雜湊，讓回應時間不會透露帳號是否存在
_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ===================== 使用者 / session =====================
class UsernameTaken(Exception):
    pass


def create_user(username: str, password: str) -> dict:
    try:
        with connect() as conn:
            cur = conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                               (username, hash_password(password), now_ms()))
            return {"id": cur.lastrowid, "username": username}
    except sqlite3.IntegrityError:
        raise UsernameTaken(username)


def authenticate(username: str, password: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    if row is None:
        verify_password(password, _DUMMY_HASH)
        return None
    if not verify_password(password, row["password_hash"]):
        return None
    return {"id": row["id"], "username": row["username"]}


def set_password(username: str, password: str) -> bool:
    with connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if row is None:
            return False
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), row["id"]))
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))   # 改密碼後其他裝置需重新登入
        return True


def _token_hash(token: str) -> str:
    # 資料庫只存雜湊：就算 .db 檔外流，也無法直接拿來冒用登入狀態
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                     (_token_hash(token), user_id, now + SESSION_TTL_SECONDS))
    return token


def session_user(token: str | None) -> dict | None:
    if not token:
        return None
    with connect() as conn:
        row = conn.execute(
            "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = ? AND s.expires_at >= ?", (_token_hash(token), int(time.time()))).fetchone()
    return {"id": row["id"], "username": row["username"]} if row else None


def delete_session(token: str | None):
    if token:
        with connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))


# ===================== 歷史記錄 =====================
def _pages(data: dict) -> int:
    slides = data.get("slides") if isinstance(data, dict) else None
    return len(slides) if isinstance(slides, list) else 0


def _summary(row) -> dict:
    return {"id": row["id"], "title": row["title"], "createdAt": row["created_at"],
            "pages": row["pages"], "input": json.loads(row["input_json"])}


def list_history(user_id: int) -> list[dict]:
    """列表只回摘要（不含投影片內容），投影片可能內嵌圖片，開啟時再個別讀取。"""
    with connect() as conn:
        rows = conn.execute("SELECT id, title, created_at, pages, input_json FROM history "
                            "WHERE user_id = ? ORDER BY created_at DESC", (user_id,)).fetchall()
    return [_summary(r) for r in rows]


def get_history(user_id: int, item_id: str) -> dict | None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM history WHERE user_id = ? AND id = ?", (user_id, item_id)).fetchone()
    if row is None:
        return None
    return {**_summary(row), "data": json.loads(row["data_json"])}


def _trim(conn, user_id: int):
    conn.execute("DELETE FROM history WHERE user_id = ? AND id NOT IN ("
                 "SELECT id FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)",
                 (user_id, user_id, MAX_HISTORY_PER_USER))


def add_history(user_id: int, items: list[dict]):
    """新增（或以相同 id 覆蓋）紀錄；items 需含 id、title、input、data，createdAt 可省略。"""
    now = now_ms()
    with connect() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO history (user_id, id, title, input_json, data_json, pages, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(user_id, it["id"], it["title"], json.dumps(it["input"], ensure_ascii=False),
              json.dumps(it["data"], ensure_ascii=False), _pages(it["data"]), it.get("createdAt") or now, now)
             for it in items])
        _trim(conn, user_id)


def update_history(user_id: int, item_id: str, title: str | None = None, data: dict | None = None) -> bool:
    sets, args = ["updated_at = ?"], [now_ms()]
    if title is not None:
        sets.append("title = ?")
        args.append(title)
    if data is not None:
        sets += ["data_json = ?", "pages = ?"]
        args += [json.dumps(data, ensure_ascii=False), _pages(data)]
    with connect() as conn:
        cur = conn.execute(f"UPDATE history SET {', '.join(sets)} WHERE user_id = ? AND id = ?",
                           (*args, user_id, item_id))
        return cur.rowcount > 0


def delete_history(user_id: int, item_id: str | None = None):
    """刪除單筆；item_id 為 None 時刪除該使用者全部紀錄。"""
    with connect() as conn:
        if item_id is None:
            conn.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        else:
            conn.execute("DELETE FROM history WHERE user_id = ? AND id = ?", (user_id, item_id))
