import json
import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# Load API key from .env file
load_dotenv()
MY_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# 1. 定義簡報各頁面的結構 (對齊資訊圖表設計)
class SlideStep(BaseModel):
    text: str = Field(description="步驟或內文文字，如：'該與哪些單位主管確認目標與進程'")
    highlight_keyword: str = Field(description="需要特別加亮標示的關鍵字，例如：'主管'")

class SlideGroup(BaseModel):
    label: str = Field(description="分組標籤名稱，例如：'簡報規劃' 或 '簡報製作'")
    step_count: int = Field(description="此分組涵蓋幾個步驟，例如：4")

class SlideCard(BaseModel):
    main_title: str = Field(description="左側主標題，例如：'商業簡報'")
    sub_title: str = Field(description="左側副標題，例如：'的六步驟'")
    icon_emoji: str = Field(description="代表核心概念的 Emoji 圖示，例如：'🔄'、'⚙️'、'📊'")
    quote_highlight: str = Field(description="左側金黃色重點金句")
    quote_desc: str = Field(description="金句下方的補充說明文字")
    steps: list[SlideStep] = Field(description="右側卡片步驟清單，約 4~6 個步驟")
    groups: list[SlideGroup] = Field(description="右側右端的分組結構，總步驟數需等於 steps 總數")

class WebPresentation(BaseModel):
    presentation_title: str = Field(description="整份簡報的總標題")
    slides: list[SlideCard] = Field(description="多頁投影片清單")

client = genai.Client(api_key=MY_GEMINI_API_KEY)

def generate_web_presentation(user_content: str) -> WebPresentation:
    prompt = f"""
    你是一位高階商業顧問與簡報視覺架構師。請根據以下內容，規劃一份多頁精美的資訊圖表型簡報。
    
    每一頁請依據「左側主題觀念 + 右側步驟卡片與分組」的形式拆解，務必標示出需要標色強調的關鍵字與右側分組。
    
    【輸入內容】：
    {user_content}
    """
    
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
    return WebPresentation.model_validate_json(response.text)

# 2. 生成自包含的 HTML 閱讀器模板
def build_html_viewer(data: WebPresentation, output_html="presentation_viewer.html"):
    slides_json = json.dumps(data.model_dump(), ensure_ascii=False)
    
    html_content = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <title>{data.presentation_title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif; }}
    body {{
      background-color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #333;
    }}

    /* 投影片主畫布 (16:9) */
    .viewer-container {{
      width: 1066px;
      height: 600px;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      display: flex;
      position: relative;
    }}

    /* 左側側邊深色欄 */
    .sidebar {{
      width: 280px;
      height: 100%;
      background-color: #1e293b;
      color: white;
      padding: 35px 25px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      flex-shrink: 0;
    }}
    .main-title {{
      font-size: 32px;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 1px;
    }}
    .sub-title {{
      font-size: 19px;
      color: #94a3b8;
      margin-top: 6px;
    }}
    .center-icon {{
      display: flex;
      justify-content: center;
      align-items: center;
      margin: 15px 0;
    }}
    .circle-badge {{
      width: 110px;
      height: 110px;
      border-radius: 50%;
      background-color: #e2e8f0;
      display: flex;
      justify-content: center;
      align-items: center;
      font-size: 48px;
    }}
    .highlight-quote {{
      color: #f59e0b;
      font-size: 16px;
      font-weight: bold;
      line-height: 1.4;
      margin-bottom: 6px;
    }}
    .quote-desc {{
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.4;
    }}

    /* 右側主內容區 */
    .content-area {{
      flex: 1;
      padding: 30px 35px;
      display: flex;
      gap: 20px;
      background-color: #f8fafc;
    }}
    .steps-column {{
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }}
    .step-card {{
      background-color: #edf5ff;
      border: 1.5px dashed #60a5fa;
      border-radius: 8px;
      padding: 12px 18px;
      font-size: 17px;
      font-weight: bold;
      color: #1e3a8a;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      min-height: 48px;
    }}
    .step-card span.highlight {{
      color: #0284c7;
      font-weight: 900;
      text-decoration: underline;
      text-underline-offset: 4px;
      margin: 0 4px;
    }}

    /* 右側分組分類標籤 */
    .groups-column {{
      width: 100px;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      border-left: 3px solid #3b82f6;
      padding-left: 14px;
    }}
    .group-tag {{
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
    }}

    /* 下方播放控制列 */
    .controls-bar {{
      margin-top: 18px;
      display: flex;
      align-items: center;
      gap: 20px;
      background-color: #1e293b;
      padding: 10px 24px;
      border-radius: 30px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
    }}
    .btn {{
      background-color: #3b82f6;
      color: white;
      border: none;
      padding: 8px 18px;
      border-radius: 20px;
      cursor: pointer;
      font-weight: bold;
      font-size: 14px;
      transition: all 0.2s;
    }}
    .btn:hover {{
      background-color: #2563eb;
      transform: scale(1.03);
    }}
    .btn:disabled {{
      background-color: #475569;
      cursor: not-allowed;
      transform: none;
    }}
    .page-indicator {{
      color: #e2e8f0;
      font-size: 15px;
      font-weight: bold;
      min-width: 60px;
      text-align: center;
    }}
  </style>
</head>
<body>

  <!-- 簡報播放主畫布 -->
  <div class="viewer-container" id="slideCanvas">
    <!-- JS 會在此動態注入目前投影片 -->
  </div>

  <!-- 下方控制列 -->
  <div class="controls-bar">
    <button class="btn" id="prevBtn" onclick="prevSlide()">◀ 上一頁</button>
    <div class="page-indicator" id="pageNumber">1 / 1</div>
    <button class="btn" id="nextBtn" onclick="nextSlide()">下一頁 ▶</button>
  </div>

  <script>
    const data = {slides_json};
    let currentIndex = 0;

    function renderSlide(index) {{
      const slide = data.slides[index];
      const canvas = document.getElementById('slideCanvas');
      
      // 處理右側卡片文字 highlight
      const stepsHtml = slide.steps.map(step => {{
        let content = step.text;
        if (step.highlight_keyword && content.includes(step.highlight_keyword)) {{
          content = content.replace(
            step.highlight_keyword, 
            `<span class="highlight">${{step.highlight_keyword}}</span>`
          );
        }}
        return `<div class="step-card">${{content}}</div>`;
      }}).join('');

      // 處理右側分組垂直標籤
      const groupsHtml = slide.groups.map(g => {{
        const formattedLabel = g.label.split('').join('<br>');
        return `<div class="group-tag">${{formattedLabel}}</div>`;
      }}).join('');

      canvas.innerHTML = `
        <div class="sidebar">
          <div>
            <div class="main-title">${{slide.main_title}}</div>
            <div class="sub-title">${{slide.sub_title}}</div>
          </div>
          <div class="center-icon">
            <div class="circle-badge">${{slide.icon_emoji || '💡'}}</div>
          </div>
          <div>
            <div class="highlight-quote">${{slide.quote_highlight}}</div>
            <div class="quote-desc">${{slide.quote_desc}}</div>
          </div>
        </div>

        <div class="content-area">
          <div class="steps-column">${{stepsHtml}}</div>
          <div class="groups-column">${{groupsHtml}}</div>
        </div>
      `;

      // 更新控制列狀態
      document.getElementById('pageNumber').innerText = `${{index + 1}} / ${{data.slides.length}}`;
      document.getElementById('prevBtn').disabled = (index === 0);
      document.getElementById('nextBtn').disabled = (index === data.slides.length - 1);
    }}

    function prevSlide() {{
      if (currentIndex > 0) {{
        currentIndex--;
        renderSlide(currentIndex);
      }}
    }}

    function nextSlide() {{
      if (currentIndex < data.slides.length - 1) {{
        currentIndex++;
        renderSlide(currentIndex);
      }}
    }}

    // 支援鍵盤左右方向鍵切換
    document.addEventListener('keydown', (e) => {{
      if (e.key === 'ArrowLeft') prevSlide();
      if (e.key === 'ArrowRight') nextSlide();
    }});

    // 初始化渲染第一頁
    renderSlide(0);
  </script>
</body>
</html>
"""
    with open(output_html, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"\n🎉 網頁簡報閱讀器已產出：{output_html}")

if __name__ == "__main__":
    sample_topic = """
AI Agent 應用開發 - 智慧簡報生成工作流系統
2026/7~仍在進行
核心技術：Agentic Workflow、Prompt Engineering

端到端 Agentic 工作流落地：設計「多格式解析 → 需求規格對齊 → 語意架構審核 → 簡報視覺產出」四階段流程，解決傳統簡報製作耗時繁瑣痛點。
多來源數據整合：支援 PDF、PPT、Excel、CSV 等多元格式，透過前處理提取結構化與非結構化數據作為資料依據。
人員協同覆核機制 ：於影像渲染前建立「文字預檢與自適應分頁審核點」，兼顧模型幻覺控制與 Token 成本優化。
專案成效：實現引導式對話一鍵產出簡報影像，大幅縮短簡報製作時間，降低非技術人員操作門檻。
AI Agent 應用開發 - 異常事件查詢流程簡化
2026/6~2026/8
核心技術：Agentic Workflow、Prompt Engineering、Web API、Databricks Genie

解決作業痛點：針對無權責單位標示之異常事件，導致跨系統查詢繁瑣、歸因耗時、跨部門通報延遲，主動設計並開發 AI Agent 應用，實現自動化檢索與跨單位通報流程。
技術整合與應用：結合 Databricks Genie Space & Local Web API 與 LLM Agent 進行自然語言解析與自動查詢，並將異常結果自動化通報。
專案成效：將原本繁瑣的手動查詢化繁為簡，人員僅需輸入基礎資訊即可自動完成歸因與通知，人工作業時間縮短約 90 %
全端系統開發 - 曝光機軟體生產參數批次修改網頁系統
2019/12~2026/9
核心技術：C# / .NET (舊世代架構)、PHP & Python (新世代架構)、XML 解析、FTP、SQL 資料庫

跨世代核心設備架構演進與系統重構：針對廠內之曝光機生產設備，橫跨兩種廠牌機型開發全端參數管理系統；2019 年以 C#/.NET 建構舊機種管理平台，2026 年以 PHP & Python 架構開發新機型曝光機參數修改系統，具備長期架構維護與技術遷移能力。
高可用容錯與災難復原機制：實作底層 XML 配置檔解析引擎與安全傳輸協定，建立「變更前自動鏡像備份 → 批次寫入 → 異常回滾 (Rollback)」機制，確保高敏感性設備參數異動具備 100% 可逆性與系統可用性。
邊界數值防呆與嚴格輸入校驗：深度整合製程邏輯，建置動態數值邊界計算與交互校驗防呆引擎，徹底杜絕人為輸入錯誤導致高額產品報廢之營運風險。
變動軌跡追蹤 (Audit Log)：完整記錄參數版本異動歷程（變更人、時間戳、Diff 比對），符合廠級製造合規稽核。
專案成效：繁瑣的手動調整流程縮短約 85% 作業工時，提升製程工程師日常工作效率。
    """
    
    print("Gemini 正在分析內容並生成多頁資訊圖表架構...")
    presentation_data = generate_web_presentation(sample_topic)
    build_html_viewer(presentation_data, "presentation_viewer.html")