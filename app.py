import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not MY_GEMINI_API_KEY:
    raise ValueError("找不到 GEMINI_API_KEY，請確認專案根目錄下已建立 .env 檔案並設定 GEMINI_API_KEY！")

client = genai.Client(api_key=MY_GEMINI_API_KEY)
app = FastAPI(title="R Slide")

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

# 2. API 端點
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
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AdaptivePresentation,
            temperature=0.6,  # 微調至 0.6 讓版型與配色發揮更多創意
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction=system_instruction
        )
        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=prompt,
            config=config,
        )
        data = json.loads(response.text)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)