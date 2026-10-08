import os
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from google import genai
from google.genai import types

# Load API key from .env file
load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

client = genai.Client(api_key=MY_GEMINI_API_KEY)
app = FastAPI(title="AI Slide Generator")

# 1. 定義簡報資料結構
class SlideStep(BaseModel):
    text: str = Field(description="步驟或內文文字")
    highlight_keyword: str = Field(description="需要特別加亮標示的關鍵字")

class SlideGroup(BaseModel):
    label: str = Field(description="分組標籤名稱，例如：'簡報規劃'")
    step_count: int = Field(description="此分組涵蓋幾個步驟")

class SlideCard(BaseModel):
    main_title: str = Field(description="左側主標題")
    sub_title: str = Field(description="左側副標題")
    icon_emoji: str = Field(description="代表核心概念的 Emoji 圖示，如 '🔄', '💡', '⚙️'")
    quote_highlight: str = Field(description="左側重點金句")
    quote_desc: str = Field(description="金句補充說明")
    steps: list[SlideStep] = Field(description="右側卡片步驟清單，約 4~6 個步驟")
    groups: list[SlideGroup] = Field(description="右側右端的分組結構")

class WebPresentation(BaseModel):
    presentation_title: str = Field(description="整份簡報的總標題")
    slides: list[SlideCard] = Field(description="多頁投影片清單")

class GenerateRequest(BaseModel):
    content: str
    target_audience: str = "一般商務主管"
    num_pages: int = 2

# 2. API 端點：呼叫 Gemini 生成簡報結構
@app.post("/api/generate")
async def generate_slides(req: GenerateRequest):
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="請提供輸入內容")
    
    prompt = f"""
    你是一位高階商業顧問與簡報視覺架構師。請根據以下內容，規劃一份 {req.num_pages} 頁精美的資訊圖表型簡報。
    
    【目標簡報對象】：{req.target_audience}
    【輸入內容】：
    {req.content}
    
    每一頁請依據「使用者輸入內容」自由拆解產生出漂亮美觀的簡報圖片，請使用font-awesome圖示，並搭配適當的顏色與排版，確保每頁都具有視覺吸引力。
    """
    
    try:
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=WebPresentation,
            temperature=0.2,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=prompt,
            config=config,
        )
        data = json.loads(response.text)
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. 掛載前端靜態檔案
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def root():
    return FileResponse("static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)