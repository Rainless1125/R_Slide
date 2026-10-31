"""帳號登入、各使用者的歷史記錄與意見回饋 API（資料存於 SQLite，見 store.py）。"""
import os
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, ValidationError

import store
from ldap_auth import LdapUnavailable, auth_mode, ldap_authenticate

router = APIRouter()

SESSION_COOKIE = "rslide_session"
USERNAME_RE = re.compile(r"^[\w.@-]{2,32}$")
# 公司 LDAP 帳號（AUTH_MODE=ldap）：可能是工號、AD 帳號或 email，字數放寬；字元限制與本機帳號相同，避免 LDAP 注入
LDAP_USERNAME_RE = re.compile(r"^[\w.@-]{1,64}$")
MIN_PASSWORD, MAX_PASSWORD = 8, 128
PASSWORD_RULE = f"密碼需為 {MIN_PASSWORD}~{MAX_PASSWORD} 個字元，且至少包含一個英文字母與一個數字"
# 投影片可能內嵌圖片（data URL），單筆紀錄上限與匯出 PPTX 相同
MAX_HISTORY_BODY_BYTES = 40 * 1024 * 1024


def password_ok(password: str) -> bool:
    """新密碼的規則（註冊、管理者建立帳號與重設密碼）；既有帳號的舊密碼不受影響，仍可登入。"""
    return (MIN_PASSWORD <= len(password) <= MAX_PASSWORD and re.search(r"[A-Za-z]", password) is not None
            and re.search(r"[0-9]", password) is not None)


def env_flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in ("1", "true", "yes", "on")


# ===================== 登入 =====================
class Credentials(BaseModel):
    username: str
    password: str


def current_user(request: Request) -> dict:
    user = store.session_user(request.cookies.get(SESSION_COOKIE), auth_mode())
    if user is None:
        raise HTTPException(status_code=401, detail="請先登入")
    return user


def start_session(response: Response, user: dict) -> dict:
    response.set_cookie(SESSION_COOKIE, store.create_session(user["id"], auth_mode()), max_age=store.SESSION_TTL_SECONDS,
                        httponly=True, samesite="lax", secure=env_flag("COOKIE_SECURE", False))
    return {"username": user["username"]}


@router.get("/api/auth/me")
def auth_me(request: Request):
    user = store.session_user(request.cookies.get(SESSION_COOKIE), auth_mode())
    return {"username": user["username"] if user else None, "auth_mode": auth_mode(),
            "allow_registration": registration_open()}


def registration_open() -> bool:
    # 公司 LDAP 登入時帳號由公司管理，不開放自行註冊
    return auth_mode() == "system" and env_flag("ALLOW_REGISTRATION", True)


def client_ip(request: Request) -> str:
    # 部署於反向代理之後時，需以 uvicorn 的 --forwarded-allow-ips 採用 X-Forwarded-For，否則所有人共用代理的 IP
    return request.client.host if request.client else "unknown"


@router.post("/api/auth/register")
def auth_register(body: Credentials, request: Request, response: Response):
    if auth_mode() == "ldap":
        raise HTTPException(status_code=403, detail="請直接以公司帳號登入，不需要註冊")
    if not registration_open():
        raise HTTPException(status_code=403, detail="目前未開放註冊，請聯絡管理員建立帳號")
    username = body.username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(status_code=400, detail="帳號需為 2~32 個字，只能包含文字、數字與 . _ - @")
    if not password_ok(body.password):
        raise HTTPException(status_code=400, detail=PASSWORD_RULE)
    try:
        user = store.register_user(username, body.password, client_ip(request))
    except store.UsernameTaken:
        raise HTTPException(status_code=409, detail="此帳號已有人使用")
    except store.RegisterLimited as e:
        raise HTTPException(status_code=429, headers={"Retry-After": str(e.retry_after)},
                            detail=f"同一個網路 24 小時內最多可註冊 {e.limit} 個帳號，請於 {store.fmt_wait(e.retry_after)}後再試，"
                                   "或聯絡管理員建立帳號")
    return start_session(response, user)


def locked_error(locked_until: int) -> HTTPException:
    seconds = max(1, -(-(locked_until - store.now_ms()) // 1000))
    return HTTPException(status_code=429, headers={"Retry-After": str(seconds)},
                         detail=f"密碼錯誤次數過多，此 IP 已暫時鎖定，請於 {-(-seconds // 60)} 分鐘後再試")


@router.post("/api/auth/login")
def auth_login(body: Credentials, request: Request, response: Response):
    ip = client_ip(request)
    try:
        attempt_id, remaining = store.begin_login_attempt(ip)
    except store.LoginLocked as e:
        raise locked_error(e.locked_until)
    try:
        user = authenticate(body.username.strip(), body.password[:MAX_PASSWORD + 1])
    except LdapUnavailable as e:
        # 伺服器連不上不是密碼錯誤：撤銷這次預先登記的失敗，不讓使用者因此被鎖定
        store.end_login_attempt(ip, attempt_id)
        raise HTTPException(status_code=503, detail=str(e))
    if user is None:
        lock_minutes = store.LOGIN_LOCKOUT_MS // 60000
        detail = (f"帳號或密碼錯誤，再錯 {remaining} 次此 IP 將鎖定 {lock_minutes} 分鐘" if remaining
                  else f"帳號或密碼錯誤次數過多，此 IP 已鎖定 {lock_minutes} 分鐘")
        raise HTTPException(status_code=401 if remaining else 429, detail=detail)
    store.end_login_attempt(ip, attempt_id)
    return start_session(response, user)


def authenticate(username: str, password: str) -> dict | None:
    """依 AUTH_MODE 驗證帳號密碼，成功時回傳本機帳號（LDAP 帳號第一次登入時自動建立）。"""
    if auth_mode() != "ldap":
        return store.authenticate(username, password)
    if not LDAP_USERNAME_RE.match(username) or not ldap_authenticate(username, password):
        return None
    return store.get_or_create_external_user(username)


@router.post("/api/auth/logout")
def auth_logout(request: Request, response: Response):
    store.delete_session(request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


# ===================== 歷史記錄 =====================
class HistoryItem(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    title: str = Field(min_length=1, max_length=200)
    input: dict
    data: dict
    createdAt: int | None = None


class HistoryImport(BaseModel):
    items: list[Any] = Field(max_length=store.MAX_HISTORY_PER_USER)    # 逐筆驗證，見 history_import


class HistoryPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    input: dict | None = None      # 生成設定（例如重產時改用另一種簡報模式）
    data: dict | None = None


async def read_body(request: Request, model: type[BaseModel]):
    """先以 Content-Length 擋下過大的請求，再解析並驗證 JSON。"""
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        raise HTTPException(status_code=411, detail="缺少 Content-Length")
    if int(length) > MAX_HISTORY_BODY_BYTES:
        raise HTTPException(status_code=413, detail="簡報內容過大，無法儲存")
    try:
        return model.model_validate(await request.json())
    except (ValueError, ValidationError):
        raise HTTPException(status_code=400, detail="歷史記錄資料格式不正確")


@router.get("/api/history")
def history_list(user: dict = Depends(current_user)):
    return store.list_history(user["id"])


@router.get("/api/history/{item_id}")
def history_get(item_id: str, user: dict = Depends(current_user)):
    item = store.get_history(user["id"], item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="找不到此紀錄")
    return item


@router.post("/api/history")
async def history_add(request: Request, user: dict = Depends(current_user)):
    item = await read_body(request, HistoryItem)
    await run_in_threadpool(store.add_history, user["id"], [item.model_dump()])
    return {"ok": True}


@router.post("/api/history/import")
async def history_import(request: Request, user: dict = Depends(current_user)):
    """匯入舊版存在瀏覽器 localStorage 的紀錄：格式不符的單筆略過，不讓整批失敗。"""
    body = await read_body(request, HistoryImport)
    valid = []
    for raw in body.items:
        try:
            valid.append(HistoryItem.model_validate(raw).model_dump())
        except ValidationError:
            pass
    # 已在伺服器上的同 id 紀錄不覆蓋（例如在另一台電腦已匯入並修改過）
    await run_in_threadpool(store.add_history, user["id"], valid, False)
    return {"imported": len(valid), "skipped": len(body.items) - len(valid)}


@router.patch("/api/history/{item_id}")
async def history_update(item_id: str, request: Request, user: dict = Depends(current_user)):
    patch = await read_body(request, HistoryPatch)
    ok = await run_in_threadpool(store.update_history, user["id"], item_id, patch.title, patch.data, patch.input)
    if not ok:
        raise HTTPException(status_code=404, detail="找不到此紀錄")
    return {"ok": True}


@router.delete("/api/history/{item_id}")
def history_delete(item_id: str, user: dict = Depends(current_user)):
    store.delete_history(user["id"], item_id)
    return {"ok": True}


@router.delete("/api/history")
def history_clear(user: dict = Depends(current_user)):
    store.delete_history(user["id"])
    return {"ok": True}


# ===================== 意見回饋 =====================
class FeedbackBody(BaseModel):
    content: str = Field("", max_length=store.MAX_FEEDBACK_CHARS)
    rating: int | None = Field(None, ge=1, le=5)     # 使用體驗 1~5 星，選填


@router.post("/api/feedback")
def feedback_add(body: FeedbackBody, request: Request, user: dict = Depends(current_user)):
    content = body.content.strip()
    if not content and body.rating is None:
        raise HTTPException(status_code=400, detail="請選擇使用體驗評分或輸入回饋內容")
    try:
        store.add_feedback(user, content, body.rating, request.client.host if request.client else None)
    except store.FeedbackRateLimited:
        raise HTTPException(status_code=429, detail="回饋送出太頻繁，請稍後再試")
    return {"ok": True}
