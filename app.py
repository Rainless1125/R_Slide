import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from openai import OpenAI

load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
MY_OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not MY_GEMINI_API_KEY and not MY_OPENAI_API_KEY:
    raise ValueError("找不到 API Key，請在 .env 檔案中至少設定 GEMINI_API_KEY 或 OPENAI_API_KEY！")

gemini_client = genai.Client(api_key=MY_GEMINI_API_KEY) if MY_GEMINI_API_KEY else None
openai_client = OpenAI(api_key=MY_OPENAI_API_KEY) if MY_OPENAI_API_KEY else None
app = FastAPI(title="R Slide")

# 各平台可選模型（第一個為預設）
MODEL_CATALOG = {
    "gemini": ["gemini-3.5-flash", "gemini-3.7-flash", "gemini-3.8-flash"],
    "openai": ["gpt-6-luna"],
}


def call_llm(provider: str, model: str, system_instruction: str, prompt: str,
             schema: type[BaseModel], temperature: float) -> dict:
    """依平台呼叫 LLM，回傳符合 schema 的 dict。"""
    provider = (provider or "gemini").lower()
    if provider not in MODEL_CATALOG:
        raise HTTPException(status_code=400, detail=f"不支援的平台: {provider}")
    model = model or MODEL_CATALOG[provider][0]

    if provider == "gemini":
        if gemini_client is None:
            raise HTTPException(status_code=400, detail="未設定 GEMINI_API_KEY")
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=schema,
            temperature=temperature,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction=system_instruction
        )
        response = gemini_client.models.generate_content(model=model, contents=prompt, config=config)
        return json.loads(response.text)

    if openai_client is None:
        raise HTTPException(status_code=400, detail="未設定 OPENAI_API_KEY")
    completion = openai_client.beta.chat.completions.parse(
        model=model,
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": prompt},
        ],
        response_format=schema,
        # 部分 OpenAI 模型（如推理類）只接受預設 temperature，故不傳入
    )
    message = completion.choices[0].message
    if message.refusal:
        raise HTTPException(status_code=502, detail=f"模型拒絕回應: {message.refusal}")
    return message.parsed.model_dump()


# 1. Pydantic 模型定義
class AdaptiveSlide(BaseModel):
    page_number: int = Field(description="頁碼 (1, 2, 3...)")
    layout_concept: str = Field(description="採用的版型概念說明")
    slide_title: str = Field(description="此頁的核心大綱標題")
    html_content: str = Field(
        description="""
        這一頁投影片的完整 HTML 代碼 (純 HTML + Tailwind CSS class)。
        必須以 <div class="w-full h-full p-8 flex ..."> 作為最外層容器，確保填滿 16:9 畫布。
        請嚴格依據使用者指定的【視覺風格】來配置 Tailwind 顏色 (包含 bg-xxx, text-xxx, border-xxx 等)，切勿千篇一律使用深色。
        """
    )

class AdaptivePresentation(BaseModel):
    presentation_title: str = Field(description="整份簡報的大標題")
    slides: list[AdaptiveSlide] = Field(description="動態排版的多頁投影片清單")

class GenerateRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = 3
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"  # 新增：接收前端傳來的風格
    provider: str = "gemini"
    model: str = ""

class RegenerateSlideRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = 3
    style_preference: str = "蘋果極簡白 (Apple Minimalist)"
    presentation_title: str = "未命名簡報"
    slide_index: int
    slides: list[AdaptiveSlide]
    custom_prompt: str = ""
    provider: str = "gemini"
    model: str = ""

# 2. API 端點
@app.get("/api/models")
async def list_models():
    return {
        "gemini": {"available": gemini_client is not None, "models": MODEL_CATALOG["gemini"]},
        "openai": {"available": openai_client is not None, "models": MODEL_CATALOG["openai"]},
    }

@app.post("/api/generate")
async def generate_slides(req: GenerateRequest):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
    
    system_instruction = """
    你是一位榮獲世界設計大獎的簡報架構與 UI 設計師。
    你的任務是將使用者提供的原始內容，規劃為多頁「版面各異、針對內容最適化」的現代簡報。
    
    【設計核心準則】：
    1. 拒絕單一死板模板：
       - 若內容是數據/成效，請設計為「巨大數字 (Big Numbers) + KPI 資訊卡片」。
       - 若內容是流程/SOP，請設計為「橫向流程步驟卡 (Step Cards) 或 時間軸 (Timeline)」。
       - 若內容是優缺點/方案比較，請設計為「左右對稱對比欄位 (Comparison Columns)」。
    2. 視覺與配色規範：
       - 最外層必須為 <div class="w-full h-full ...">，使用 padding (如 p-8 或 p-12) 保持邊距。
       - 內容文字必須自適應，嚴格防止超出容器。
       - 僅輸出 Tailwind CSS class。
       - 禁止使用emoji，請一律使用font-awesome圖示。
       - 【重要】你必須絕對服從使用者指定的「視覺風格」。如果要求明亮風，請多用 bg-white/bg-slate-50；如果要求科技風，才使用深色底 bg-slate-900 搭配螢光點綴色。
    """

    prompt = f"""
    【簡報目標客群】：{req.target_audience}
    【預計生成頁數】：{req.num_pages} 頁
    【指定視覺風格】：{req.style_preference} (請利用 Tailwind CSS 確實實踐此氛圍)
    【原始素材內容】：
    {req.content}
    
    請深入理解內容，為每一頁構思最能凸顯該主題的獨特版面，並確保整體色彩與背景符合指定的【視覺風格】。
    """
    
    try:
        return call_llm(req.provider, req.model, system_instruction, prompt, AdaptivePresentation, 0.6)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/regenerate-slide")
async def regenerate_slide(req: RegenerateSlideRequest):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
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
    2. 最外層必須是 <div class="w-full h-full ...">，使用 Tailwind CSS class。
    3. 禁止使用 emoji，請使用 font-awesome 圖示。
    4. 必須服從指定視覺風格，並避免與其他頁過度重複。
    5. 內容需可讀、精簡，不能溢出畫面。
    """

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

    【使用者額外重產需求】：
    {req.custom_prompt.strip() if req.custom_prompt.strip() else "（無，請你自行優化此頁）"}

    請重新設計這一頁，使其與原本明顯不同但仍符合整體脈絡，並回傳單一頁的 JSON。
    注意：page_number 請維持為 {target_slide.page_number}。
    """

    try:
        data = call_llm(req.provider, req.model, system_instruction, prompt, AdaptiveSlide, 0.7)
        data["page_number"] = target_slide.page_number
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)