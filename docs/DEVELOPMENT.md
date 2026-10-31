# R Slide 開發說明

本文件給要修改 R Slide 程式碼的人。
安裝、設定與部署的方法在 [README](../README.md)。

## 啟動開發環境

1. 照 README 的「安裝與啟動」安裝套件並建立 `.env`。
2. 啟動服務：

   ```bash
   python app.py
   ```

   此指令使用開發模式。修改 Python 檔後，服務自動重新啟動。

3. 在瀏覽器開啟 <http://127.0.0.1:8000>。

## 專案結構

### 後端

```
app.py            FastAPI 主程式：生成、大綱、重產、檔案匯入、匯出 PPTX 的 API，與生成用的提示規則
deck_design.py    整份簡報的設計規範（theme）、版型目錄、頁面節奏與內容正確性規則
charts.py         圖表資料的格式、正規化與提示規則
accounts.py       登入、註冊、歷史記錄與意見回饋的 API（/api/auth/*、/api/history、/api/feedback）
ldap_auth.py      登入方式（AUTH_MODE）的設定檢查與公司 LDAP 驗證
admin.py          後台管理的 API（/api/admin/*）
store.py          SQLite 資料存取：帳號、session、登入鎖定、註冊次數、歷史記錄、用量紀錄、意見回饋
manage_users.py   帳號管理指令
extract.py        讀取上傳檔案的文字（PDF、DOCX、PPTX、Markdown、TXT）
slide_images.py   匯入檔案時用 AI 辨識圖片（PPTX 的圖片、PDF 的掃描頁）：提示規則、逐頁呼叫與併發
exporter.py       把投影片圖片組成 PPTX
.env_example      環境變數範本
```

### 前端

```
static/index.html     主畫面
static/admin.html     後台管理頁面（樣式與程式在 static/admin/）
static/charts.js      把圖表資料畫成 SVG
static/chart-grid.js  圖表數據的表格輸入
static/export.js      匯出 HTML、PDF、PPTX，與 HTML 清理（sanitizeSlideHtml）
static/presenter.js   講者備註與講者檢視
static/icons.js       插入圖示的清單（分組與搜尋關鍵字）
static/vendor/        本機提供的前端元件：Tailwind（瀏覽器版）、Font Awesome、html-to-image、jsPDF
static/app/           主畫面的樣式與程式：
  app.css             樣式
  core.js             主題、全域狀態、提示訊息、錯誤訊息、歷史記錄、側邊欄
  input.js            範例、檔案匯入、輸入區
  generate.js         模型選單、生成、載入狀態、審查頁、單頁重產
  outline.js          先確認大綱
  shapes.js           插入圖案
  editor.js           撤銷 / 重做、選取、文字編輯、編輯列與格式工具列
  media.js            插入圖片、文字方塊、圖示；拖曳、縮放；版面元素的移動與縮放；圖表編輯器
  player.js           頁面管理、播放器、全螢幕、匯出選單
  versions.js         重產前的舊版本
  auth.js             登入、註冊、登出
  guide.js            使用教學視窗
  feedback.js         意見回饋視窗
  main.js             全域快捷鍵與啟動（最後載入）
```

### 測試

```
tests/            後端測試（pytest）
```

## 開發規則

### 套件版本

- `requirements.txt` 的版本固定為測試過的組合，支援 Python 3.11~3.14。
- 升級套件時：
  1. 在新版本執行 `python -m pytest`，確認全部通過。
  2. 確認新版本仍支援 Python 3.11。
  3. 更新 `requirements.txt`。

### 前端程式

- `static/app/` 的檔案是一般的 `<script>`，不是 ES module。所有檔案共用全域變數。
- 載入順序很重要。順序寫在 `static/index.html` 的 `<script>` 標籤。
- 修改 `static/` 的檔案後，把 `static/index.html` 中該檔案的版本號加 1，例如 `editor.js?v=11` 改為 `editor.js?v=12`。

注意：如果沒有更新版本號，使用者的瀏覽器可能繼續使用舊的檔案。

### 前端元件

- 前端元件放在 `static/vendor/`，不從 CDN 載入，讓不能連外網的內網也能使用。
- 升級元件時：
  1. 下載新版檔案，放進 `static/vendor/`。檔名包含版本號。
  2. 更新引用的路徑：`static/index.html`、`static/admin.html`、`static/export.js` 的 `RS_VENDOR` 與 `EXPORT_LIBS`。
  3. 更新 `static/vendor/README.md` 的版本與來源。
- `static/vendor/` 的檔案不做換行轉換（見 `.gitattributes`）。Windows 上的 Git 預設會把換行轉成 CRLF，改變檔案內容。

### AI 輸出的規則

- 給 AI 的提示規則在三個檔案：
  - `app.py`：版面尺寸、簡報模式、一頁式報告、講者備註。
  - `deck_design.py`：設計規範、版型目錄、頁面節奏、內容正確性。
  - `charts.py`：圖表。
- AI 輸出的格式用 Pydantic 定義，例如 `AdaptivePresentation`、`ChartSpec`。
- 給 AI 的格式不可以有預設值。Gemini 的 `response_schema` 不支援預設值。`tests/test_charts.py` 會檢查這條規則。

### 投影片 HTML

- AI 產生的 HTML 在進入畫面前一律經過 `sanitizeSlideHtml` 清理。
- 版面元素的移動與縮放存成 inline style 的 `translate` 與 `scale`。

## 測試

### 執行測試

```bash
pip install pytest
python -m pytest
```

### 測試的行為

- 測試不呼叫 AI 平台。測試用假的 API Key。
- 每個測試使用自己的暫存資料庫，不會寫入 `data/rslide.db`。
- 測試預設關閉註冊次數限制。只有 `tests/test_register_limit.py` 測試這個限制。
- 需要登入的 API，用 `logged_in` fixture 略過登入。
- 測試不連線 LDAP 伺服器。`tests/test_auth_mode.py` 以假的綁定函式測試 LDAP 登入。
- 取代 `call_llm` 的假函式要接受 `thinking` 參數（思考長度）。
