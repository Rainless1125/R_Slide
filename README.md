# R Slide

> Rapid & Responsive AI Presentation Engine — 貼上文字內容,由 LLM 自動規劃版面並產生可編輯的簡報,可匯出為 PDF、PowerPoint 或 HTML。可自行部署於自己的伺服器或內網。

<!-- TODO: 補上 badges(License / Python 版本 / Docker)與畫面截圖或 GIF -->
<!-- ![Demo](docs/demo.gif) -->

## 特色

- **內容導向的動態版面**:依內容型態自動選擇版型(KPI 大數字、流程步驟卡、左右對比等),而非固定模板。
- **簡報模式**:生成前可選「簡易模式(演講型 / Speaker Deck)」或「詳細模式(閱讀型 / Document Deck)」。演講型一頁一重點、少字大圖,論述細節寫進較完整的講者備註,適合上台報告;閱讀型以結論句當標題、附導言與完整論述和數據出處,不需講者也能看懂,適合會後寄送。歷史記錄、審查頁與播放器會標示每份簡報的模式;單頁重產預設沿用該簡報的模式,也可在重產視窗改用另一種模式(之後的重產都會沿用)。頁數可指定 2~12 頁或由 AI 決定,詳細模式資訊量較大,素材豐富時建議由 AI 決定頁數。
- **圖表**:數據類內容由 LLM 輸出結構化圖表資料(直條、橫條、折線、圓餅、環圈),前端畫成靜態 SVG,編輯與匯出都不需要額外腳本;編輯模式中可修改圖表數據或自行插入圖表,數據以試算表式表格輸入(方向鍵移動、可直接貼上 Excel / Google 試算表的多格資料),直條、橫條與折線圖可加上參考虛線(目標、規格上下限、門檻)。
- **插入文字與圖片**:編輯模式中可插入文字方塊(字級、粗細、顏色沿用格式工具列),也可上傳、拖放或貼上圖片;兩者都能拖曳移動、拉角落調整大小。圖片在瀏覽器端壓縮後內嵌於簡報,不經過伺服器。
- **快速插入圖示**:編輯模式中點「圖示」開啟清單,內建 300 個辦公室簡報常用的 Font Awesome Free 圖示,依商務、財務、數據、人員、溝通、文件、時間、科技、流程、箭頭、地點、常用符號、操作介面、醫療健康、教育學習、環境能源、建築工地、創意設計分組,每列 10 個;可用中英文關鍵字搜尋(例如 `cash`、`會議`、`成長`),Enter 直接插入第一個結果。插入後可拖曳移動、拉角落等比縮放,顏色、背景與圓角沿用格式工具列(背景 + 圓形圓角即可做成圖示徽章)。
- **插入圖案**:編輯模式中點「圖案」可插入 16 種常用圖案:矩形、圓角矩形、橢圓、三角形、直角三角形、菱形、平行四邊形、梯形、五邊形、六邊形、星形、箭頭、流程箭頭、對話框,以及直線與箭頭線。選取圖案後,格式工具列可調整填滿顏色、外框顏色、外框粗細(無外框、1~16px)、線條樣式(實線、虛線、點線)與圓角(直角、4~48px 或最大,套用在圖形的每個轉角,例如圓角三角形、圓角星形;橢圓與線條沒有轉角),顏色可從色盤選取或自訂;雙擊圖案可在圖案內輸入文字(字級、粗細、對齊、文字顏色沿用格式工具列)。圖案可拖曳移動、拉角落縮放,縮放後外框粗細不變;圖案為靜態 SVG,匯出 PDF / PPTX / HTML 都能保留。
- **編輯快捷操作**:自行插入的文字、圖片、圖表、圖示與圖案拖曳或縮放時,會自動對齊投影片邊緣、中線與其他元素並顯示參考線(按住 Alt 暫停吸附);選取後可用方向鍵微調位置(Shift 一次 10px,連續微調只算一個撤銷步驟),Ctrl+C / Ctrl+X / Ctrl+V 複製、剪下、貼上(可貼到其他頁,圖表資料一併帶過去),Ctrl+D 再製。
- **新增空白頁**:審查頁每張卡片的「+」可在該頁後新增空白頁,最後一格可新增到最後;播放器的編輯模式也可在目前頁面後新增並直接切換過去。空白頁沿用參考頁的背景與文字顏色,再自行插入內容。
- **匯入檔案作為素材**:支援 PDF、Word(.docx)、Markdown、TXT,可點選上傳、拖放或貼上檔案;文字抽出後會先填入輸入框,可檢查、修改再生成。
- **多模型支援**:Gemini、OpenAI 與 Databricks AI Gateway 可切換,只需設定其中一組;Databricks 適合公司統一透過 AI Gateway 管理模型與費用的情境。
- **視覺風格可指定**:例如「蘋果極簡白」、科技深色風等,以 Tailwind CSS 實踐。
- **講者備註與講者檢視**:LLM 會為每頁產生口語化的講稿(補充畫面上沒寫的脈絡,不重複投影片文字),可在播放器下方的備註區直接修改(快捷鍵 N)。「講者檢視」(快捷鍵 P)另開視窗顯示目前頁、下一頁、備註與計時器,適合主畫面投影、筆電看講稿;在講者檢視中可用方向鍵、PageUp / PageDown(簡報筆)換頁。備註會寫入 PPTX 的備忘稿,HTML 匯出也可按 N 顯示。
- **單頁重新生成**:不滿意某一頁時,可附加需求單獨重產,並維持整份簡報一致。
- **匯出 PDF / PPTX / HTML**:PDF 與 PPTX 的每一頁為 2 倍解析度的圖片,外觀與畫面一致,但文字無法再編輯;HTML 為可直接播放的單一檔案,匯出時會清理 AI 產生的內容(移除 script、事件屬性、外部資源白名單)。
- **帳號與歷史記錄**:以帳號密碼登入,每位使用者的簡報歷史記錄分開存放於伺服器的 SQLite 檔案,換電腦或瀏覽器也能接續使用。
- **使用教學**:右上角深色 / 淺色模式切換旁的「?」可開啟使用教學,依章節說明輸入、審查、播放、編輯、匯出與快捷鍵。
- **意見回饋**:使用教學旁的對話框圖示可為使用體驗評 1~5 星並輸入一段意見文字(兩者至少擇一,文字上限 2,000 字,`Ctrl` / `⌘` + `Enter` 送出),存於伺服器的 `feedback` 資料表,管理者以 `manage_users.py feedback` 查看;每個帳號每小時最多送出 10 則。
- **輕量部署**:後端為單一 FastAPI 服務,前端為靜態檔案;資料庫為內建的 SQLite,不需另外架設資料庫伺服器。

> **編輯模式的限制**:LLM 生成的版面目前**只能修改文字與樣式**(字級、粗細、對齊、顏色、圓角),以及調整同層順序、複製或刪除元素,**無法自由拖曳移動或縮放**;LLM 產生的圖表也只能修改數據,位置與大小固定。若需要自由擺放,請使用編輯模式的「插入文字」「插入圖片」「插入圖表」「插入圖示」「插入圖案」,自行插入的內容可以拖曳移動、拉角落調整大小。
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

### 帳號與歷史記錄

- 第一次開啟時需註冊 / 登入;歷史記錄依帳號分開存放,其他使用者看不到。每個帳號最多保留 200 筆,超過時自動刪除最舊的紀錄。
- 資料庫為單一 SQLite 檔案,預設 `data/rslide.db`(第一次使用時自動建立),**備份時複製整個 `data/` 資料夾即可**。請放在本機磁碟,不要放在 NFS / SMB 等網路磁碟上。
- 舊版存在瀏覽器 localStorage 的歷史記錄,會在該瀏覽器第一次登入時詢問是否匯入到目前的帳號。
- 密碼以 scrypt 雜湊儲存;登入狀態為 HttpOnly cookie,有效 30 天。

| 變數 | 說明 | 預設 |
|------|------|------|
| `RSLIDE_DB_PATH` | SQLite 檔案路徑 | `data/rslide.db` |
| `ALLOW_REGISTRATION` | 是否開放在登入頁自行註冊;設為 `false` 時只能由管理員建立帳號 | `true` |
| `COOKIE_SECURE` | 以 HTTPS 提供服務時設為 `true`,登入 cookie 只會經由 HTTPS 傳送 | `false` |
| `LLM_USAGE_RETENTION_DAYS` | LLM 使用紀錄保留天數,`0` 為永久保留 | `365` |
| `LLM_RATE_LIMIT_PER_HOUR` | 每個帳號每小時最多可生成 / 重產幾次,`0` 為不限制 | `20` |
| `LLM_RATE_LIMIT_PER_DAY` | 每個帳號 24 小時內最多可生成 / 重產幾次,`0` 為不限制 | `100` |
| `LLM_MAX_CONCURRENT` | 每個帳號同時最多進行幾個生成 / 重產,`0` 為不限制 | `2` |

管理員可在伺服器上以指令管理帳號:

```bash
python manage_users.py list                    # 列出帳號與紀錄筆數
python manage_users.py add <帳號>               # 建立帳號(關閉註冊時使用)
python manage_users.py reset-password <帳號>    # 重設密碼,該帳號所有裝置需重新登入
python manage_users.py usage [--days 30]         # 各使用者的 LLM 用量,依 token 由多到少排序
python manage_users.py usage <帳號> [--days 30]  # 單一使用者按日、模型的用量明細
python manage_users.py feedback [帳號] [--days 30]  # 使用者送出的意見回饋與使用體驗評分(含平均星數),新的在前
```

### LLM 使用紀錄

生成與單頁重產需要登入,每次呼叫 LLM(包含失敗的呼叫)都會在 SQLite 的 `llm_usage` 資料表記一筆,方便回查各使用者的用量、找出異常大量使用的帳號:

- 記錄內容:帳號、時間、動作(生成 / 重產)、平台與模型、簡報模式與頁數、素材字數、平台回傳的 token 數(輸入 / 輸出 / 合計,部分 Databricks 模型不提供時為空白)、成功或失敗原因、耗時與來源 IP。
- **不保存素材與 AI 回覆的內容**,素材只記字數與 SHA-256 雜湊,用來找出同一份內容被反覆送出的情況。
- 刪除帳號後紀錄仍會保留;超過 `LLM_USAGE_RETENTION_DAYS` 天的紀錄會自動刪除。
- 次數上限:每個帳號每小時最多 20 次、24 小時內最多 100 次、同時最多 2 個(生成與重產合併計算,失敗的呼叫也算,因為平台通常已用掉 token),超過時回 429 並告知需等待多久,不會呼叫 LLM;可用上表的環境變數調整。被擋下的請求記為 `rate_limited`,不算進次數,`manage_users.py usage` 的「限流」欄可看出誰常撞到上限。生成按鈕旁與重產視窗會顯示「1 小時內剩 N 次 · 24 小時內剩 N 次」(`GET /api/quota`),剩 3 次以內以橘色提示,用完時以紅字顯示多久後恢復。
- 欄位上限:素材 50,000 字、目標受眾 200 字、視覺風格 1,000 字、重產提示詞 2,000 字、簡報標題 200 字;重產時整份簡報最多 60 頁、要重產的那一頁 HTML 50,000 字、講者備註 5,000 字;生成與重產的請求本體最大 2 MB。
- 部署在反向代理之後時,來源 IP 依 uvicorn 的 `--forwarded-allow-ips` 決定是否採用 `X-Forwarded-For`,否則會記成代理的位址。
- `usage` 指令可留意:token 合計遠高於其他人、失敗次數偏高(反覆重試)、「同素材生成」次數偏高(同一份內容被大量送出)的帳號。

## 部署到自己的伺服器

`python app.py` 預設只監聽 `127.0.0.1`(`reload=True`,僅適合開發)。正式部署建議:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

並置於 Nginx / Caddy 等反向代理之後啟用 HTTPS。若使用 Nginx,其預設上傳上限為 1 MB,需調高才能匯入較大的檔案或匯出 PPTX:

```nginx
client_max_body_size 40m;   # 檔案匯入上限 10 MB;匯出 PPTX 與儲存單筆歷史記錄的上限 40 MB
```

> **注意**:生成與單頁重產需要登入;匯出與檔案匯入等不會呼叫 LLM 的 API 並未要求登入。若服務會對外開放,請在反向代理層加上驗證(Basic Auth、SSO 等)或將 `ALLOW_REGISTRATION` 設為 `false`,避免 API Key 額度被他人使用。

### 網路與資料流向(地端部署前請務必了解)

伺服器只保存帳號、歷史記錄、LLM 使用紀錄與意見回饋(SQLite,見上方「帳號與歷史記錄」),上傳的檔案與匯出的簡報都不保存;目前並非完全離線:

| 項目 | 說明 |
|------|------|
| 檔案匯入 | 伺服器只抽取文字回傳給瀏覽器,不保存檔案;超過 1 MB 的檔案在解析期間會暫存於系統暫存目錄,處理完即刪除。抽取過程不會連外。 |
| LLM 呼叫 | 輸入內容會送往 Gemini / OpenAI API 或公司的 Databricks workspace,伺服器需可連到這些服務。 |
| 前端資源 | 介面載入 Tailwind CDN 與 Font Awesome CDN,使用者瀏覽器需可連外。 |
| 匯出 PDF | 在瀏覽器端完成,不經過伺服器;第一次匯出時會從 cdnjs 載入 html-to-image 與 jsPDF。 |
| 匯出 PPTX | 每頁圖片由瀏覽器渲染後送到伺服器組成 PPTX,伺服器不保存;同樣需從 cdnjs 載入 html-to-image。 |
| 插入圖片 | 在瀏覽器端縮至最長邊 1600px 後以 data URL 內嵌於簡報,隨歷史記錄存入伺服器的 SQLite;重產單頁時圖片不會送給 LLM。單筆紀錄上限 40 MB。 |
| 匯出 HTML | 目前為 CDN 版;離線版(內嵌 Tailwind / Font Awesome / 字型)尚在規劃中。 |

若需要完全內網 / 離線運作,需自行改接內部 LLM 端點並自架前端靜態資源。

## 專案結構

```
charts.py         圖表資料的 schema、LLM 提示規則與正規化
app.py            FastAPI 後端(/api/generate、/api/regenerate-slide、/api/extract、/api/export/pptx、/api/models)
accounts.py       登入 / 註冊、歷史記錄與意見回饋 API(/api/auth/*、/api/history、/api/feedback)
store.py          SQLite 資料存取(帳號、登入 session、歷史記錄、LLM 使用紀錄、意見回饋)
manage_users.py   帳號管理指令(列出、建立帳號、重設密碼、查詢 LLM 用量與意見回饋)
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
  auth.js         登入 / 註冊、登出、匯入舊版 localStorage 歷史記錄
  guide.js        右上角「使用教學」視窗（章節分頁、上一步 / 下一步）
  feedback.js     右上角「意見回饋」視窗（輸入一段文字送到 /api/feedback）
  main.js         全域快捷鍵、捲動 / 縮放事件與啟動(最後載入)
static/charts.js  圖表 → 靜態 SVG 繪製
static/chart-grid.js 圖表數據的試算表式輸入表格
static/icons.js   快速插入圖示的內建清單(300 個 Font Awesome Free 圖示、分組與搜尋關鍵字)
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
