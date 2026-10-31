"""後台管理 API（/api/admin/*）：帳號、LLM 用量、意見回饋與 IP 鎖定，功能與 manage_users.py 相同。

管理者帳號密碼設定於 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD，兩者都設定（且密碼符合規則）才會啟用後台；
管理者不是 users 資料表裡的帳號，不能登入主畫面，一般使用者也無法登入後台。
"""
import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel

import store
from accounts import MAX_PASSWORD, PASSWORD_RULE, USERNAME_RE, env_flag, locked_error, password_ok
from ldap_auth import auth_mode

router = APIRouter(prefix="/api/admin")

ADMIN_COOKIE = "rslide_admin"
# 公司 LDAP 登入時帳號與密碼由公司管理：在這裡建立的帳號或設定的密碼都無法用來登入
LDAP_MANAGED_DETAIL = ("目前使用公司 LDAP 登入（AUTH_MODE=ldap），帳號由公司管理：使用者第一次以公司帳號登入時自動建立，"
                       "密碼請在公司系統修改")
Days = Query(30, ge=1, le=3650)


def admin_credentials() -> tuple[str, str] | None:
    """每次讀環境變數（與 store.db_path 相同），改 .env 後重新啟動即可，測試也能各自設定。"""
    username, password = os.getenv("ADMIN_USERNAME", "").strip(), os.getenv("ADMIN_PASSWORD", "")
    if not username or not password_ok(password):
        return None
    return username, password


def admin_status() -> str:
    if not os.getenv("ADMIN_USERNAME", "").strip() or not os.getenv("ADMIN_PASSWORD"):
        return "not_configured"
    return "ok" if admin_credentials() else "weak_password"


def _cred_key(creds: tuple[str, str]) -> str:
    return f"{creds[0]}\0{creds[1]}"


def require_admin(request: Request) -> str:
    creds = admin_credentials()
    if creds is None:
        raise HTTPException(status_code=503, detail="後台尚未啟用，請在 .env 設定 ADMIN_USERNAME 與 ADMIN_PASSWORD")
    if not store.admin_session_valid(request.cookies.get(ADMIN_COOKIE), _cred_key(creds)):
        raise HTTPException(status_code=401, detail="請先登入後台")
    return creds[0]


# ===================== 登入 =====================
class AdminCredentials(BaseModel):
    username: str
    password: str


@router.get("/me")
def admin_me(request: Request):
    status = admin_status()
    creds = admin_credentials()
    logged_in = creds is not None and store.admin_session_valid(request.cookies.get(ADMIN_COOKIE), _cred_key(creds))
    return {"status": status, "username": creds[0] if logged_in else None, "password_rule": PASSWORD_RULE,
            "auth_mode": auth_mode()}


@router.post("/login")
def admin_login(body: AdminCredentials, request: Request, response: Response):
    creds = admin_credentials()
    if creds is None:
        raise HTTPException(status_code=503, detail="後台尚未啟用，請在 .env 設定 ADMIN_USERNAME 與 ADMIN_PASSWORD")
    # 與一般登入共用同一套 IP 失敗鎖定，避免以後台繞過次數上限
    ip = request.client.host if request.client else "unknown"
    try:
        attempt_id, remaining = store.begin_login_attempt(ip)
    except store.LoginLocked as e:
        raise locked_error(e.locked_until)
    # 帳號與密碼都比對完才判斷，回應時間不會透露是哪一項錯誤
    user_ok = hmac.compare_digest(body.username.strip().encode(), creds[0].encode())
    pass_ok = hmac.compare_digest(body.password[:MAX_PASSWORD + 1].encode(), creds[1].encode())
    if not (user_ok and pass_ok):
        lock_minutes = store.LOGIN_LOCKOUT_MS // 60000
        detail = (f"帳號或密碼錯誤，再錯 {remaining} 次此 IP 將鎖定 {lock_minutes} 分鐘" if remaining
                  else f"帳號或密碼錯誤次數過多，此 IP 已鎖定 {lock_minutes} 分鐘")
        raise HTTPException(status_code=401 if remaining else 429, detail=detail)
    store.end_login_attempt(ip, attempt_id)
    response.set_cookie(ADMIN_COOKIE, store.create_admin_session(_cred_key(creds)),
                        max_age=store.ADMIN_SESSION_TTL_SECONDS, httponly=True, samesite="strict",
                        secure=env_flag("COOKIE_SECURE", False))
    return {"username": creds[0]}


@router.post("/logout")
def admin_logout(request: Request, response: Response):
    store.delete_admin_session(request.cookies.get(ADMIN_COOKIE))
    response.delete_cookie(ADMIN_COOKIE)
    return {"ok": True}


# ===================== 總覽 =====================
@router.get("/overview")
def admin_overview(days: int = Days, _: str = Depends(require_admin)):
    return {"days": days, "allow_registration": env_flag("ALLOW_REGISTRATION", True),
            **store.admin_overview(store.now_ms() - days * store.DAY_MS)}


# ===================== 帳號 =====================
class NewUser(BaseModel):
    username: str
    password: str


class NewPassword(BaseModel):
    password: str


@router.get("/users")
def admin_users(_: str = Depends(require_admin)):
    return store.list_users()


@router.post("/users")
def admin_add_user(body: NewUser, _: str = Depends(require_admin)):
    if auth_mode() == "ldap":
        raise HTTPException(status_code=409, detail=LDAP_MANAGED_DETAIL)
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="帳號需為 2~32 個字，只能包含文字、數字與 . _ - @")
    if not password_ok(body.password):
        raise HTTPException(status_code=400, detail=PASSWORD_RULE)
    try:
        return store.create_user(username, body.password)
    except store.UsernameTaken:
        raise HTTPException(status_code=409, detail="此帳號已存在")


@router.put("/users/{username}/password")
def admin_reset_password(username: str, body: NewPassword, _: str = Depends(require_admin)):
    if auth_mode() == "ldap":
        raise HTTPException(status_code=409, detail=LDAP_MANAGED_DETAIL)
    if not password_ok(body.password):
        raise HTTPException(status_code=400, detail=PASSWORD_RULE)
    if not store.set_password(username, body.password):
        raise HTTPException(status_code=404, detail="找不到此帳號")
    return {"ok": True}


@router.delete("/users/{username}")
def admin_delete_user(username: str, _: str = Depends(require_admin)):
    if not store.delete_user(username):
        raise HTTPException(status_code=404, detail="找不到此帳號")
    return {"ok": True}


# ===================== LLM 用量 / 意見回饋 =====================
@router.get("/usage")
def admin_usage(days: int = Days, _: str = Depends(require_admin)):
    return store.usage_by_user(store.now_ms() - days * store.DAY_MS)


@router.get("/usage/{username}")
def admin_usage_detail(username: str, days: int = Days, _: str = Depends(require_admin)):
    return store.usage_by_day(username, store.now_ms() - days * store.DAY_MS)


@router.get("/feedback")
def admin_feedback(days: int = Days, username: str | None = None, _: str = Depends(require_admin)):
    return store.list_feedback(store.now_ms() - days * store.DAY_MS, username or None)


# ===================== IP 鎖定 =====================
@router.get("/lockouts")
def admin_lockouts(_: str = Depends(require_admin)):
    return store.list_login_lockouts()


@router.delete("/lockouts/{ip}")
def admin_unlock(ip: str, _: str = Depends(require_admin)):
    return {"was_locked": store.unlock_login_ip(ip)}
