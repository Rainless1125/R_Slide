"""SQLite 儲存：使用者帳號、登入 session、登入失敗鎖定、各使用者的簡報歷史記錄、LLM 使用紀錄與使用者回饋。

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
-- 每次呼叫 LLM 一筆（失敗也記），供查詢各使用者用量；不存提示詞與回覆內容，素材只記字數與雜湊。
-- user_id 刻意不設外鍵：刪除帳號後仍保留稽核紀錄，username 為當時的帳號名稱
CREATE TABLE IF NOT EXISTS llm_usage (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL,
    username         TEXT NOT NULL,
    created_at       INTEGER NOT NULL,          -- 毫秒
    action           TEXT NOT NULL,             -- generate / regenerate / element（AI 修改單一元素）/ outline / extract
    provider         TEXT NOT NULL,
    model            TEXT NOT NULL,
    deck_mode        TEXT,
    num_pages        INTEGER,                   -- 要求的頁數，0 = 由 AI 決定
    slides_returned  INTEGER,
    input_chars      INTEGER NOT NULL,
    content_hash     TEXT,                      -- 素材的 sha256，用來找出重複送出的相同內容
    input_tokens     INTEGER,                   -- token 數由平台回傳，部分模型不提供時為 NULL
    output_tokens    INTEGER,
    total_tokens     INTEGER,
    cached_tokens    INTEGER,
    reasoning_tokens INTEGER,
    status           TEXT NOT NULL,             -- pending（呼叫中）/ ok / error / rate_limited（超過次數上限，未呼叫 LLM）
    http_status      INTEGER,
    error            TEXT,
    latency_ms       INTEGER,
    fallback         INTEGER NOT NULL DEFAULT 0, -- OpenAI 相容端點改用提示詞附 schema 的備援路徑
    client_ip        TEXT,
    thinking         TEXT                       -- 使用者選的思考長度 medium / high，辨識圖片等未指定時為 NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_time ON llm_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_time ON llm_usage(created_at);
-- 使用者從右上角「意見回饋」送出的評分與文字（至少擇一）；與 llm_usage 相同，刪除帳號後仍保留，username 為當時的帳號名稱
CREATE TABLE IF NOT EXISTS feedback (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL,
    created_at INTEGER NOT NULL,          -- 毫秒
    rating     INTEGER,                   -- 使用體驗 1~5 星，未評分為 NULL
    content    TEXT NOT NULL DEFAULT '',  -- 未填文字時為空字串
    client_ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_user_time ON feedback(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_time ON feedback(created_at);
-- 登入失敗紀錄與 IP 鎖定（防暴力破解密碼）：同一 IP 在 30 分鐘內失敗 5 次即鎖定 30 分鐘
CREATE TABLE IF NOT EXISTS login_failures (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT NOT NULL,
    created_at INTEGER NOT NULL           -- 毫秒
);
CREATE INDEX IF NOT EXISTS idx_login_failures_ip_time ON login_failures(ip, created_at);
CREATE TABLE IF NOT EXISTS login_lockouts (
    ip           TEXT PRIMARY KEY,
    locked_until INTEGER NOT NULL         -- 毫秒
);
-- 自行註冊紀錄：限制同一 IP 在 24 小時內可註冊的帳號數，避免大量建立帳號繞過每個帳號的 LLM 次數上限
-- （管理者在後台或 manage_users.py 建立的帳號不記錄、不受限制）
CREATE TABLE IF NOT EXISTS registrations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ip         TEXT NOT NULL,
    created_at INTEGER NOT NULL           -- 毫秒
);
CREATE INDEX IF NOT EXISTS idx_registrations_ip_time ON registrations(ip, created_at);
-- 後台管理者的登入 session（帳號密碼設定於 .env，見 admin.py）；cred_mac 用來在 .env 改密碼後讓舊 session 失效
CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    cred_mac   TEXT NOT NULL,
    expires_at INTEGER NOT NULL           -- 秒
);
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
        _migrate(conn)
        conn.commit()


# CREATE TABLE IF NOT EXISTS 不會替已存在的資料表加欄位：之後新增的欄位列在這裡，啟動時補上
_ADDED_COLUMNS = {
    "feedback": {"rating": "INTEGER"},
    "llm_usage": {"thinking": "TEXT"},
}


def _migrate(conn):
    for table, columns in _ADDED_COLUMNS.items():
        existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


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


DEFAULT_REGISTER_LIMIT_PER_IP = 1


def register_limit() -> int:
    """同一 IP 在 24 小時內可自行註冊的帳號數（.env 的 REGISTER_LIMIT_PER_IP_PER_DAY），0 為不限制。"""
    try:
        return max(0, int(os.getenv("REGISTER_LIMIT_PER_IP_PER_DAY", DEFAULT_REGISTER_LIMIT_PER_IP)))
    except ValueError:
        return DEFAULT_REGISTER_LIMIT_PER_IP


class RegisterLimited(Exception):
    def __init__(self, limit: int, retry_after: int):
        super().__init__(limit)
        self.limit = limit
        self.retry_after = retry_after


def register_user(username: str, password: str, ip: str) -> dict:
    """自行註冊：檢查同一 IP 的註冊次數後建立帳號並記錄，只有成功建立的帳號算次數。
    BEGIN IMMEDIATE 讓同時送出的註冊依序檢查與寫入，無法一次送出大量請求超過上限。"""
    limit = register_limit()
    password_hash = hash_password(password)       # 雜湊約數十毫秒，在交易外先算好，不佔住寫入鎖
    now = now_ms()
    try:
        with connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM registrations WHERE created_at <= ?", (now - DAY_MS,))
            if limit:
                rows = conn.execute("SELECT created_at FROM registrations WHERE ip = ? ORDER BY created_at DESC LIMIT ?",
                                    (ip, limit)).fetchall()
                if len(rows) >= limit:
                    # 要等到區間內「倒數第 limit 筆」滑出 24 小時才能再註冊
                    raise RegisterLimited(limit, max(1, -(-(rows[-1][0] + DAY_MS - now) // 1000)))
            cur = conn.execute("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                               (username, password_hash, now))
            conn.execute("INSERT INTO registrations (ip, created_at) VALUES (?, ?)", (ip, now))
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


# 外部驗證（公司 LDAP）建立的本機帳號：密碼欄位放這個標記，任何密碼都無法通過 verify_password
EXTERNAL_PASSWORD_HASH = "external$ldap"


def get_or_create_external_user(username: str) -> dict:
    """公司 LDAP 驗證成功後取得對應的本機帳號（帳號名稱不分大小寫），第一次登入時自動建立。
    已有同名的本機帳號時沿用該帳號，原本的歷史記錄會保留。"""
    with connect() as conn:
        conn.execute("INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                     (username, EXTERNAL_PASSWORD_HASH, now_ms()))
        row = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,)).fetchone()
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


# ===================== 登入失敗鎖定 =====================
LOGIN_MAX_FAILURES = 5                  # 同一 IP 在 LOGIN_LOCKOUT_MS 內失敗幾次就鎖定
LOGIN_LOCKOUT_MS = 30 * 60 * 1000       # 失敗次數的計算區間，也是鎖定時間


class LoginLocked(Exception):
    def __init__(self, locked_until: int):
        super().__init__(locked_until)
        self.locked_until = locked_until


def begin_login_attempt(ip: str) -> tuple[int, int]:
    """驗證密碼前先登記一次嘗試（視為失敗），回傳 (嘗試 id, 這次也失敗後剩下的次數)；IP 已被鎖定時丟出 LoginLocked。
    先登記再驗證，同一 IP 同時送出大量請求也無法超過次數上限；BEGIN IMMEDIATE 讓多個請求依序讀寫計數。
    這次嘗試達到上限時先寫入鎖定，驗證成功再由 end_login_attempt 解除。"""
    now = now_ms()
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM login_lockouts WHERE locked_until <= ?", (now,))
        conn.execute("DELETE FROM login_failures WHERE created_at <= ?", (now - LOGIN_LOCKOUT_MS,))
        row = conn.execute("SELECT locked_until FROM login_lockouts WHERE ip = ?", (ip,)).fetchone()
        if row is not None:
            raise LoginLocked(row["locked_until"])
        cur = conn.execute("INSERT INTO login_failures (ip, created_at) VALUES (?, ?)", (ip, now))
        failures = conn.execute("SELECT COUNT(*) FROM login_failures WHERE ip = ?", (ip,)).fetchone()[0]
        if failures >= LOGIN_MAX_FAILURES:
            conn.execute("INSERT OR REPLACE INTO login_lockouts (ip, locked_until) VALUES (?, ?)",
                         (ip, now + LOGIN_LOCKOUT_MS))
        return cur.lastrowid, max(0, LOGIN_MAX_FAILURES - failures)


def end_login_attempt(ip: str, attempt_id: int):
    """密碼驗證成功：移除這次預先登記的失敗；剩下的失敗未達上限時一併解除鎖定。
    之前的失敗不清除，避免攻擊者穿插登入自己的帳號來重設次數。"""
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM login_failures WHERE id = ?", (attempt_id,))
        failures = conn.execute("SELECT COUNT(*) FROM login_failures WHERE ip = ? AND created_at > ?",
                                (ip, now_ms() - LOGIN_LOCKOUT_MS)).fetchone()[0]
        if failures < LOGIN_MAX_FAILURES:
            conn.execute("DELETE FROM login_lockouts WHERE ip = ?", (ip,))


def list_login_lockouts() -> list[dict]:
    with connect() as conn:
        rows = conn.execute("SELECT ip, locked_until FROM login_lockouts WHERE locked_until > ? "
                            "ORDER BY locked_until DESC", (now_ms(),)).fetchall()
    return [dict(r) for r in rows]


def unlock_login_ip(ip: str) -> bool:
    """管理者手動解除鎖定，並清除該 IP 的失敗紀錄；回傳該 IP 原本是否被鎖定。"""
    with connect() as conn:
        cur = conn.execute("DELETE FROM login_lockouts WHERE ip = ? AND locked_until > ?", (ip, now_ms()))
        conn.execute("DELETE FROM login_failures WHERE ip = ?", (ip,))
        return cur.rowcount > 0


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


def add_history(user_id: int, items: list[dict], replace: bool = True):
    """新增紀錄；相同 id 已存在時 replace=True 覆蓋、False 保留原紀錄。items 需含 id、title、input、data，createdAt 可省略。"""
    now = now_ms()
    with connect() as conn:
        conn.executemany(
            f"INSERT OR {'REPLACE' if replace else 'IGNORE'} INTO history (user_id, id, title, input_json, data_json, pages, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(user_id, it["id"], it["title"], json.dumps(it["input"], ensure_ascii=False),
              json.dumps(it["data"], ensure_ascii=False), _pages(it["data"]), it.get("createdAt") or now, now)
             for it in items])
        _trim(conn, user_id)


def update_history(user_id: int, item_id: str, title: str | None = None, data: dict | None = None,
                   input: dict | None = None) -> bool:
    sets, args = ["updated_at = ?"], [now_ms()]
    if title is not None:
        sets.append("title = ?")
        args.append(title)
    if input is not None:
        sets.append("input_json = ?")
        args.append(json.dumps(input, ensure_ascii=False))
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


# ===================== LLM 使用紀錄 =====================
LLM_USAGE_COLUMNS = ("user_id", "username", "created_at", "action", "provider", "model", "deck_mode", "num_pages",
                     "slides_returned", "input_chars", "content_hash", "input_tokens", "output_tokens",
                     "total_tokens", "cached_tokens", "reasoning_tokens", "status", "http_status", "error",
                     "latency_ms", "fallback", "client_ip", "thinking")
DEFAULT_USAGE_RETENTION_DAYS = 365
DAY_MS = 24 * 3600 * 1000


def usage_retention_days() -> int:
    """LLM_USAGE_RETENTION_DAYS：保留天數，0 為永久保留。"""
    try:
        return max(0, int(os.getenv("LLM_USAGE_RETENTION_DAYS", DEFAULT_USAGE_RETENTION_DAYS)))
    except ValueError:
        return DEFAULT_USAGE_RETENTION_DAYS


def _insert_usage(conn, entry: dict) -> int:
    row = {"created_at": now_ms(), "fallback": 0, **entry}
    cur = conn.execute(f"INSERT INTO llm_usage ({', '.join(LLM_USAGE_COLUMNS)}) "
                       f"VALUES ({', '.join('?' * len(LLM_USAGE_COLUMNS))})",
                       [row.get(c) for c in LLM_USAGE_COLUMNS])
    return cur.lastrowid


def _purge_usage(conn):
    days = usage_retention_days()
    if days:
        conn.execute("DELETE FROM llm_usage WHERE created_at < ?", (now_ms() - days * DAY_MS,))


def log_llm_usage(entry: dict):
    """寫入一筆 LLM 使用紀錄（未提供的欄位為 NULL），並順便刪除超過保留天數的紀錄。"""
    with connect() as conn:
        _insert_usage(conn, entry)
        _purge_usage(conn)


# ===================== LLM 呼叫次數上限 =====================
HOUR_MS = 3600 * 1000
DEFAULT_LLM_LIMITS = {"LLM_RATE_LIMIT_PER_HOUR": 20, "LLM_RATE_LIMIT_PER_DAY": 100, "LLM_MAX_CONCURRENT": 2}
# 呼叫中的紀錄超過這個時間仍未結束（例如服務在呼叫途中重啟），就不再算進同時進行中的數量
PENDING_STALE_MS = 10 * 60 * 1000


def llm_limit(name: str) -> int:
    """各使用者的 LLM 呼叫上限（.env 可調整），0 為不限制。"""
    try:
        return max(0, int(os.getenv(name, DEFAULT_LLM_LIMITS[name])))
    except ValueError:
        return DEFAULT_LLM_LIMITS[name]


class LlmRateLimited(Exception):
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = retry_after


# (回傳鍵名, 環境變數, 區間, 訊息用的名稱)；每天以最近 24 小時滾動計算
RATE_WINDOWS = (("hour", "LLM_RATE_LIMIT_PER_HOUR", HOUR_MS, "每小時"),
                ("day", "LLM_RATE_LIMIT_PER_DAY", DAY_MS, "每 24 小時"))


def _window_quota(conn, user_id: int, now: int, env_name: str, window: int) -> dict | None:
    """單一區間的用量：limit / used / remaining，用完時 reset_in 為幾秒後恢復 1 次；上限為 0（不限制）時回傳 None。
    rate_limited 的紀錄不算次數，pending（呼叫中）與失敗的呼叫都算。"""
    limit = llm_limit(env_name)
    if not limit:
        return None
    since = now - window
    used = conn.execute("SELECT COUNT(*) FROM llm_usage WHERE user_id = ? AND created_at > ? "
                        "AND status != 'rate_limited'", (user_id, since)).fetchone()[0]
    reset_in = None
    if used >= limit:
        # 要等到區間內「倒數第 limit 筆」滑出區間才能再呼叫
        oldest_kept = conn.execute("SELECT created_at FROM llm_usage WHERE user_id = ? AND created_at > ? "
                                   "AND status != 'rate_limited' ORDER BY created_at DESC LIMIT 1 OFFSET ?",
                                   (user_id, since, limit - 1)).fetchone()[0]
        reset_in = max(1, -(-(oldest_kept + window - now) // 1000))
    return {"limit": limit, "used": used, "remaining": max(0, limit - used), "reset_in": reset_in}


def llm_quota(user_id: int) -> dict:
    """該使用者目前的剩餘次數（供前端顯示），與 begin_llm_call 的檢查使用相同的計算方式。"""
    now = now_ms()
    with connect() as conn:
        return {key: _window_quota(conn, user_id, now, env_name, window) for key, env_name, window, _ in RATE_WINDOWS}


def begin_llm_call(entry: dict) -> int:
    """呼叫 LLM 前先檢查該使用者的次數上限並登記一筆 pending 紀錄，回傳紀錄 id，呼叫結束後以 finish_llm_call 更新。
    先登記再呼叫，同一帳號同時送出大量請求也無法超過上限；BEGIN IMMEDIATE 讓多個請求依序檢查與登記。
    超過上限時另記一筆 rate_limited（供管理者查看，不算進次數）並丟出 LlmRateLimited。
    失敗的呼叫也算次數：平台通常已經用掉 token。"""
    now = now_ms()
    user_id = entry["user_id"]
    with connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        error = None
        for _, env_name, window, label in RATE_WINDOWS:
            quota = _window_quota(conn, user_id, now, env_name, window)
            if quota and not quota["remaining"]:
                error = LlmRateLimited(f"本帳號{label}最多可使用 AI 生成 {quota['limit']} 次（生成、大綱、重產與圖片辨識合併計算），已達上限，"
                                       f"請於 {fmt_wait(quota['reset_in'])}後再試", quota["reset_in"])
                break
        concurrent = llm_limit("LLM_MAX_CONCURRENT")
        if error is None and concurrent:
            running = conn.execute("SELECT COUNT(*) FROM llm_usage WHERE user_id = ? AND created_at > ? "
                                   "AND status = 'pending'", (user_id, now - PENDING_STALE_MS)).fetchone()[0]
            if running >= concurrent:
                error = LlmRateLimited(f"本帳號同時最多進行 {concurrent} 個 AI 工作（生成、大綱、重產或圖片辨識），請等目前的完成後再試", 5)
        if error is None:
            return _insert_usage(conn, {**entry, "status": "pending"})
        _insert_usage(conn, {**entry, "status": "rate_limited", "http_status": 429, "error": str(error)[:200]})
    raise error                         # 在 with 區塊外丟出：區塊內丟出會 rollback，rate_limited 紀錄就不會保存


def fmt_wait(seconds: int) -> str:
    minutes = -(-seconds // 60)
    return f"{minutes} 分鐘" if minutes < 60 else f"{minutes // 60} 小時 {minutes % 60} 分鐘".replace(" 0 分鐘", "")


def finish_llm_call(usage_id: int, entry: dict):
    """以呼叫結果更新 begin_llm_call 登記的紀錄（created_at 維持登記時間），並順便刪除超過保留天數的紀錄。"""
    columns = [c for c in LLM_USAGE_COLUMNS if c in entry and c not in ("created_at", "user_id")]
    with connect() as conn:
        conn.execute(f"UPDATE llm_usage SET {', '.join(c + ' = ?' for c in columns)} WHERE id = ?",
                     [*(entry[c] for c in columns), usage_id])
        _purge_usage(conn)


def usage_by_user(since_ms: int) -> list[dict]:
    """各使用者的用量摘要，依 token 合計由多到少排序。max_same_content 為同一份素材被送去「生成」的最多次數。
    calls 依 action 分成 generates / regenerates（含 AI 修改單一元素）/ outlines / extracts（匯入檔案時的 AI 辨識）。"""
    with connect() as conn:
        rows = conn.execute("""
            SELECT l.user_id, COALESCE(u.username, MAX(l.username)) AS username,
                   SUM(l.status != 'rate_limited') AS calls, SUM(l.status = 'error') AS errors,
                   SUM(l.status = 'rate_limited') AS rate_limited,
                   SUM(l.action = 'generate' AND l.status != 'rate_limited') AS generates,
                   SUM(l.action IN ('regenerate', 'element') AND l.status != 'rate_limited') AS regenerates,
                   SUM(l.action = 'outline' AND l.status != 'rate_limited') AS outlines,
                   SUM(l.action = 'extract' AND l.status != 'rate_limited') AS extracts,
                   COALESCE(SUM(l.input_tokens), 0) AS input_tokens, COALESCE(SUM(l.output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(l.total_tokens), 0) AS total_tokens, MAX(l.created_at) AS last_used,
                   (SELECT MAX(n) FROM (SELECT COUNT(*) AS n FROM llm_usage d
                        WHERE d.user_id = l.user_id AND d.created_at >= ? AND d.action = 'generate'
                              AND d.status != 'rate_limited'
                        GROUP BY d.content_hash)) AS max_same_content
            FROM llm_usage l LEFT JOIN users u ON u.id = l.user_id
            WHERE l.created_at >= ?
            GROUP BY l.user_id
            ORDER BY total_tokens DESC, calls DESC""", (since_ms, since_ms)).fetchall()
    return [dict(r) for r in rows]


def usage_by_day(username: str, since_ms: int) -> list[dict]:
    """單一使用者按日（伺服器當地時間）與模型的用量明細；帳號已刪除時以紀錄中的帳號名稱查詢。"""
    with connect() as conn:
        rows = conn.execute("""
            SELECT date(created_at / 1000, 'unixepoch', 'localtime') AS day, provider, model,
                   COUNT(*) AS calls, SUM(status = 'error') AS errors,
                   COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
                   COALESCE(SUM(total_tokens), 0) AS total_tokens
            FROM llm_usage
            WHERE created_at >= ? AND status != 'rate_limited' AND (user_id IN (SELECT id FROM users WHERE username = ?) OR username = ? COLLATE NOCASE)
            GROUP BY day, provider, model
            ORDER BY day DESC, total_tokens DESC""", (since_ms, username, username)).fetchall()
    return [dict(r) for r in rows]


# ===================== 使用者回饋 =====================
MAX_FEEDBACK_CHARS = 2000
FEEDBACK_RATE_LIMIT = 10                # 每位使用者每小時最多送出幾則，避免誤觸連送或灌爆資料庫


class FeedbackRateLimited(Exception):
    pass


def add_feedback(user: dict, content: str, rating: int | None = None, client_ip: str | None = None) -> int:
    """寫入一則回饋；同一使用者最近一小時已達上限時丟出 FeedbackRateLimited。"""
    now = now_ms()
    with connect() as conn:
        recent = conn.execute("SELECT COUNT(*) FROM feedback WHERE user_id = ? AND created_at >= ?",
                              (user["id"], now - HOUR_MS)).fetchone()[0]
        if recent >= FEEDBACK_RATE_LIMIT:
            raise FeedbackRateLimited()
        cur = conn.execute("INSERT INTO feedback (user_id, username, created_at, rating, content, client_ip) "
                           "VALUES (?, ?, ?, ?, ?, ?)", (user["id"], user["username"], now, rating, content, client_ip))
        return cur.lastrowid


def list_feedback(since_ms: int, username: str | None = None) -> list[dict]:
    """回饋列表，新的在前；指定 username 時只列該帳號（帳號已刪除時以紀錄中的帳號名稱查詢）。"""
    sql = "SELECT id, username, created_at, rating, content FROM feedback WHERE created_at >= ?"
    args: list = [since_ms]
    if username is not None:
        sql += " AND username = ? COLLATE NOCASE"
        args.append(username)
    with connect() as conn:
        rows = conn.execute(sql + " ORDER BY created_at DESC, id DESC", args).fetchall()
    return [dict(r) for r in rows]


# ===================== 後台管理 =====================
def list_users() -> list[dict]:
    """後台帳號列表：帳號來源（ldap = 公司 LDAP 登入時自動建立、local = 本機帳號）、歷史記錄筆數與最後一次呼叫 LLM 的時間。"""
    with connect() as conn:
        rows = conn.execute("""
            SELECT u.id, u.username, u.created_at,
                   CASE WHEN u.password_hash = ? THEN 'ldap' ELSE 'local' END AS source,
                   (SELECT COUNT(*) FROM history h WHERE h.user_id = u.id) AS history_count,
                   (SELECT MAX(created_at) FROM llm_usage l WHERE l.user_id = u.id) AS last_used
            FROM users u ORDER BY u.username""", (EXTERNAL_PASSWORD_HASH,)).fetchall()
    return [dict(r) for r in rows]


def delete_user(username: str) -> bool:
    """刪除帳號（歷史記錄與登入 session 一併刪除）；LLM 使用紀錄與意見回饋保留供稽核。"""
    with connect() as conn:
        cur = conn.execute("DELETE FROM users WHERE username = ?", (username,))
        return cur.rowcount > 0


def admin_overview(since_ms: int) -> dict:
    """後台總覽的統計數字；llm_* 與 feedback_* 只計 since_ms 之後的紀錄。"""
    with connect() as conn:
        one = lambda sql, *args: conn.execute(sql, args).fetchone()
        llm = one("SELECT SUM(status != 'rate_limited') AS calls, SUM(status = 'error') AS errors, "
                  "SUM(status = 'rate_limited') AS rate_limited, COALESCE(SUM(total_tokens), 0) AS total_tokens, "
                  "COUNT(DISTINCT CASE WHEN status != 'rate_limited' THEN user_id END) AS active_users "
                  "FROM llm_usage WHERE created_at >= ?", since_ms)
        fb = one("SELECT COUNT(*) AS n, AVG(rating) AS avg_rating, COUNT(rating) AS rated "
                 "FROM feedback WHERE created_at >= ?", since_ms)
        return {
            "users": one("SELECT COUNT(*) FROM users")[0],
            "history": one("SELECT COUNT(*) FROM history")[0],
            "llm_calls": llm["calls"] or 0, "llm_errors": llm["errors"] or 0,
            "llm_rate_limited": llm["rate_limited"] or 0, "llm_total_tokens": llm["total_tokens"],
            "active_users": llm["active_users"] or 0,
            "feedback": fb["n"], "feedback_rated": fb["rated"],
            "feedback_avg_rating": round(fb["avg_rating"], 2) if fb["avg_rating"] is not None else None,
            "lockouts": one("SELECT COUNT(*) FROM login_lockouts WHERE locked_until > ?", now_ms())[0],
        }


ADMIN_SESSION_TTL_SECONDS = 8 * 3600


def _admin_cred_mac(token: str, credentials: str) -> str:
    # 以 session token 為金鑰：資料庫外流時沒有 token，無法拿 cred_mac 離線猜測管理者密碼
    return hmac.new(token.encode(), credentials.encode(), hashlib.sha256).hexdigest()


def create_admin_session(credentials: str) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    with connect() as conn:
        conn.execute("DELETE FROM admin_sessions WHERE expires_at < ?", (now,))
        conn.execute("INSERT INTO admin_sessions (token_hash, cred_mac, expires_at) VALUES (?, ?, ?)",
                     (_token_hash(token), _admin_cred_mac(token, credentials), now + ADMIN_SESSION_TTL_SECONDS))
    return token


def admin_session_valid(token: str | None, credentials: str) -> bool:
    """token 未過期，且建立時的管理者帳號密碼與目前 .env 的設定相同。"""
    if not token:
        return False
    with connect() as conn:
        row = conn.execute("SELECT cred_mac FROM admin_sessions WHERE token_hash = ? AND expires_at >= ?",
                           (_token_hash(token), int(time.time()))).fetchone()
    return row is not None and hmac.compare_digest(row["cred_mac"], _admin_cred_mac(token, credentials))


def delete_admin_session(token: str | None):
    if token:
        with connect() as conn:
            conn.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (_token_hash(token),))
