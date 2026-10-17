# R Slide

> Rapid & Responsive AI Presentation Engine — 貼上文字內容,由 LLM 自動規劃版面並產生可編輯的簡報,可匯出為 PDF、PowerPoint 或 HTML。可自行部署於自己的伺服器或內網。

<!-- TODO: 補上 badges(License / Python 版本 / Docker)與畫面截圖或 GIF -->
<!-- ![Demo](docs/demo.gif) -->

## 特色

- **內容導向的動態版面**:依內容型態自動選擇版型(KPI 大數字、流程步驟卡、左右對比等),而非固定模板。
- **圖表**:數據類內容由 LLM 輸出結構化圖表資料(直條、橫條、折線、圓餅、環圈),前端畫成靜態 SVG,編輯與匯出都不需要額外腳本;編輯模式中可修改圖表數據或自行插入圖表,數據以試算表式表格輸入(方向鍵移動、可直接貼上 Excel / Google 試算表的多格資料),直條、橫條與折線圖可加上參考虛線(目標、規格上下限、門檻)。
- **插入文字與圖片**:編輯模式中可插入文字方塊(字級、粗細、顏色沿用格式工具列),也可上傳、拖放或貼上圖片;兩者都能拖曳移動、拉角落調整大小。圖片在瀏覽器端壓縮後內嵌於簡報,不經過伺服器。
- **快速插入圖示**:編輯模式中點「圖示」開啟清單,內建 150 個辦公室簡報常用的 Font Awesome Free 圖示,依商務、財務、數據、人員、溝通、文件、時間、科技、流程、箭頭、地點、常用符號分組,每列 10 個;可用中英文關鍵字搜尋(例如 `cash`、`會議`、`成長`),Enter 直接插入第一個結果。插入後可拖曳移動、拉角落等比縮放,顏色、背景與圓角沿用格式工具列(背景 + 圓形圓角即可做成圖示徽章)。
- **匯入檔案作為素材**:支援 PDF、Word(.docx)、Markdown、TXT,可點選上傳、拖放或貼上檔案;文字抽出後會先填入輸入框,可檢查、修改再生成。
- **多模型支援**:Gemini、OpenAI 與 Databricks AI Gateway 可切換,只需設定其中一組;Databricks 適合公司統一透過 AI Gateway 管理模型與費用的情境。
- **視覺風格可指定**:例如「蘋果極簡白」、科技深色風等,以 Tailwind CSS 實踐。
- **講者備註與講者檢視**:LLM 會為每頁產生口語化的講稿(補充畫面上沒寫的脈絡,不重複投影片文字),可在播放器下方的備註區直接修改(快捷鍵 N)。「講者檢視」(快捷鍵 P)另開視窗顯示目前頁、下一頁、備註與計時器,適合主畫面投影、筆電看講稿;在講者檢視中可用方向鍵、PageUp / PageDown(簡報筆)換頁。備註會寫入 PPTX 的備忘稿,HTML 匯出也可按 N 顯示。
- **單頁重新生成**:不滿意某一頁時,可附加需求單獨重產,並維持整份簡報一致。
- **匯出 PDF / PPTX / HTML**:PDF 與 PPTX 的每一頁為 2 倍解析度的圖片,外觀與畫面一致,但文字無法再編輯;HTML 為可直接播放的單一檔案,匯出時會清理 AI 產生的內容(移除 script、事件屬性、外部資源白名單)。
- **輕量部署**:後端為單一 FastAPI 服務,前端為靜態檔案,無需資料庫。

> **編輯模式的限制**:LLM 生成的版面目前**只能修改文字與樣式**(字級、粗細、對齊、顏色、圓角),以及調整同層順序、複製或刪除元素,**無法自由拖曳移動或縮放**;LLM 產生的圖表也只能修改數據,位置與大小固定。若需要自由擺放,請使用編輯模式的「插入文字」「插入圖片」「插入圖表」「插入圖示」,自行插入的內容可以拖曳移動、拉角落調整大小。
>
> **建議用法**:想在 LLM 生成的頁面放自己的圖片時,先用「重產此頁」並在提示詞中說明要留空的區塊,例如「右半邊留白,之後放產品照片」或「標題下方保留一塊空白區域放圖表」;重產完成後再進入編輯模式,把圖片或圖表插入並拖曳到留空的位置。

## 快速開始

需求:Python 3.10+(開發環境為 3.13)、至少一組 Gemini / OpenAI API Key 或 Databricks AI Gateway 設定。

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

於專案根目錄的 `.env` 設定(以下三組平台至少設定一組):

| 變數 | 說明 | 必填 |
|------|------|------|
| `GEMINI_API_KEY` | Google Gemini API Key | 三組擇一 |
| `OPENAI_API_KEY` | OpenAI API Key | 三組擇一 |
| `DATABRICKS_HOST` | Databricks workspace 網址,例如 `https://adb-123.azuredatabricks.net` | 使用 Databricks 時 |
| `DATABRICKS_TOKEN` | Databricks 存取權杖(PAT 或 service principal 的 token) | 使用 Databricks 時 |
| `DATABRICKS_MODELS` | 開放給使用者選的模型(serving endpoint 名稱),以逗號分隔,第一個為預設 | 使用 Databricks 時 |
| `DATABRICKS_BASE_URL` | 選填,覆寫 OpenAI 相容端點;預設為 `<DATABRICKS_HOST>/serving-endpoints` | 否 |

Gemini 與 OpenAI 的可選模型清單定義於 `app.py` 的 `MODEL_CATALOG`,可依需求修改;Databricks 的模型清單則完全由 `DATABRICKS_MODELS` 決定,前端只能選清單內的模型。

### 使用 Databricks AI Gateway

Databricks 的 Model Serving / AI Gateway 提供 OpenAI 相容 API,本服務以 OpenAI SDK 呼叫:

```env
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<token>
DATABRICKS_MODELS=databricks-claude-sonnet-4-5,databricks-gpt-oss-120b
```

- **模型名稱**:填 Databricks「Serving」頁面上的 endpoint 名稱(公司自建的外部模型 endpoint 也可以)。
- **端點路徑**:預設呼叫 `<DATABRICKS_HOST>/serving-endpoints`;若公司改用 Unity AI Gateway 的新路徑,可設定 `DATABRICKS_BASE_URL=https://<workspace>/ai-gateway/mlflow/v1`,模型名稱改用 `system.ai.<模型>` 這類完整名稱。
- **結構化輸出**:先以 JSON Schema 結構化輸出呼叫;若該模型不支援(回 400),會自動改為在提示詞附上 schema、由後端驗證回傳的 JSON。
- **權杖**:測試可用個人 PAT;正式上線建議使用 service principal 的權杖,避免綁定個人帳號。
- **用量與限流**:所有請求都以同一個權杖送出,Databricks 端只會看到「這個服務」的用量;流量限制、用量追蹤與內容記錄請在 Databricks 的 AI Gateway 設定。

### 檔案匯入限制

- 支援格式:`.pdf`、`.docx`、`.md` / `.markdown`、`.txt`(TXT 會自動辨識 UTF-8、含 BOM 的 UTF-16、Big5 編碼)。
- 單檔上限 10 MB(`extract.py` 的 `MAX_UPLOAD_BYTES`);抽出的文字超過 50,000 字時會截斷並提示。
- 掃描影像型 PDF 沒有文字層,目前不支援(未做 OCR);舊版 `.doc` 請先另存為 `.docx`。

## 部署到自己的伺服器

`python app.py` 預設只監聽 `127.0.0.1`(`reload=True`,僅適合開發)。正式部署建議:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

並置於 Nginx / Caddy 等反向代理之後啟用 HTTPS。若使用 Nginx,其預設上傳上限為 1 MB,需調高才能匯入較大的檔案或匯出 PPTX:

```nginx
client_max_body_size 40m;   # 檔案匯入上限 10 MB;匯出 PPTX 時整份簡報的圖片上限 40 MB
```

> **注意**:本服務目前沒有登入驗證。對外開放前請自行在反向代理層加上驗證(Basic Auth、SSO 等),避免 API Key 額度被他人使用。

### 網路與資料流向(地端部署前請務必了解)

資料**不會**存放在伺服器上(無資料庫),但目前並非完全離線:

| 項目 | 說明 |
|------|------|
| 檔案匯入 | 伺服器只抽取文字回傳給瀏覽器,不保存檔案;超過 1 MB 的檔案在解析期間會暫存於系統暫存目錄,處理完即刪除。抽取過程不會連外。 |
| LLM 呼叫 | 輸入內容會送往 Gemini / OpenAI API 或公司的 Databricks workspace,伺服器需可連到這些服務。 |
| 前端資源 | 介面載入 Tailwind CDN 與 Font Awesome CDN,使用者瀏覽器需可連外。 |
| 匯出 PDF | 在瀏覽器端完成,不經過伺服器;第一次匯出時會從 cdnjs 載入 html-to-image 與 jsPDF。 |
| 匯出 PPTX | 每頁圖片由瀏覽器渲染後送到伺服器組成 PPTX,伺服器不保存;同樣需從 cdnjs 載入 html-to-image。 |
| 插入圖片 | 在瀏覽器端縮至最長邊 1600px 後以 data URL 存在簡報與歷史記錄(localStorage)中,不會上傳;重產單頁時圖片也不會送給 LLM。圖片多時歷史記錄可能因儲存空間不足而自動移除較舊的紀錄。 |
| 匯出 HTML | 目前為 CDN 版;離線版(內嵌 Tailwind / Font Awesome / 字型)尚在規劃中。 |

若需要完全內網 / 離線運作,需自行改接內部 LLM 端點並自架前端靜態資源。

## 專案結構

```
charts.py         圖表資料的 schema、LLM 提示規則與正規化
app.py            FastAPI 後端(/api/generate、/api/regenerate-slide、/api/extract、/api/export/pptx、/api/models)
extract.py        上傳檔案的文字抽取(PDF / DOCX / Markdown / TXT)
exporter.py       將投影片圖片組成 PPTX(/api/export/pptx)
static/index.html 前端介面(HTML 結構;樣式與程式在 static/app/)
static/app/       主畫面的樣式與程式,依功能分檔,以一般 <script> 依序載入、共用全域:
  app.css         主畫面樣式
  core.js         主題、全域狀態、小工具、錯誤訊息、歷史記錄、側邊欄
  input.js        範例、檔案匯入、輸入區(受眾 / 風格 / 草稿)
  generate.js     步驟條、模型選單、生成、檢閱頁、單頁重新生成
  editor.js       撤銷 / 重做、選取與行內文字編輯、格式工具列
  media.js        圖片、文字方塊、圖示、浮動物件拖曳縮放、圖表資料編輯
  player.js       頁面管理、播放器、自動播放、全螢幕、匯出選單
  main.js         全域快捷鍵、捲動 / 縮放事件與啟動(最後載入)
static/charts.js  圖表 → 靜態 SVG 繪製
static/chart-grid.js 圖表數據的試算表式輸入表格
static/icons.js   快速插入圖示的內建清單(150 個 Font Awesome Free 圖示、分組與搜尋關鍵字)
static/export.js  匯出(HTML / PDF / PPTX)與 HTML 清理邏輯
static/presenter.js 講者備註區與講者檢視視窗
.env_example      環境變數範本
tests/            後端測試
```

## 測試

```bash
pip install pytest
python -m pytest
```
