import os
import json
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from openai import BadRequestError, OpenAI
from starlette.datastructures import UploadFile

from accounts import router as accounts_router
from charts import CHART_RULES, MAX_CHARTS_PER_SLIDE, ChartSpec, normalize_charts
from exporter import ExportError, build_pptx
from extract import MAX_UPLOAD_BYTES, ExtractError, extract_text

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"   # 以本檔所在位置為基準，從其他目錄啟動 uvicorn 也找得到

load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MY_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")


def parse_model_list(value: str | None) -> list[str]:
    """以逗號分隔的模型清單（.env 用），去除空白與重複。"""
    return list(dict.fromkeys(m.strip() for m in (value or "").split(",") if m.strip()))


def databricks_base_url(host: str | None, base_url: str | None = None) -> str | None:
    """Databricks 的 OpenAI 相容端點：有指定 DATABRICKS_BASE_URL 就直接使用，否則為 <workspace>/serving-endpoints。"""
    if base_url and base_url.strip():
        return base_url.strip().rstrip("/")
    if not host or not host.strip():
        return None
    host = host.strip().rstrip("/")
    if not host.startswith(("http://", "https://")):
        host = "https://" + host
    return host + "/serving-endpoints"


# Databricks AI Gateway（Model Serving 端點）：以 OpenAI SDK 呼叫，模型名稱即端點名稱
DATABRICKS_TOKEN = os.getenv("DATABRICKS_TOKEN")
DATABRICKS_BASE_URL = databricks_base_url(os.getenv("DATABRICKS_HOST"), os.getenv("DATABRICKS_BASE_URL"))
DATABRICKS_MODELS = parse_model_list(os.getenv("DATABRICKS_MODELS"))
DATABRICKS_READY = bool(DATABRICKS_TOKEN and DATABRICKS_BASE_URL and DATABRICKS_MODELS)

if not MY_GEMINI_API_KEY and not MY_OPENAI_API_KEY and not DATABRICKS_READY:
    raise ValueError("找不到 API Key，請在 .env 檔案中至少設定 GEMINI_API_KEY、OPENAI_API_KEY，"
                     "或 Databricks 的 DATABRICKS_HOST + DATABRICKS_TOKEN + DATABRICKS_MODELS！")

gemini_client = genai.Client(api_key=MY_GEMINI_API_KEY) if MY_GEMINI_API_KEY else None
openai_client = OpenAI(api_key=MY_OPENAI_API_KEY) if MY_OPENAI_API_KEY else None
databricks_client = OpenAI(api_key=DATABRICKS_TOKEN, base_url=DATABRICKS_BASE_URL) if DATABRICKS_READY else None
app = FastAPI(title="R Slide")

# 各平台可選模型（第一個為預設）；Databricks 的模型清單由 .env 的 DATABRICKS_MODELS 決定
MODEL_CATALOG = {
    "gemini": ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.8-flash"],
    "openai": ["gpt-6-luna"],
    "databricks": DATABRICKS_MODELS,
}
MISSING_KEY_MSG = {
    "gemini": "未設定 GEMINI_API_KEY",
    "openai": "未設定 OPENAI_API_KEY",
    "databricks": "未設定 Databricks（需要 DATABRICKS_HOST、DATABRICKS_TOKEN、DATABRICKS_MODELS）",
}


def provider_client(provider: str):
    return {"gemini": gemini_client, "openai": openai_client, "databricks": databricks_client}.get(provider)


def parse_json_reply(text: str, schema: type[BaseModel]) -> dict:
    """從模型的文字回覆取出 JSON（容許 ```json 區塊或前後多餘文字），並以 schema 驗證。"""
    text = (text or "").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("模型沒有回傳 JSON")
    return schema.model_validate_json(text[start:end + 1]).model_dump()


def call_openai_compatible(client: OpenAI, model: str, system_instruction: str, prompt: str,
                           schema: type[BaseModel], allow_fallback: bool) -> dict:
    messages = [
        {"role": "system", "content": system_instruction},
        {"role": "user", "content": prompt},
    ]
    try:
        # 部分 OpenAI 模型（如推理類）只接受預設 temperature，故不傳入
        completion = client.beta.chat.completions.parse(model=model, messages=messages, response_format=schema)
        message = completion.choices[0].message
        if message.refusal:
            raise HTTPException(status_code=502, detail=f"模型拒絕回應: {message.refusal}")
        if message.parsed is not None:
            return message.parsed.model_dump()
        if not allow_fallback:
            raise HTTPException(status_code=502, detail="模型回傳的資料無法解析")
        return parse_json_reply(message.content, schema)
    except BadRequestError:
        # Databricks 上部分模型不支援嚴格的 json_schema 結構化輸出：改為在提示詞附上 schema，回覆後再由後端驗證
        if not allow_fallback:
            raise
    fallback_system = (system_instruction + "\n\n【輸出格式】：只輸出一個符合下列 JSON Schema 的 JSON 物件，"
                       "不要加上 Markdown 區塊或任何說明文字。\n"
                       + json.dumps(schema.model_json_schema(), ensure_ascii=False))
    completion = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": fallback_system}, {"role": "user", "content": prompt}],
    )
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
             schema: type[BaseModel], temperature: float) -> dict:
    """依平台呼叫 LLM，回傳符合 schema 的 dict。"""
    provider = (provider or "gemini").lower()
    if provider not in MODEL_CATALOG:
        raise HTTPException(status_code=400, detail=f"不支援的平台: {provider}")
    client = provider_client(provider)
    if client is None:
        raise HTTPException(status_code=400, detail=MISSING_KEY_MSG[provider])
    if provider == "databricks" and model and model not in MODEL_CATALOG["databricks"]:
        raise HTTPException(status_code=400, detail=f"未開放的 Databricks 模型: {model}")
    model = model or MODEL_CATALOG[provider][0]

    if provider == "gemini":
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction=system_instruction
        )
        response = client.models.generate_content(model=model, contents=prompt, config=config)
        return json.loads(gemini_response_text(response))

    return call_openai_compatible(client, model, system_instruction, prompt, schema,
                                  allow_fallback=provider == "databricks")


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
    slides: list[AdaptiveSlide] = Field(description="動態排版的多頁投影片清單")

MAX_CONTENT_CHARS = 50_000
MAX_PAGES = 20

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
    4. 內容量上限：
       - 主標題 1 個；副標題最多 1 句、不超過 30 字。
       - 卡片 / 欄位 / 步驟最多 4 個並排、最多 2 列；每張卡片內文不超過 40 字、最多 3 行。
       - 條列清單最多 5 點，每點不超過 25 字。
       - 素材太多時請精簡、合併重點（頁數由你決定時可拆成更多頁），絕對不要把所有文字硬塞進同一頁。
    5. 字級與間距上限：
       - 主標題最大 text-4xl；只有封面或單一大數字頁可用 text-5xl ~ text-6xl。
       - 卡片標題 text-lg ~ text-xl；內文 text-sm ~ text-base；註記 text-xs。
       - 卡片內距 p-5 ~ p-6；區塊間距 gap-4 ~ gap-6；不要使用 p-10 以上的卡片內距或 mb-12 以上的間距。
    6. 輸出前請自行估算：各區塊高度相加（含 padding、gap、margin、圖示）必須小於 576px。
       若可能超出，先刪減文字，其次縮小字級與間距，最後才刪除次要區塊（例如頁尾列）。
"""


# 講者備註只出現在播放器的備註區與 PPTX 備忘稿，不會畫在投影片上，因此不受版面字數限制
SPEAKER_NOTES_RULES = """
    【講者備註（speaker_notes）】：
    1. 每頁都要提供講者備註：講者上台時可以直接照著念的口語講稿，使用與原始素材相同的語言。
    2. 長度約 80 ~ 200 字，2 ~ 5 句；封面與結尾頁可較短。
    3. 內容要補充畫面上沒有寫出的脈絡、數據來源、舉例或轉場，不要逐字重複投影片上的文字。
    4. 最後一句可以自然帶出下一頁的主題（最後一頁則做總結或呼籲行動）。
    5. 只輸出純文字，不要 HTML、Markdown 符號或 emoji；換段可使用換行。
"""


class GenerateRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = Field(3, ge=0, le=MAX_PAGES)  # 0 = 由 AI 決定
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"  # 新增：接收前端傳來的風格
    provider: str = "gemini"
    model: str = ""

class RegenerateSlideRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = Field(3, ge=0, le=MAX_PAGES)
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"
    presentation_title: str = "未命名簡報"
    slide_index: int
    slides: list[SlideInput]
    custom_prompt: str = ""
    provider: str = "gemini"
    model: str = ""

# 2. API 端點
@app.get("/api/models")
async def list_models():
    return {
        provider: {"available": provider_client(provider) is not None, "models": models}
        for provider, models in MODEL_CATALOG.items()
    }

@app.post("/api/generate")
def generate_slides(req: GenerateRequest):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
    if len(req.content) > MAX_CONTENT_CHARS:
        raise HTTPException(status_code=400, detail=f"內容過長（上限 {MAX_CONTENT_CHARS} 字）")
    
    system_instruction = """
    你是一位榮獲世界設計大獎的簡報架構與 UI 設計師。
    你的任務是將使用者提供的原始內容，規劃為多頁「版面各異、針對內容最適化」的現代簡報。
    
    【設計核心準則】：
    1. 拒絕單一死板模板：
       - 若內容是數據/成效，請設計為「巨大數字 (Big Numbers) + KPI 資訊卡片」。
       - 若內容是流程/SOP，請設計為「橫向流程步驟卡 (Step Cards) 或 時間軸 (Timeline)」。
       - 若內容是優缺點/方案比較，請設計為「左右對稱對比欄位 (Comparison Columns)」。
       - 若內容有可比較的數值（趨勢、占比、排名），請搭配圖表呈現（見下方【圖表】規則）。
    2. 視覺與配色規範：
       - 僅輸出 Tailwind CSS class。
       - 禁止使用emoji，請一律使用font-awesome圖示。
       - 【重要】你必須絕對服從使用者指定的「視覺風格」。如果要求明亮風，請多用 bg-white/bg-slate-50；如果要求科技風，才使用深色底 bg-slate-900 搭配螢光點綴色。
    """ + SLIDE_LAYOUT_RULES + CHART_RULES + SPEAKER_NOTES_RULES

    pages_hint = f"{req.num_pages} 頁" if req.num_pages > 0 else "由你依內容多寡與重點自行決定（建議 3~8 頁）"
    prompt = f"""
    【簡報目標客群】：{req.target_audience}
    【預計生成頁數】：{pages_hint}
    【指定視覺風格】：{req.style_preference} (請利用 Tailwind CSS 確實實踐此氛圍)
    【原始素材內容】：
    {req.content}
    
    請深入理解內容，為每一頁構思最能凸顯該主題的獨特版面，並確保整體色彩與背景符合指定的【視覺風格】。
    """
    
    try:
        data = call_llm(req.provider, req.model, system_instruction, prompt, AdaptivePresentation, 0.6)
        for slide in data.get("slides") or []:
            slide["charts"] = normalize_charts(slide.get("charts"))
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/extract")
async def extract_file(request: Request):
    """抽取上傳檔案的文字，供前端填入輸入框。檔案不會被保存。"""
    # 解析 multipart 前先以 Content-Length 擋下過大的請求（預留 64KB 給表單邊界等額外資料）
    length = request.headers.get("content-length")
    if not length or not length.isdigit():
        raise HTTPException(status_code=411, detail="缺少 Content-Length")
    if int(length) > MAX_UPLOAD_BYTES + 64 * 1024:
        raise HTTPException(status_code=413, detail=f"檔案過大（上限 {MAX_UPLOAD_BYTES // 1024 // 1024} MB）")

    form = await request.form(max_files=1, max_fields=1)
    try:
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=400, detail="請選擇要上傳的檔案")
        data = await upload.read(MAX_UPLOAD_BYTES + 1)
        filename = upload.filename or ""
    finally:
        await form.close()

    try:
        return await run_in_threadpool(extract_text, filename, data, MAX_CONTENT_CHARS)
    except ExtractError as e:
        raise HTTPException(status_code=e.status_code, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="無法解析此檔案，請確認檔案未損毀")

MAX_EXPORT_BODY_BYTES = 40 * 1024 * 1024
PPTX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

@app.post("/api/export/pptx")
async def export_pptx(request: Request):
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
def regenerate_slide(req: RegenerateSlideRequest):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
    if len(req.content) > MAX_CONTENT_CHARS:
        raise HTTPException(status_code=400, detail=f"內容過長（上限 {MAX_CONTENT_CHARS} 字）")
    if not req.slides:
        raise HTTPException(status_code=400, detail="缺少原始投影片資料")
    if req.slide_index < 0 or req.slide_index >= len(req.slides):
        raise HTTPException(status_code=400, detail="slide_index 超出範圍")

    target_slide = req.slides[req.slide_index]
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
    4. 必須服從指定視覺風格，並避免與其他頁過度重複。
    5. 使用者的額外需求若會讓內容超出畫面（例如要求加入更多內容），請以精簡文字的方式達成，不可違反版面尺寸限制。
    6. 原 HTML 中 <img data-rs-img src="rs-img:數字"> 是使用者上傳的圖片：除非使用者要求移除，否則請保留該 <img> 標籤與 src 原樣，
       可調整它的位置與大小。原 HTML 中的 data-rs-chart 容器內容已省略，圖表資料請參考【原圖表資料】。
    7. 講者備註需配合新版面重新撰寫；使用者的額外需求若只針對版面，仍可沿用【原講者備註】的重點。
    """ + SLIDE_LAYOUT_RULES + CHART_RULES + SPEAKER_NOTES_RULES

    prompt = f"""
    【簡報標題】：{req.presentation_title}
    【簡報目標客群】：{req.target_audience}
    【總頁數】：{req.num_pages}
    【指定視覺風格】：{req.style_preference}
    【原始素材內容】：
    {req.content}

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

    try:
        data = call_llm(req.provider, req.model, system_instruction, prompt, AdaptiveSlide, 0.7)
        data["page_number"] = target_slide.page_number
        # 使用者可能自行插入超過 MAX_CHARTS_PER_SLIDE 張圖表：至少保留原頁的張數，避免重產後被截掉
        data["charts"] = normalize_charts(data.get("charts"), max(MAX_CHARTS_PER_SLIDE, len(target_slide.charts)))
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(accounts_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml")

@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)