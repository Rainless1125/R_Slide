"""登入方式（.env 的 AUTH_MODE）與公司 LDAP / Active Directory 驗證。

AUTH_MODE=system（預設）：使用 R Slide 內建的帳號（自行註冊或管理者建立，密碼存在 SQLite）。
AUTH_MODE=ldap：以公司 LDAP 驗證帳號密碼，不開放註冊；第一次登入成功時自動建立同名的本機帳號，
              用來保存歷史記錄與用量紀錄（本機帳號沒有可用的密碼，無法用 system 方式登入）。

LDAP 有兩種驗證方式（擇一）：
1. 直接綁定：設定 LDAP_USER_DN_TEMPLATE，例如 AD 的 {username}@corp.example.com
   或 OpenLDAP 的 uid={username},ou=people,dc=example,dc=com，以使用者的帳號密碼直接綁定。
2. 先搜尋再綁定：設定 LDAP_SEARCH_BASE，先以服務帳號（LDAP_BIND_DN / LDAP_BIND_PASSWORD，未設定時匿名）
   依 LDAP_USER_FILTER 找到使用者的 DN，再以使用者的密碼綁定；可在篩選條件中限制群組（memberOf）。
"""
import logging
import os
import ssl

logger = logging.getLogger("rslide")

AUTH_MODES = ("system", "ldap")
DEFAULT_USER_FILTER = "(sAMAccountName={username})"
DEFAULT_TIMEOUT = 5


class LdapUnavailable(Exception):
    """LDAP 伺服器無法連線或設定錯誤（不是帳號密碼錯誤），訊息會直接顯示給使用者。"""


def auth_mode() -> str:
    # 每次讀環境變數：.env 在 app.py 匯入 accounts 之後才載入，測試也能各自切換
    mode = (os.getenv("AUTH_MODE") or "system").strip().lower()
    return mode if mode in AUTH_MODES else "system"


def check_config():
    """啟動時檢查登入方式的設定，設定錯誤時啟動失敗並說明原因，避免使用者登入時才發現無法登入。"""
    raw = (os.getenv("AUTH_MODE") or "system").strip().lower()
    if raw not in AUTH_MODES:
        raise ValueError(f"AUTH_MODE 只能是 {' 或 '.join(AUTH_MODES)}，目前為「{raw}」")
    if raw != "ldap":
        return
    if not os.getenv("LDAP_SERVER", "").strip():
        raise ValueError("AUTH_MODE=ldap 時必須設定 LDAP_SERVER，例如 ldaps://ldap.example.com:636")
    template, base = os.getenv("LDAP_USER_DN_TEMPLATE", "").strip(), os.getenv("LDAP_SEARCH_BASE", "").strip()
    if not template and not base:
        raise ValueError("AUTH_MODE=ldap 時必須設定 LDAP_USER_DN_TEMPLATE（直接綁定）或 LDAP_SEARCH_BASE（先搜尋再綁定）其中一項")
    if template and "{username}" not in template:
        raise ValueError("LDAP_USER_DN_TEMPLATE 必須包含 {username}，例如 {username}@corp.example.com")
    if base and "{username}" not in os.getenv("LDAP_USER_FILTER", DEFAULT_USER_FILTER):
        raise ValueError("LDAP_USER_FILTER 必須包含 {username}，例如 (sAMAccountName={username})")
    try:
        import ldap3  # noqa: F401
    except ImportError as e:
        raise ValueError("AUTH_MODE=ldap 需要 ldap3 套件，請執行 pip install -r requirements.txt") from e


def _timeout() -> int:
    try:
        return max(1, int(os.getenv("LDAP_TIMEOUT", DEFAULT_TIMEOUT)))
    except ValueError:
        return DEFAULT_TIMEOUT


def _env_flag(name: str) -> bool:
    return (os.getenv(name) or "").strip().lower() in ("1", "true", "yes", "on")


def _server():
    from ldap3 import NONE, Server, Tls

    url = os.getenv("LDAP_SERVER", "").strip()
    ca_file = os.getenv("LDAP_CA_CERT_FILE", "").strip() or None
    # 預設驗證伺服器憑證；公司內部自簽憑證請以 LDAP_CA_CERT_FILE 指定 CA，不建議關閉驗證
    validate = ssl.CERT_NONE if _env_flag("LDAP_TLS_INSECURE") else ssl.CERT_REQUIRED
    tls = Tls(validate=validate, ca_certs_file=ca_file)
    return Server(url, use_ssl=url.lower().startswith("ldaps://"), tls=tls, get_info=NONE,
                  connect_timeout=_timeout())


def _bind(server, user: str | None, password: str | None):
    """建立連線並綁定，回傳 (連線, 是否成功)。連線失敗時丟出 LdapUnavailable。"""
    from ldap3 import Connection
    from ldap3.core.exceptions import LDAPException

    conn = Connection(server, user=user, password=password, receive_timeout=_timeout(), raise_exceptions=False)
    try:
        conn.open()
        if _env_flag("LDAP_START_TLS"):
            conn.start_tls()
        return conn, conn.bind()
    except LDAPException as e:
        conn.unbind()
        logger.warning("LDAP 連線失敗：%s", e)
        raise LdapUnavailable("無法連線公司 LDAP 伺服器，請稍後再試或聯絡管理員") from e


def _find_user_dn(server, username: str) -> str | None:
    from ldap3 import SUBTREE
    from ldap3.utils.conv import escape_filter_chars

    bind_dn = os.getenv("LDAP_BIND_DN", "").strip() or None
    conn, ok = _bind(server, bind_dn, os.getenv("LDAP_BIND_PASSWORD") if bind_dn else None)
    try:
        if not ok:
            logger.error("LDAP 服務帳號綁定失敗（LDAP_BIND_DN）：%s", conn.result)
            raise LdapUnavailable("公司 LDAP 登入設定有誤，請聯絡管理員")
        search_filter = os.getenv("LDAP_USER_FILTER", DEFAULT_USER_FILTER).replace(
            "{username}", escape_filter_chars(username))
        conn.search(os.getenv("LDAP_SEARCH_BASE", "").strip(), search_filter, search_scope=SUBTREE,
                    attributes=[], size_limit=2)
        entries = conn.entries
        if len(entries) != 1:      # 找不到，或同名的帳號不只一個（無法判斷是哪一位）
            return None
        return entries[0].entry_dn
    finally:
        conn.unbind()


def ldap_authenticate(username: str, password: str) -> bool:
    """以公司 LDAP 驗證帳號密碼；帳號或密碼錯誤回傳 False，伺服器無法連線或設定錯誤時丟出 LdapUnavailable。"""
    # 空白密碼在 LDAP 是「未驗證綁定」，多數伺服器會回報成功，必須先擋下
    if not username or not password:
        return False
    from ldap3.utils.dn import escape_rdn

    server = _server()
    template = os.getenv("LDAP_USER_DN_TEMPLATE", "").strip()
    if template:
        user_dn = template.replace("{username}", escape_rdn(username))
    else:
        user_dn = _find_user_dn(server, username)
        if user_dn is None:
            return False
    conn, ok = _bind(server, user_dn, password)
    conn.unbind()
    return bool(ok)
