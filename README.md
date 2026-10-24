# R Slide

R Slide 用 AI 把文字素材做成簡報。
你可以編輯簡報，再匯出為 PDF、PowerPoint 或 HTML。
你可以把 R Slide 安裝在自己的伺服器或公司內網。

![R Slide 介紹影片](docs/demo.gif)

高畫質影片：[docs/r_slide_showreel.mp4](docs/r_slide_showreel.mp4)

## 用語

本文件的用語固定如下：

| 用語 | 意思 |
|------|------|
| 素材 | 你提供給 AI 的文字或檔案。 |
| 生成 | AI 依素材做出整份簡報。 |
| 重產 | AI 重新做出一頁投影片。 |
| 版面元素 | AI 在投影片上做出的文字、卡片與圖表。 |
| 插入物件 | 你在編輯模式加入的文字方塊、圖片、圖表、圖示與圖案。 |
| 編輯列 | 編輯模式中投影片上方的工具列。 |
| 管理者 | 在 `.env` 設定的後台帳號。 |

## 功能

### 生成簡報

- AI 依內容選擇版型。共有 14 種版型，例如封面、KPI 大數字、時間軸、比較表格。
- AI 先決定整份簡報的配色與樣式，再套用到每一頁。
- 相鄰兩頁不使用相同的版型。
- 生成前，選擇一種簡報模式：
  - 簡易模式：給上台報告用。每頁一個重點，細節寫在講者備註。
  - 詳細模式：給會後閱讀用。標題是結論句，內文有完整說明。
- 你可以指定 2~12 頁，或讓 AI 決定頁數。
- 你可以先確認大綱，再生成。大綱有每頁的標題、重點與建議版型。

### 圖表

- AI 把數據做成圖表：直條、橫條、折線、圓餅、環圈。
- 圖表可以有參考虛線，例如目標值。
- 圖表可以凸顯特定項目。被凸顯的項目保留原色，其他項目變成灰色。
- 你可以在編輯模式修改圖表數據。

### 編輯簡報

- 修改文字：雙擊文字。
- 調整樣式：選取元素，再使用編輯列。編輯列只顯示該元素可用的設定。
- 移動元素：拖曳元素，或按方向鍵。
- 縮放版面元素：拖曳元素的四個角。縮放時，文字一起變大或變小。
- 還原版面元素：按「還原位置」或「還原大小」。
- 插入物件：按「文字」、「圖片」、「圖表」、「圖示」或「圖案」。
- 撤銷：按 `Ctrl` + `Z`。

注意：重產一頁後，該頁的移動與縮放會消失。

### 其他功能

- 重產一頁：你可以加上需求，例如「改成時間軸」。
- 舊版本：重產前，系統保留舊的版本。每頁最多保留 3 個版本。
- 匯入檔案：支援 PDF、Word（.docx）、PowerPoint（.pptx）、Markdown 與 TXT。
- 匯入 PowerPoint：
  - 系統讀出每頁的文字、表格、圖表數據與講者備註。
  - 投影片中的截圖與圖表圖片，用目前選擇的模型辨識。辨識結果放在圖片原本的位置，標示「AI 辨識」。
  - 生成前，核對 AI 辨識的數字。
- 講者備註：AI 為每頁寫一份講稿。按 `N` 顯示備註。
- 講者檢視：按 `P` 開啟。講者檢視顯示目前頁、下一頁、備註與計時器。
- 匯出：PDF、PowerPoint（PPTX）與 HTML。
- 歷史記錄：系統把每個帳號的簡報存在伺服器。
- 使用教學：按右上角的「?」。
- 意見回饋：按右上角的對話框圖示。
- 後台管理：開啟 `/admin`。

## 限制

- PDF 與 PPTX 的每一頁是圖片。匯出後，你不能編輯文字。
- 版面元素只能等比例縮放。你不能只改寬度。
- 掃描的 PDF 沒有文字，R Slide 不能讀取。
- 舊的 `.doc` 檔不能讀取。先把它另存為 `.docx`。
- 舊的 `.ppt` 檔不能讀取。先把它另存為 `.pptx`。
- PowerPoint 的 EMF、WMF 向量圖不能辨識。
- 辨識圖片的模型必須支援圖片輸入。Databricks 的部分模型不支援。

## 安裝與啟動

### 需求

- Python 3.10 或更新版本。
- 一組 AI 平台設定：Gemini、OpenAI 或 Databricks。

### 步驟

1. 下載專案：

   ```bash
   git clone https://github.com/Rainless1125/R_Slide.git
   cd R_Slide
   ```

2. 建立虛擬環境：

   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

   在 Windows 上，改用 `.venv\Scripts\activate`。

3. 安裝套件：

   ```bash
   pip install -r requirements.txt
   ```

4. 建立設定檔：

   ```bash
   cp .env_example .env
   ```

5. 在 `.env` 填入 API Key。
6. 啟動服務：

   ```bash
   python app.py
   ```

7. 在瀏覽器開啟 <http://127.0.0.1:8000>。
8. 註冊一個帳號。

## 設定

所有設定都在專案根目錄的 `.env` 檔。
修改 `.env` 後，重新啟動服務。

### AI 平台

設定以下其中一組：

| 變數 | 說明 |
|------|------|
| `GEMINI_API_KEY` | Gemini 的 API Key。 |
| `OPENAI_API_KEY` | OpenAI 的 API Key。 |
| `DATABRICKS_HOST` | Databricks 的網址。 |
| `DATABRICKS_TOKEN` | Databricks 的存取權杖。 |
| `DATABRICKS_MODELS` | 可用的模型名稱。用逗號分開。第一個是預設模型。 |
| `DATABRICKS_BASE_URL` | 選填。另一個端點網址。 |

使用 Databricks 時，三個必填變數都要設定：`DATABRICKS_HOST`、`DATABRICKS_TOKEN`、`DATABRICKS_MODELS`。

範例：

```env
DATABRICKS_HOST=https://<workspace>.cloud.databricks.com
DATABRICKS_TOKEN=<token>
DATABRICKS_MODELS=databricks-claude-sonnet-4-5,databricks-gpt-oss-120b
```

說明：

- 模型名稱是 Databricks「Serving」頁面上的 endpoint 名稱。
- 正式環境使用 service principal 的權杖。不要使用個人權杖。
- 如果模型不支援結構化輸出，系統自動改用另一種方式。

### 帳號與用量

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `RSLIDE_DB_PATH` | 資料庫檔案的位置。 | `data/rslide.db` |
| `ALLOW_REGISTRATION` | 是否允許使用者自己註冊。 | `true` |
| `REGISTER_LIMIT_PER_IP_PER_DAY` | 一個 IP 在 24 小時內可以註冊的帳號數。`0` 表示沒有限制。 | `1` |
| `COOKIE_SECURE` | 使用 HTTPS 時，設為 `true`。 | `false` |
| `LLM_RATE_LIMIT_PER_HOUR` | 一個帳號每小時可以使用 AI 的次數。 | `20` |
| `LLM_RATE_LIMIT_PER_DAY` | 一個帳號每 24 小時可以使用 AI 的次數。 | `100` |
| `LLM_MAX_CONCURRENT` | 一個帳號同時可以進行的 AI 工作數。 | `2` |
| `LLM_USAGE_RETENTION_DAYS` | 用量紀錄的保留天數。`0` 表示永久保留。 | `365` |

說明：

- 生成、大綱與重產都算一次用量。失敗的工作也算。
- 匯入 PowerPoint 時，辨識整個檔案的圖片算一次用量。
- 一個帳號最多保留 200 筆歷史記錄。系統自動刪除最舊的記錄。
- 系統不保存素材與 AI 回覆的內容。系統只記錄字數與用量。

### 匯入 PowerPoint

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `EXTRACT_IMAGES` | 是否用 AI 辨識投影片中的圖片。設為 `false` 時，只匯入文字。 | `true` |
| `EXTRACT_IMAGE_MAX` | 一個檔案最多辨識幾張圖片。`0` 表示沒有限制。 | `0` |
| `EXTRACT_IMAGE_CONCURRENCY` | 同時辨識幾頁。 | `4` |

說明：

- 系統不辨識太小的圖片（例如圖示），也不辨識在 3 頁以上重複出現的圖片（例如 Logo）。
- PowerPoint 檔的上限是 30 MB。其他檔案的上限是 10 MB。

### 後台管理

在 `.env` 設定管理者：

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<密碼>
```

密碼規則：8~128 個字元，至少一個英文字母與一個數字。

後台可以做這些工作：

| 分頁 | 工作 |
|------|------|
| 總覽 | 查看帳號數、用量與意見回饋的統計。 |
| 帳號 | 建立帳號、重設密碼、刪除帳號。 |
| LLM 用量 | 查看每個帳號的用量。 |
| 意見回饋 | 查看使用者的評分與意見。 |
| IP 鎖定 | 解除被鎖定的 IP。 |

說明：

- 管理者不能登入主畫面。一般帳號不能登入後台。
- 後台登入 8 小時後失效。

你也可以在伺服器上用指令管理帳號：

```bash
python manage_users.py list                  # 列出帳號
python manage_users.py add <帳號>             # 建立帳號
python manage_users.py reset-password <帳號>  # 重設密碼
python manage_users.py usage                 # 查看用量
python manage_users.py feedback              # 查看意見回饋
python manage_users.py lockouts              # 查看被鎖定的 IP
python manage_users.py unlock <IP>           # 解除 IP 鎖定
```

### 安全規則

- 同一個 IP 登入失敗 5 次，該 IP 鎖定 30 分鐘。
- 同一個 IP 在 24 小時內只能註冊 1 個帳號。
- 生成、重產、匯入檔案與匯出 PPTX 都要先登入。

## 部署到正式環境

### 步驟

1. 用以下指令啟動服務：

   ```bash
   uvicorn app:app --host 0.0.0.0 --port 8000
   ```

   注意：不要在正式環境使用 `python app.py`。該指令使用開發模式。

2. 在服務前面加上反向代理，例如 Nginx 或 Caddy。
3. 啟用 HTTPS。
4. 在 `.env` 設定 `COOKIE_SECURE=true`。
5. 在 uvicorn 指令加上 `--forwarded-allow-ips <代理的 IP>`。
6. 如果使用 Nginx，加上這一行：

   ```nginx
   client_max_body_size 40m;
   ```

警告：如果沒有做第 5 步，系統把所有使用者當成同一個 IP。一個人登入失敗 5 次，所有人都不能登入。

### 對外開放時

做以下其中一項，防止他人使用你的 API 額度：

- 設定 `ALLOW_REGISTRATION=false`，由管理者建立帳號。
- 在反向代理加上登入驗證，例如 SSO。

另外，只允許內網連到 `/admin` 與 `/api/admin/`。

### 資料存放

- 系統把帳號、歷史記錄、用量紀錄與意見回饋存在一個 SQLite 檔案。
- 預設位置是 `data/rslide.db`。
- 備份時，複製整個 `data/` 資料夾。
- 把資料庫放在本機磁碟。不要放在網路磁碟。

### 網路連線

R Slide 需要以下連線：

| 項目 | 連線對象 |
|------|----------|
| AI 呼叫 | 伺服器連到 Gemini、OpenAI 或 Databricks。匯入 PowerPoint 時，投影片中的圖片也傳送到 AI 平台。 |
| 介面 | 瀏覽器連到 Tailwind 與 Font Awesome 的 CDN。 |
| 匯出 PDF 與 PPTX | 瀏覽器從 cdnjs 下載匯出工具。 |

系統不保存上傳的檔案與匯出的簡報。
如果要完全在內網使用，你要改接內部的 AI 端點，並自己提供前端資源。

## 開發

專案結構、測試方法與開發規則在 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
