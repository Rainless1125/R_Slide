# R Slide

> Rapid & Responsive AI Presentation Engine — 貼上文字內容,由 LLM 自動規劃版面並產生可編輯、可匯出的 HTML 簡報。可自行部署於自己的伺服器或內網。

<!-- TODO: 補上 badges(License / Python 版本 / Docker)與畫面截圖或 GIF -->
<!-- ![Demo](docs/demo.gif) -->

## 特色

- **內容導向的動態版面**:依內容型態自動選擇版型(KPI 大數字、流程步驟卡、左右對比等),而非固定模板。
- **多模型支援**:Gemini 與 OpenAI 可切換,只需設定其中一個 API Key。
- **視覺風格可指定**:例如「蘋果極簡白」、科技深色風等,以 Tailwind CSS 實踐。
- **單頁重新生成**:不滿意某一頁時,可附加需求單獨重產,並維持整份簡報一致。
- **匯出單一 HTML**:匯出時會清理 AI 產生的內容(移除 script、事件屬性、外部資源白名單)。
- **輕量部署**:後端為單一 FastAPI 服務,前端為靜態檔案,無需資料庫。

## 快速開始

需求:Python 3.10+(開發環境為 3.13)、至少一組 Gemini 或 OpenAI API Key。

```bash
git clone https://github.com/Rainless1125/R_Slide.git
cd R_Slide

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env_example .env             # 編輯 .env,填入 API Key
python app.py
```

開啟瀏覽器前往 <http://127.0.0.1:8000>。

## 設定

於專案根目錄的 `.env` 設定(至少填一個):

| 變數 | 說明 | 必填 |
|------|------|------|
| `GEMINI_API_KEY` | Google Gemini API Key | 與 OpenAI 擇一 |
| `OPENAI_API_KEY` | OpenAI API Key | 與 Gemini 擇一 |

可選模型清單定義於 `app.py` 的 `MODEL_CATALOG`,可依需求修改。

## 部署到自己的伺服器

`python app.py` 預設只監聽 `127.0.0.1`(`reload=True`,僅適合開發)。正式部署建議:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

並置於 Nginx / Caddy 等反向代理之後啟用 HTTPS。

> **注意**:本服務目前沒有登入驗證。對外開放前請自行在反向代理層加上驗證(Basic Auth、SSO 等),避免 API Key 額度被他人使用。

### 網路與資料流向(地端部署前請務必了解)

資料**不會**存放在伺服器上(無資料庫),但目前並非完全離線:

| 項目 | 說明 |
|------|------|
| LLM 呼叫 | 輸入內容會送往 Gemini / OpenAI API,伺服器需可連外至這些服務。 |
| 前端資源 | 介面載入 Tailwind CDN 與 Font Awesome CDN,使用者瀏覽器需可連外。 |
| 匯出 HTML | 目前為 CDN 版;離線版(內嵌 Tailwind / Font Awesome / 字型)尚在規劃中。 |

若需要完全內網 / 離線運作,需自行改接內部 LLM 端點並自架前端靜態資源,。

## 專案結構

```
app.py            FastAPI 後端(/api/generate、/api/regenerate-slide、/api/models)
static/index.html 前端介面
static/export.js  匯出與 HTML 清理邏輯
.env_example      環境變數範本
```
