import os
import re
import json
import base64
import hashlib
import logging
import time
from contextlib import contextmanager
from typing import Literal
from pathlib import Path
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from openai import BadRequestError, OpenAI
from starlette.datastructures import UploadFile

import store
from accounts import current_user, env_flag, router as accounts_router
from deck_design import (CONTENT_ACCURACY_RULES, DECK_RHYTHM_RULES, LAYOUT_CATALOG, THEME_RULES, DeckTheme,
                         format_theme, theme_from_input)
from admin import router as admin_router
from charts import CHART_RULES, MAX_CHARTS_PER_SLIDE, ChartSpec, normalize_charts
from exporter import ExportError, build_pptx
from extract import MAX_REQUEST_BYTES, ExtractError, extract_text
from slide_images import SlideImageReadings, read_slide_images

logger = logging.getLogger("rslide")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"   # 以本檔所在位置為基準，從其他目錄啟動 uvicorn 也找得到

load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MY_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
DEFAULT_OPENAI_MODELS = ["gpt-6-luna"]


def parse_model_list(value: str | None) -> list[str]:
    """以逗號分隔的模型清單（.env 用），去除空白與重複。"""
    return list(dict.fromkeys(m.strip() for m in (value or "").split(",") if m.strip()))


# HTTP 標頭名稱（RFC 9110 token）；值只允許可見的 ASCII 字元與空白
HEADER_NAME_RE = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
HEADER_VALUE_RE = re.compile(r"^[\x20-\x7e]*$")


def parse_extra_headers(value: str | None) -> dict[str, str]:
    """LLM_EXTRA_HEADERS：呼叫 LLM 時附加的 HTTP 標頭（JSON 物件），例如公司 AI 閘道要求的
    {"system_name": "R_Slide", "use_area": "F12"}。格式錯誤時啟動失敗並說明原因，避免呼叫時才被閘道拒絕。"""
    if not value or not value.strip():
        return {}
    try:
        headers = json.loads(value)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM_EXTRA_HEADERS 必須是 JSON 物件，例如 {{\"system_name\": \"R_Slide\"}}：{e}") from e
    if not isinstance(headers, dict):
        raise ValueError("LLM_EXTRA_HEADERS 必須是 JSON 物件，例如 {\"system_name\": \"R_Slide\"}")
    out = {}
    for name, val in headers.items():
        val = val if isinstance(val, str) else json.dumps(val) if isinstance(val, (int, float)) else None
        if val is None:
            raise ValueError(f"LLM_EXTRA_HEADERS 的 {name} 必須是文字或數字")
        if not HEADER_NAME_RE.match(name):
            raise ValueError(f"LLM_EXTRA_HEADERS 的標頭名稱「{name}」只能使用英數字與 - _ . 等符號")
        if not HEADER_VALUE_RE.match(val):
            raise ValueError(f"LLM_EXTRA_HEADERS 的 {name} 只能使用英數字與符號（HTTP 標頭不支援中文）")
        out[name] = val
    return out


LLM_EXTRA_HEADERS = parse_extra_headers(os.getenv("LLM_EXTRA_HEADERS"))

# OpenAI 或 OpenAI 相容端點（公司內部 AI 閘道、Azure OpenAI、Databricks、vLLM、Ollama 等）：
# 設定 OPENAI_BASE_URL 時改連該網址，模型清單由 OPENAI_MODELS 決定，畫面上的平台名稱由 OPENAI_DISPLAY_NAME 決定
OPENAI_BASE_URL = (os.getenv("OPENAI_BASE_URL") or "").strip().rstrip("/") or None
OPENAI_MODELS = parse_model_list(os.getenv("OPENAI_MODELS")) or DEFAULT_OPENAI_MODELS
OPENAI_DISPLAY_NAME = ((os.getenv("OPENAI_DISPLAY_NAME") or "").strip()[:40]
                       or ("OpenAI 相容端點" if OPENAI_BASE_URL else "OpenAI"))

# 舊版的 Databricks 專用設定已移除：Databricks 也是 OpenAI 相容端點，改用 OPENAI_* 設定
if any(os.getenv(k) for k in ("DATABRICKS_HOST", "DATABRICKS_TOKEN", "DATABRICKS_MODELS", "DATABRICKS_BASE_URL")):
    logger.warning("DATABRICKS_* 設定已不再使用，請改為 OPENAI_API_KEY=<token>、"
                   "OPENAI_BASE_URL=https://<workspace>/serving-endpoints、OPENAI_MODELS=<模型名稱>")

if not MY_GEMINI_API_KEY and not MY_OPENAI_API_KEY:
    raise ValueError("找不到 API Key，請在 .env 檔案中至少設定 GEMINI_API_KEY 或 OPENAI_API_KEY"
                     "（公司內部或其他 OpenAI 相容端點另外設定 OPENAI_BASE_URL 與 OPENAI_MODELS）！")

_headers = LLM_EXTRA_HEADERS or None
gemini_client = (genai.Client(api_key=MY_GEMINI_API_KEY, http_options=types.HttpOptions(headers=_headers))
                 if MY_GEMINI_API_KEY else None)
openai_client = (OpenAI(api_key=MY_OPENAI_API_KEY, base_url=OPENAI_BASE_URL, default_headers=_headers)
                 if MY_OPENAI_API_KEY else None)
app = FastAPI(title="R Slide")

# 各平台可選模型（第一個為預設）；OpenAI 的模型清單可由 .env 的 OPENAI_MODELS 改寫
MODEL_CATALOG = {
    "gemini": ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.8-flash"],
    "openai": OPENAI_MODELS,
}
MISSING_KEY_MSG = {
    "gemini": "未設定 GEMINI_API_KEY",
    "openai": "未設定 OPENAI_API_KEY",
}


def provider_client(provider: str):
    return {"gemini": gemini_client, "openai": openai_client}.get(provider)


def parse_json_reply(text: str, schema: type[BaseModel]) -> dict:
    """從模型的文字回覆取出 JSON（容許 ```json 區塊或前後多餘文字），並以 schema 驗證。"""
    text = (text or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型沒有回傳 JSON")
    return schema.model_validate_json(text[start:end + 1]).model_dump()


def token_usage(input_tokens, output_tokens, total_tokens=None, cached_tokens=None, reasoning_tokens=None) -> dict:
    """統一各平台回傳的 token 數；平台沒給合計時以輸入 + 輸出計算。"""
    if total_tokens is None and input_tokens is not None and output_tokens is not None:
        total_tokens = input_tokens + output_tokens
    return {"input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": total_tokens,
            "cached_tokens": cached_tokens, "reasoning_tokens": reasoning_tokens}


def openai_usage(completion) -> dict:
    u = getattr(completion, "usage", None)   # 部分 OpenAI 相容端點不回傳 usage
    if u is None:
        return {}
    return token_usage(getattr(u, "prompt_tokens", None), getattr(u, "completion_tokens", None),
                       getattr(u, "total_tokens", None),
                       getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", None),
                       getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", None))


def gemini_usage(response) -> dict:
    u = getattr(response, "usage_metadata", None)
    if u is None:
        return {}
    return token_usage(getattr(u, "prompt_token_count", None), getattr(u, "candidates_token_count", None),
                       getattr(u, "total_token_count", None), getattr(u, "cached_content_token_count", None),
                       getattr(u, "thoughts_token_count", None))


def call_openai_compatible(client: OpenAI, model: str, system_instruction: str, prompt: str | list,
                           schema: type[BaseModel], allow_fallback: bool, usage: dict | None = None) -> dict:
    usage = {} if usage is None else usage
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": prompt},
    ]
    try:
        # 部分 OpenAI 模型（如推理類）只接受預設 temperature，故不傳入
        completion = client.beta.chat.completions.parse(model=model, messages=messages, response_format=schema)
        usage.update(openai_usage(completion))
        message = completion.choices[0].message
        if message.refusal:
            raise HTTPException(status_code=502, detail=f"模型拒絕回應: {message.refusal}")
        if message.parsed is not None:
            return message.parsed.model_dump()
        if not allow_fallback:
            raise HTTPException(status_code=502, detail="模型回傳的資料無法解析")
        return parse_json_reply(message.content, schema)
    except BadRequestError:
        # 部分 OpenAI 相容端點（Databricks、vLLM 等）不支援嚴格的 json_schema 結構化輸出：改為在提示詞附上 schema，回覆後再由後端驗證
        if not allow_fallback:
            raise
    fallback_system = (system_instruction + "\n\n【輸出格式】：只輸出一個符合下列 JSON Schema 的 JSON 物件，"
                       "不要加上 Markdown 區塊或任何說明文字。\n"
                       + json.dumps(schema.model_json_schema(), ensure_ascii=False))
    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": fallback_system}, {"role": "user", "content": prompt}],
    )
    usage.update(openai_usage(completion), fallback=1)
    return parse_json_reply(completion.choices[0].message.content, schema)


def gemini_response_text(response) -> str:
    """取出 Gemini 回覆文字；被安全機制擋下、沒有輸出或輸出被截斷時，改回傳說明原因的錯誤，
    而不是讓 json.loads 失敗後被當成「格式有誤」（這類情況重試通常也沒用）。"""
    feedback = getattr(response, "prompt_feedback", None)
    block = getattr(feedback, "block_reason", None)
    if block:
        raise HTTPException(status_code=502, detail=f"模型拒絕回應: 提示內容被 Gemini 安全機制擋下（{getattr(block, 'name', block)}）")
    candidates = getattr(response, "candidates", None) or []
    finish = getattr(candidates[0], "finish_reason", None) if candidates else None
    reason = getattr(finish, "name", None) or (str(finish) if finish else "")
    if reason == "MAX_TOKENS":
        raise HTTPException(status_code=502, detail="AI 輸出超過長度上限（MAX_TOKENS）")
    text = response.text
    if not text:
        if reason in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"):
            raise HTTPException(status_code=502, detail=f"模型拒絕回應: 輸出被 Gemini 安全機制擋下（{reason}）")
        raise HTTPException(status_code=502, detail=f"模型沒有回傳內容（{reason or '未知原因'}）")
    return text


def call_llm(provider: str, model: str, system_instruction: str, prompt: str,
             schema: type[BaseModel], temperature: float, usage: dict | None = None,
             images: list[tuple[bytes, str]] | None = None) -> dict:
    """依平台呼叫 LLM，回傳符合 schema 的 dict。傳入 usage 時會填入實際使用的模型與 token 數（供使用紀錄）。
    images 為 [(圖片資料, MIME)]，依序附在提示之後（模型需支援圖片輸入）。"""
    usage = {} if usage is None else usage
    provider = (provider or "gemini").lower()
    if provider not in MODEL_CATALOG:
        raise HTTPException(status_code=400, detail=f"不支援的平台: {provider}")
    client = provider_client(provider)
    if client is None:
        raise HTTPException(status_code=400, detail=MISSING_KEY_MSG[provider])
    if model and model not in MODEL_CATALOG[provider]:
        raise HTTPException(status_code=400, detail=f"未開放的模型: {model}")
    model = model or MODEL_CATALOG[provider][0]
    usage.update(provider=provider, model=model)

    if provider == "gemini":
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction=system_instruction
        )
        contents = [prompt, *(types.Part.from_bytes(data=d, mime_type=m) for d, m in images)] if images else prompt
        response = client.models.generate_content(model=model, contents=contents, config=config)
        usage.update(gemini_usage(response))   # 先記用量：被擋下或輸出被截斷時 token 也已經用掉了
        return json.loads(gemini_response_text(response))

    if images:
        prompt = [{"type": "text", "text": prompt}, *({"type": "image_url", "image_url": {
            "url": f"data:{m};base64,{base64.b64encode(d).decode()}", "detail": "high"}} for d, m in images)]
    # 自訂的 OpenAI 相容端點不一定支援嚴格的結構化輸出，失敗時改用提示詞附 schema 的方式
    return call_openai_compatible(client, model, system_instruction, prompt, schema,
                                  allow_fallback=bool(OPENAI_BASE_URL), usage=usage)


@contextmanager
def llm_usage_log(request: Request, user: dict, action: str, req):
    """記錄一次 LLM 呼叫（成功或失敗都記）；區塊內把 usage 傳給 call_llm 以填入模型與 token 數。
    進入區塊前先檢查該帳號的次數上限並登記（見 store.begin_llm_call），超過上限時回 429、不呼叫 LLM。
    結束時的紀錄更新失敗只記 log，不影響使用者的生成結果。"""
    usage = {"provider": (req.provider or "gemini").lower(), "model": req.model}
    base = {
        "user_id": user["id"], "username": user["username"], "action": action,
        "deck_mode": req.deck_mode, "num_pages": req.num_pages, "input_chars": len(req.content),
        "content_hash": hashlib.sha256(req.content.encode()).hexdigest(),
        # 部署於反向代理之後時，uvicorn 的 --forwarded-allow-ips 決定是否採用 X-Forwarded-For
        "client_ip": request.client.host if request.client else None,
    }
    try:
        usage_id = store.begin_llm_call({**base, **usage})
    except store.LlmRateLimited as e:
        raise HTTPException(status_code=429, detail=str(e), headers={"Retry-After": str(e.retry_after)})
    status, http_status, error = "ok", 200, None
    start = time.monotonic()
    try:
        yield usage
    except HTTPException as e:
        status, http_status, error = "error", e.status_code, str(e.detail)
        raise
    except Exception as e:
        status, http_status, error = "error", 500, str(e)
        raise
    finally:
        try:
            store.finish_llm_call(usage_id, {
                **base, **usage, "status": status, "http_status": http_status,
                "error": error[:200] if error else None, "latency_ms": int((time.monotonic() - start) * 1000),
            })
        except Exception:
            logger.exception("寫入 LLM 使用紀錄失敗")


# 1. Pydantic 模型定義
class AdaptiveSlide(BaseModel):
    page_number: int = Field(description="頁碼 (1, 2, 3...)")
    layout_concept: str = Field(description="採用的版型概念說明")
    slide_title: str = Field(description="此頁的核心大綱標題")
    html_content: str = Field(
        description="""
        這一頁投影片的完整 HTML 代碼 (純 HTML + Tailwind CSS class)。
        畫布固定為 1024×576 px，超出部分會被裁掉。
        必須以 <div class="w-full h-full overflow-hidden flex flex-col p-10 ..."> 作為最外層容器，主要內容區使用 flex-1 min-h-0。
        請嚴格依據使用者指定的【視覺風格】來配置 Tailwind 顏色 (包含 bg-xxx, text-xxx, border-xxx 等)，切勿千篇一律使用深色。
        需要圖表時放入 <div data-rs-chart="索引"></div> 佔位容器，資料寫在 charts。
        """
    )
    charts: list[ChartSpec] = Field(description="此頁的圖表資料，依 data-rs-chart 索引對應；沒有圖表時為空陣列")
    speaker_notes: str = Field(description="講者備註：講者上台時照著說的口語講稿（純文字，不含 HTML），規則見【講者備註】")


class SlideInput(AdaptiveSlide):
    """前端送回的投影片：舊版歷史紀錄沒有 charts / speaker_notes，且圖表資料已在前端正規化過，因此放寬驗證。
    charts 可能含 None（無法使用的圖表保留索引位置，見 normalize_charts）。"""
    charts: list[dict | None] = Field(default_factory=list)
    speaker_notes: str = ""

class AdaptivePresentation(BaseModel):
    presentation_title: str = Field(description="整份簡報的大標題")
    # theme 放在 slides 之前：LLM 依欄位順序輸出，先決定設計規範再產生每一頁
    theme: DeckTheme = Field(description="整份簡報共用的設計規範（配色、卡片、標題樣式），每一頁都要套用，規則見【整份簡報的設計規範】")
    slides: list[AdaptiveSlide] = Field(description="動態排版的多頁投影片清單")


# 大綱：先讓使用者確認每頁的標題與重點（可改字、調順序、增刪頁），再依大綱生成完整版面
class OutlineSlide(BaseModel):
    slide_title: str = Field(description="此頁標題")
    key_points: list[str] = Field(description="此頁要傳達的重點，每點一句話")
    layout_concept: str = Field(description="建議的版型概念，例如「KPI 大數字」「三步驟流程卡」「左右對比」")


class DeckOutline(BaseModel):
    presentation_title: str = Field(description="整份簡報的大標題")
    slides: list[OutlineSlide] = Field(description="依頁序排列的每頁大綱")

MAX_CONTENT_CHARS = 50_000
MAX_PAGES = 20
# 生成與重產的欄位上限：送進 LLM 的提示詞都由這些欄位組成，避免超大請求消耗大量 token（前端輸入框也有相同上限）
MAX_LLM_BODY_BYTES = 2 * 1024 * 1024          # 重產會送回整份簡報（圖片已換成 rs-img 代號），正常遠小於此
MAX_AUDIENCE_CHARS = 200
MAX_STYLE_CHARS = 1000                        # 自訂配色組出的風格描述約 300 字
MAX_TITLE_CHARS = 200
MAX_CUSTOM_PROMPT_CHARS = 2000
MAX_MODEL_CHARS = 100
MAX_REGEN_SLIDES = 60                         # 與 PPTX 匯出的頁數上限相同
MAX_SLIDE_META_CHARS = 500                    # 每頁的標題與版型概念（組成整份簡報大綱）
MAX_SLIDE_HTML_CHARS = 50_000
MAX_SLIDE_NOTES_CHARS = 5000
MAX_SLIDE_CHARTS_CHARS = 20_000
MAX_OUTLINE_POINTS = 8                        # 使用者確認後送回的大綱：每頁重點數與每點字數上限
MAX_OUTLINE_POINT_CHARS = 300

# 投影片固定以 1024×576 px 渲染（static/index.html 與 export.js 的 .slide-scaler），超出部分會被裁掉
SLIDE_LAYOUT_RULES = """
    【版面尺寸硬性限制（最優先，內容超出畫面即視為失敗）】：
    1. 每頁畫布固定為 1024 × 576 px（16:9），不會捲動，超出的內容會被直接裁掉看不見。
    2. 最外層容器固定寫法：<div class="w-full h-full overflow-hidden flex flex-col p-10 ...">（padding 介於 p-8 ~ p-12）。
       主要內容區使用 flex-1 min-h-0，只能使用剩餘高度。
       禁止使用 h-screen、min-h-screen、vh 單位，也禁止任何超過 576px 的固定高度或寬度超過 1024px。
    3. 垂直空間預算（扣除上下 padding 後約剩 490px）：
       - 頁首（小標籤 + 主標題 + 副標題）合計不超過約 140px。
       - 主要內容區約 300px。
       - 頁尾註記 / 結論列最多一列、約 40px；非必要就不要放。
    4. 內容量與字級依【簡報模式】的規定；以下為兩種模式共通的上限：
       - 主標題 1 個，最大 text-4xl；只有封面或單一大數字頁可用 text-5xl ~ text-6xl。
       - 卡片 / 欄位 / 步驟最多 4 個並排、最多 2 列。
       - 卡片內距 p-5 ~ p-6；區塊間距 gap-4 ~ gap-6；不要使用 p-10 以上的卡片內距或 mb-12 以上的間距。
       - 素材太多時請精簡、合併重點（頁數由你決定時可拆成更多頁），絕對不要把所有文字硬塞進同一頁。
    5. 輸出前請自行估算：各區塊高度相加（含 padding、gap、margin、圖示）必須小於 576px。
       若可能超出，先刪減文字，其次縮小字級與間距，最後才刪除次要區塊（例如頁尾列）。
    6. 空間分配要平衡，卡片外與卡片內都不要留下大片空白：
       - 卡片高度依內容決定。內容少時不要用 h-full / flex-1 把卡片拉長到填滿畫面，改為讓整組卡片在內容區垂直置中（justify-center），
         並列的卡片以 items-stretch 讓彼此等高即可。
       - 卡片內的元素由上而下以 gap 排列，不要用 justify-between、mt-auto 或 flex-1 把數字或說明推到卡片底部。
       - 畫面仍顯得空時，放大重點數字與字級、加大卡片內距，或補上一句來自素材的說明，而不是留白或拉長卡片。
       - 垂直置中後，內容群組與頁首、頁尾之間的空白各不要超過約 60px；超過時依序放大重點數字與字級、加大卡片內距與間距，
         讓內容群組約占主要內容區高度的七成以上（仍須遵守 576px 的上限）。
       - 不要讓區塊擠在上方，或被撐到上下兩端而在中間留下大片空白。
    7. 同一組並列的數字卡片或目標卡片，結構與排版要一致：數字的位置、字級與對齊方式相同，素材有單位時每個數字都要附上單位；
       需要強調其中一張時只改變底色或邊框，不要改變內部結構。
    8. 所有元素都必須在所屬的卡片或容器內，不要用負 margin、絕對定位或過大的固定寬高讓元素超出容器。
    9. 不要放沒有功能的裝飾元素，例如假的頁碼圓點、輪播指示點、看起來可以點的按鈕或連結；裝飾只用色塊、線條與圖示。
"""


# 講者備註只出現在播放器的備註區與 PPTX 備忘稿，不會畫在投影片上，因此不受版面字數限制
SPEAKER_NOTES_RULES = """
    【講者備註（speaker_notes）】：
    1. 每頁都要提供講者備註：講者上台時可以直接照著念的口語講稿，使用與原始素材相同的語言。
    2. 長度依【簡報模式】的規定；封面與結尾頁可較短。
    3. 內容要補充畫面上沒有寫出的脈絡、數據來源、舉例或轉場，不要逐字重複投影片上的文字。
    4. 最後一句可以自然帶出下一頁的主題（最後一頁則做總結或呼籲行動）。
    5. 只輸出純文字，不要 HTML、Markdown 符號或 emoji；換段可使用換行。
"""


# 簡報模式：演講型（講者在台上說、畫面只放重點）與閱讀型（會後寄送、不靠講者也能看懂）是兩種不同的溝通場景，
# 差別在於「訊息放在畫面上還是講者嘴裡」，因此畫面文字量、字級與講者備註長度都依模式切換
DECK_MODE_RULES = {
    "speaker": """
    【簡報模式：簡易模式（演講型 / Speaker Deck）】：
    這份簡報由講者上台口頭說明，畫面只是視覺輔助，觀眾一眼就要看懂，細節由講者說出來。
    1. 一頁只傳達一個核心訊息；頁數由你決定時寧可拆成更多頁，頁數已指定時則精簡成最重要的訊息，不要在同一頁塞多個重點。
    2. 畫面文字極度精簡：副標題最多 1 句、不超過 20 字；條列最多 3 點、每點不超過 15 字；
       卡片內文不超過 20 字、最多 2 行。能用關鍵字就不用句子。
    3. 優先使用大數字、大型圖示、圖表或單一強調句來呈現，保留大量留白。
    4. 字級偏大：卡片標題 text-xl ~ text-2xl；內文 text-base ~ text-lg；不要用 text-xs 寫正文。
    5. 被省略的論述、數據細節與舉例全部移到講者備註。
    6. 講者備註是完整口語講稿：約 150 ~ 300 字、3 ~ 6 句，講者照著念就能把這頁講完。
""",
    "document": """
    【簡報模式：詳細模式（閱讀型 / Document Deck）】：
    這份簡報會在會後寄送或自行閱讀，沒有講者在旁說明，讀者必須只看畫面就能完整理解。
    1. 主標題寫成完整的結論句（例如「第三季營收成長 18%，主因為新客戶擴張」），而不是單一名詞。
    2. 標題下方放一句導言 / 摘要（不超過 40 字），交代這頁的重點與脈絡。
    3. 內文要有完整的論述與支撐證據：條列最多 6 點、每點不超過 40 字；卡片內文不超過 80 字、最多 4 行；
       用完整句子說明原因、影響與數據，不要只放關鍵字。
    4. 數據要寫出單位、比較基準與期間；有出處時以頁尾註記（text-xs）標示資料來源。
    5. 字級偏小以容納資訊：卡片標題 text-base ~ text-lg；內文 text-sm；註記與來源 text-xs。
       仍須遵守版面尺寸限制，不可超出畫面：頁數由你決定時把資訊拆成更多頁，頁數已指定時則精簡、合併論述。
    6. 講者備註只做補充：約 50 ~ 120 字、1 ~ 3 句，補充延伸資訊或閱讀重點，不重複畫面內容。
""",
}
DECK_MODE_LABELS = {"speaker": "簡易模式（演講型 / Speaker Deck）", "document": "詳細模式（閱讀型 / Document Deck）"}
DeckMode = Literal["speaker", "document"]


def check_field_lengths(req):
    """欄位超過上限時回 400（訊息直接顯示給使用者）；在登記呼叫次數之前檢查，格式不符的請求不算次數。"""
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
    limits = [("內容", req.content, MAX_CONTENT_CHARS), ("目標受眾", req.target_audience, MAX_AUDIENCE_CHARS),
              ("視覺風格", req.style_preference, MAX_STYLE_CHARS), ("平台", req.provider, MAX_MODEL_CHARS),
              ("模型名稱", req.model, MAX_MODEL_CHARS)]
    if isinstance(req, RegenerateSlideRequest):
        limits += [("簡報標題", req.presentation_title, MAX_TITLE_CHARS),
                   ("重產提示詞", req.custom_prompt, MAX_CUSTOM_PROMPT_CHARS)]
    outline = getattr(req, "outline", None)
    if outline is not None:
        if not outline.slides:
            raise HTTPException(status_code=400, detail="大綱至少需要 1 頁")
        if len(outline.slides) > MAX_PAGES:
            raise HTTPException(status_code=400, detail=f"大綱超過 {MAX_PAGES} 頁")
        limits.append(("簡報標題", outline.presentation_title, MAX_TITLE_CHARS))
        for i, s in enumerate(outline.slides, 1):
            if len(s.key_points) > MAX_OUTLINE_POINTS:
                raise HTTPException(status_code=400, detail=f"大綱第 {i} 頁的重點超過 {MAX_OUTLINE_POINTS} 點")
            limits += [(f"大綱第 {i} 頁的標題", s.slide_title, MAX_SLIDE_META_CHARS),
                       (f"大綱第 {i} 頁的版型", s.layout_concept, MAX_SLIDE_META_CHARS)]
            limits += [(f"大綱第 {i} 頁的重點", p, MAX_OUTLINE_POINT_CHARS) for p in s.key_points]
    for label, value, limit in limits:
        if len(value) > limit:
            raise HTTPException(status_code=400, detail=f"{label}過長（上限 {limit:,} 字）")


class GenerateRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = Field(3, ge=0, le=MAX_PAGES)  # 0 = 由 AI 決定
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"  # 新增：接收前端傳來的風格
    deck_mode: DeckMode = "speaker"
    provider: str = "gemini"
    model: str = ""
    outline: DeckOutline | None = None            # 使用者確認過的大綱；有值時依大綱生成，頁數以大綱為準

class RegenerateSlideRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = Field(3, ge=0, le=MAX_PAGES)
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"
    presentation_title: str = "未命名簡報"
    deck_mode: DeckMode = "speaker"
    slide_index: int
    slides: list[SlideInput]
    custom_prompt: str = ""
    theme: dict | None = None                     # 整份簡報的設計規範（舊簡報沒有），見 deck_design.py
    provider: str = "gemini"
    model: str = ""

# 2. API 端點
LLM_PATHS = {"/api/generate", "/api/outline", "/api/regenerate-slide"}


@app.middleware("http")
async def limit_llm_body(request: Request, call_next):
    """生成與重產的請求在解析 JSON 之前先以 Content-Length 擋下過大的請求（其他 API 各自檢查）。"""
    if request.method == "POST" and request.url.path in LLM_PATHS:
        length = request.headers.get("content-length")
        if not length or not length.isdigit():
            return JSONResponse({"detail": "缺少 Content-Length"}, status_code=411)
        if int(length) > MAX_LLM_BODY_BYTES:
            return JSONResponse({"detail": "請求內容過大，請精簡素材或投影片內容後再試"}, status_code=413)
    return await call_next(request)

@app.get("/api/models")
async def list_models():
    data = {provider: {"available": provider_client(provider) is not None, "models": models}
            for provider, models in MODEL_CATALOG.items()}
    # 自訂端點顯示設定的名稱與通用圖示，避免畫面顯示「OpenAI」但實際連的是公司內部的模型
    data["openai"].update(name=OPENAI_DISPLAY_NAME, custom=bool(OPENAI_BASE_URL))
    return data

@app.get("/api/quota")
def llm_quota(user: dict = Depends(current_user)):
    """目前帳號的生成 / 重產剩餘次數；hour、day 為 null 表示該區間不限制。"""
    return store.llm_quota(user["id"])

@app.post("/api/generate")
def generate_slides(req: GenerateRequest, request: Request, user: dict = Depends(current_user)):
    check_field_lengths(req)

    system_instruction = """
    你是一位榮獲世界設計大獎的簡報架構與 UI 設計師。
    你的任務是將使用者提供的原始內容，規劃為多頁「版面各異、針對內容最適化」的現代簡報。
    
    【設計核心準則】：
    1. 拒絕單一死板模板：每一頁依內容從【版型目錄】挑選最適合的版型，並遵守【整份簡報的節奏】；
       內容有可比較的數值（趨勢、占比、排名）時，請搭配圖表呈現（見下方【圖表】規則）。
    2. 視覺與配色規範：
       - 僅輸出 Tailwind CSS class。
       - 禁止使用emoji，請一律使用font-awesome圖示。
       - 【重要】你必須絕對服從使用者指定的「視覺風格」。如果要求明亮風，請多用 bg-white/bg-slate-50；如果要求科技風，才使用深色底 bg-slate-900 搭配螢光點綴色。
    """ + THEME_RULES + LAYOUT_CATALOG + DECK_RHYTHM_RULES + SLIDE_LAYOUT_RULES + DECK_MODE_RULES[req.deck_mode] \
        + CHART_RULES + SPEAKER_NOTES_RULES + CONTENT_ACCURACY_RULES

    outline_block = ""
    if req.outline:
        # 大綱經過使用者確認：頁數、頁序與每頁主題以大綱為準，素材只用來補足細節
        n = len(req.outline.slides)
        pages_hint = f"{n} 頁（依使用者確認的大綱，必須剛好 {n} 頁，不可增減或調換頁序）"
        outline_block = f"""
    【使用者確認的大綱（最優先，必須照做）】：
    簡報標題：{req.outline.presentation_title}
{format_outline(req.outline)}
    每一頁的標題與重點以大綱為準（可微調措辭以符合版面字數），版型概念為建議、可依內容調整；
    頁數與頁序以大綱為準，【整份簡報的節奏】只用來決定每頁的版型，不要因此增加、刪除或調換頁面；
    使用者刪掉的主題不要再加回來，使用者新增的重點即使素材沒有提到也要呈現。
"""
    else:
        # 頁數固定時，模式規則中的「拆成更多頁」改以精簡內容達成，避免與指定頁數衝突
        pages_hint = (f"{req.num_pages} 頁（頁數固定，必須剛好 {req.num_pages} 頁；素材太多時請精簡文字、合併重點，不可增加頁數）"
                      if req.num_pages > 0 else "由你依內容多寡與重點自行決定（建議 3~8 頁）")
    prompt = f"""
    【簡報目標客群】：{req.target_audience}
    【預計生成頁數】：{pages_hint}
    【簡報模式】：{DECK_MODE_LABELS[req.deck_mode]}
    【指定視覺風格】：{req.style_preference} (請利用 Tailwind CSS 確實實踐此氛圍)
    【原始素材內容】：
    {req.content}
    {outline_block}
    請深入理解內容，依【簡報模式】決定每頁的文字量，為每一頁構思最能凸顯該主題的獨特版面，並確保整體色彩與背景符合指定的【視覺風格】。
    """
    
    with llm_usage_log(request, user, "generate", req) as usage:
        try:
            data = call_llm(req.provider, req.model, system_instruction, prompt, AdaptivePresentation, 0.6, usage)
            data["theme"] = theme_from_input(data.get("theme"))   # 去除多餘空白、限制長度；格式不符時為 None
            for slide in data.get("slides") or []:
                slide["charts"] = normalize_charts(slide.get("charts"))
            usage["slides_returned"] = len(data.get("slides") or [])
            return data
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))


def format_outline(outline: DeckOutline) -> str:
    lines = []
    for i, s in enumerate(outline.slides, 1):
        lines.append(f"    第 {i} 頁｜{s.slide_title}｜建議版型：{s.layout_concept or '（由你決定）'}")
        lines += [f"      - {p}" for p in s.key_points if p.strip()]
    return "\n".join(lines)


@app.post("/api/outline")
def generate_outline(req: GenerateRequest, request: Request, user: dict = Depends(current_user)):
    """先產生大綱（每頁標題、重點、建議版型）讓使用者確認，只有文字、不含版面，比整份生成快。"""
    req.outline = None
    check_field_lengths(req)

    system_instruction = """
    你是一位資深的簡報架構顧問。
    你的任務是把使用者提供的原始內容規劃成簡報大綱：決定頁數、頁序、每頁標題與要傳達的重點，以及建議的版型。
    這份大綱會先交給使用者修改確認，之後才依大綱設計版面，因此現在只需要規劃內容結構，不要輸出 HTML。

    【大綱準則】：
    1. 故事線清楚：通常以封面開場、結尾做總結或呼籲行動，中間依邏輯（問題 → 方案 → 成效、時間順序等）排列。
    2. 每頁標題簡短明確；重點 2 ~ 5 點，每點一句話，只寫要傳達的訊息，不要寫版面指示。
    3. 只使用素材中的資訊，不要捏造數據。
    4. 建議版型從【版型目錄】中依內容型態選擇（寫出版型名稱即可），並遵守【整份簡報的節奏】。
    5. 使用與原始素材相同的語言。
    """ + LAYOUT_CATALOG + DECK_RHYTHM_RULES + DECK_MODE_RULES[req.deck_mode] + CONTENT_ACCURACY_RULES

    pages_hint = (f"{req.num_pages} 頁（必須剛好 {req.num_pages} 頁）"
                  if req.num_pages > 0 else "由你依內容多寡與重點自行決定（建議 3~8 頁）")
    prompt = f"""
    【簡報目標客群】：{req.target_audience}
    【預計頁數】：{pages_hint}
    【簡報模式】：{DECK_MODE_LABELS[req.deck_mode]}
    【原始素材內容】：
    {req.content}

    請依【簡報模式】規劃每頁的資訊量，輸出整份簡報的大綱。
    """

    with llm_usage_log(request, user, "outline", req) as usage:
        try:
            data = call_llm(req.provider, req.model, system_instruction, prompt, DeckOutline, 0.5, usage)
            slides = (data.get("slides") or [])[:MAX_PAGES]
            for s in slides:
                s["key_points"] = [p.strip() for p in s.get("key_points") or [] if p and p.strip()][:MAX_OUTLINE_POINTS]
            data["slides"] = slides
            usage["slides_returned"] = len(slides)
            return data
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

class ExtractUsage(BaseModel):
    """llm_usage_log 需要的欄位：匯入檔案時的圖片辨識（PPTX 圖片、PDF 掃描頁）記為一次 extract 用量。"""
    provider: str
    model: str
    content: str
    deck_mode: str | None = None
    num_pages: int | None = None


def image_reader(request: Request, user: dict, provider: str, model: str):
    """回傳給 extract_text 的圖片辨識函式：整個檔案的辨識記為一次 AI 用量（各頁的 token 數加總）。
    EXTRACT_IMAGES=false 時不辨識圖片；超過次數上限時改為只匯入文字，並提示原因。"""
    if not env_flag("EXTRACT_IMAGES", True):
        return None

    def read(slides):
        if provider_client(provider) is None:
            return {}, [f"圖片未辨識：{MISSING_KEY_MSG.get(provider, f'不支援的平台 {provider}')}"]
        usages = []
        call = lambda system, prompt, images, usage: call_llm(provider, model, system, prompt, SlideImageReadings,
                                                              0.2, usage, images=images)
        req = ExtractUsage(provider=provider, model=model, content="\n".join(s.text() for s in slides),
                           num_pages=len(slides))
        try:
            with llm_usage_log(request, user, "extract", req) as usage:
                readings, notices = read_slide_images(slides, call, usages)
                for key in ("input_tokens", "output_tokens", "total_tokens", "cached_tokens", "reasoning_tokens"):
                    values = [u[key] for u in usages if u.get(key) is not None]
                    usage[key] = sum(values) if values else None
                usage["model"] = next((u["model"] for u in usages if u.get("model")), model)
                usage["slides_returned"] = len(readings)
                return readings, notices
        except HTTPException as e:
            if e.status_code == 429:
                return {}, [f"圖片未辨識：{e.detail}"]
            raise

    return read


# 檔案解析與 PPTX 匯出會佔用伺服器的 CPU 與記憶體，只開放給已登入的使用者；
# PPTX 中的圖片與 PDF 的掃描頁會用 AI 辨識，算進該帳號的 AI 使用次數
@app.post("/api/extract")
async def extract_file(request: Request, user: dict = Depends(current_user)):
    """抽取上傳檔案的文字，供前端填入輸入框。檔案不會被保存。"""
    # 解析 multipart 前先以 Content-Length 擋下過大的請求（預留 64KB 給表單邊界等額外資料）
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        raise HTTPException(status_code=411, detail="缺少 Content-Length")
    if int(length) > MAX_REQUEST_BYTES + 64 * 1024:
        raise HTTPException(status_code=413, detail=f"檔案過大（上限 {MAX_REQUEST_BYTES // 1024 // 1024} MB）")

    form = await request.form(max_files=1, max_fields=3)
    try:
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=400, detail="請選擇要上傳的檔案")
        data = await upload.read(MAX_REQUEST_BYTES + 1)
        filename = upload.filename or ""
        provider, model = str(form.get("provider") or "gemini"), str(form.get("model") or "")
    finally:
        await form.close()

    reader = image_reader(request, user, provider, model)
    try:
        return await run_in_threadpool(extract_text, filename, data, MAX_CONTENT_CHARS, reader)
    except ExtractError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="無法解析此檔案，請確認檔案未損毀")

MAX_EXPORT_BODY_BYTES = 40 * 1024 * 1024
PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

@app.post("/api/export/pptx")
async def export_pptx(request: Request, user: dict = Depends(current_user)):
    """將前端渲染好的投影片圖片組成 PPTX 並直接回傳，不保存檔案。"""
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        raise HTTPException(status_code=411, detail="缺少 Content-Length")
    if int(length) > MAX_EXPORT_BODY_BYTES:
        raise HTTPException(status_code=413, detail="簡報內容過大，無法匯出")
    try:
        payload = await request.json()
        title = str(payload.get("title") or "未命名簡報")[:200]
        slides = payload.get("slides")
        if not isinstance(slides, list) or not all(isinstance(s, dict) for s in slides):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="匯出資料格式不正確")

    try:
        data = await run_in_threadpool(build_pptx, title, slides)
    except ExportError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return Response(content=data, media_type=PPTX_MEDIA_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="presentation.pptx"'})

@app.post("/api/regenerate-slide")
def regenerate_slide(req: RegenerateSlideRequest, request: Request, user: dict = Depends(current_user)):
    check_field_lengths(req)
    if not req.slides:
        raise HTTPException(status_code=400, detail="缺少原始投影片資料")
    if len(req.slides) > MAX_REGEN_SLIDES:
        raise HTTPException(status_code=400, detail=f"投影片超過 {MAX_REGEN_SLIDES} 頁，無法重產")
    if req.slide_index < 0 or req.slide_index >= len(req.slides):
        raise HTTPException(status_code=400, detail="slide_index 超出範圍")
    if any(len(s.slide_title) > MAX_SLIDE_META_CHARS or len(s.layout_concept) > MAX_SLIDE_META_CHARS for s in req.slides):
        raise HTTPException(status_code=400, detail=f"投影片標題或版型說明過長（上限 {MAX_SLIDE_META_CHARS} 字）")

    target_slide = req.slides[req.slide_index]
    if len(target_slide.html_content) > MAX_SLIDE_HTML_CHARS:
        raise HTTPException(status_code=400, detail="此頁內容過多，無法重產；請先刪減此頁的元素後再試")
    if len(target_slide.speaker_notes) > MAX_SLIDE_NOTES_CHARS:
        raise HTTPException(status_code=400, detail=f"此頁講者備註過長（上限 {MAX_SLIDE_NOTES_CHARS:,} 字）")
    if len(json.dumps(target_slide.charts, ensure_ascii=False)) > MAX_SLIDE_CHARTS_CHARS:
        raise HTTPException(status_code=400, detail="此頁圖表資料過多，無法重產")
    theme = theme_from_input(req.theme)
    theme_block = (f"""以下 JSON 是整份簡報共用的設計規範，這一頁必須沿用其中的頁面背景、文字顏色、強調色、卡片、標題與小標籤樣式，
    圖表 colors 依序使用 chart_colors（封面、章節分隔與結尾頁可改用強調色或深色滿版背景）：
    {format_theme(theme)}""" if theme else "（這份簡報沒有記錄設計規範，請沿用原 HTML 與其他頁的配色、卡片與標題樣式）")
    deck_outline = "\n".join(
        f"- 第 {s.page_number} 頁｜{s.slide_title}｜{s.layout_concept}"
        for s in req.slides
    )

    system_instruction = """
    你是一位榮獲世界設計大獎的簡報架構與 UI 設計師。
    你的任務是針對指定頁面重新產生「單一投影片」的版面與精簡內容，保持整份簡報風格一致。

    【硬性規範】：
    1. 只輸出單頁資料，不要輸出整份簡報。
    2. 僅使用 Tailwind CSS class。
    3. 禁止使用 emoji，請使用 font-awesome 圖示。
    4. 必須服從指定視覺風格與【整份簡報的設計規範】，版型從【版型目錄】挑選，並避免與前後頁使用相同的版型。
    5. 使用者的額外需求若會讓內容超出畫面（例如要求加入更多內容），請以精簡文字的方式達成，不可違反版面尺寸限制。
    6. 原 HTML 中 <img data-rs-img src="rs-img:數字"> 是使用者上傳的圖片：除非使用者要求移除，否則請保留該 <img> 標籤與 src 原樣，
       可調整它的位置與大小。原 HTML 中的 data-rs-chart 容器內容已省略，圖表資料請參考【原圖表資料】。
    7. 講者備註需配合新版面重新撰寫；使用者的額外需求若只針對版面，仍可沿用【原講者備註】的重點。
    """ + LAYOUT_CATALOG + SLIDE_LAYOUT_RULES + DECK_MODE_RULES[req.deck_mode] + CHART_RULES + SPEAKER_NOTES_RULES \
        + CONTENT_ACCURACY_RULES

    prompt = f"""
    【簡報標題】：{req.presentation_title}
    【簡報目標客群】：{req.target_audience}
    【總頁數】：{req.num_pages}
    【簡報模式】：{DECK_MODE_LABELS[req.deck_mode]}
    【指定視覺風格】：{req.style_preference}
    【原始素材內容】：
    {req.content}

    【整份簡報的設計規範】：
    {theme_block}

    【整份簡報大綱（請保持一致性）】：
    {deck_outline}

    【需要重產的頁面】：
    - 頁碼：{target_slide.page_number}
    - 原標題：{target_slide.slide_title}
    - 原版型概念：{target_slide.layout_concept}
    - 原 HTML：
    {target_slide.html_content}
    - 原圖表資料（JSON，可沿用、修改或刪除）：
    {json.dumps(target_slide.charts, ensure_ascii=False) if target_slide.charts else "（無）"}
    - 原講者備註：
    {target_slide.speaker_notes.strip() or "（無）"}

    【使用者額外重產需求】：
    {req.custom_prompt.strip() if req.custom_prompt.strip() else "（無，請你自行優化此頁）"}

    請重新設計這一頁，使其與原本明顯不同但仍符合整體脈絡，並回傳單一頁的 JSON。
    注意：page_number 請維持為 {target_slide.page_number}。
    """

    with llm_usage_log(request, user, "regenerate", req) as usage:
        try:
            data = call_llm(req.provider, req.model, system_instruction, prompt, AdaptiveSlide, 0.7, usage)
            data["page_number"] = target_slide.page_number
            # 使用者可能自行插入超過 MAX_CHARTS_PER_SLIDE 張圖表：至少保留原頁的張數，避免重產後被截掉
            data["charts"] = normalize_charts(data.get("charts"), max(MAX_CHARTS_PER_SLIDE, len(target_slide.charts)))
            usage["slides_returned"] = 1
            return data
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

app.include_router(accounts_router)
app.include_router(admin_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")

@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/admin", include_in_schema=False)
async def admin_page():
    return FileResponse(STATIC_DIR / "admin.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)