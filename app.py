import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# ----------------------------------------------------
# 讀取 .env 環境變數並防呆檢查
# ----------------------------------------------------
load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not MY_GEMINI_API_KEY:
    raise ValueError("找不到 GEMINI_API_KEY，請確認專案根目錄下已建立 .env 檔案並設定 GEMINI_API_KEY！")

client = genai.Client(api_key=MY_GEMINI_API_KEY)
app = FastAPI(title="AI Adaptive Slide Agent")

# ----------------------------------------------------
# Pydantic 資料模型定義（支援 AI 自適應自由排版）
# ----------------------------------------------------
class AdaptiveSlide(BaseModel):
    page_number: int = Field(description="頁碼 (1, 2, 3...)")
    layout_concept: str = Field(description="採用的版型概念說明，例如：'三欄數據指標比較'、'左側深色對比卡片'、'時間軸步驟流程'")
    slide_title: str = Field(description="此頁的核心大綱標題，供審核用")
    html_content: str = Field(
        description="""
        這一頁投影片的完整 HTML 代碼 (純 HTML + Tailwind CSS class)。
        必須以 <div class="w-full h-full p-8 flex ..."> 作為最外層容器，確保填滿 16:9 畫布。
        風格需現代、高階商務、對齊工整，可自由運用 Grid、Flex、卡片、漸層、Badge 或 Highlight 標籤。
        """
    )

class AdaptivePresentation(BaseModel):
    presentation_title: str = Field(description="整份簡報的大標題")
    slides: list[AdaptiveSlide] = Field(description="動態排版的多頁投影片清單")

class GenerateRequest(BaseModel):
    content: str
    target_audience: str = "商務主管 / 技術決策者"
    num_pages: int = 3

# ----------------------------------------------------
# API 端點
# ----------------------------------------------------
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
       - 若內容是觀念/引言，請設計為「高對比幾何背景 + 重點金句大字排版」。
    2. 畫布規格約束：
       - 最外層必須為 <div class="w-full h-full ...">，請使用 padding (如 p-8 或 p-10) 保持邊距。
       - 內容文字必須自適應，嚴格防止內容超出容器 (避免 vertical overflow)。
       - 僅輸出 Tailwind CSS class，字型支援現代中文。配色可採用深藍 (slate-900)、純白底、深灰搭配活力點綴色 (如 blue-600, amber-500, emerald-500)。
    """

    prompt = f"""
    【簡報目標客群】：{req.target_audience}
    【預計生成頁數】：{req.num_pages} 頁
    【原始素材內容】：
    {req.content}
    
    請深入理解內容，為每一頁構思最能凸顯該主題的獨特版面與視覺架構。
    """
    
    try:
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=AdaptivePresentation,
            temperature=0.3,
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

# 掛載前端靜態檔案
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)