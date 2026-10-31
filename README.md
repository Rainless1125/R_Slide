# R Slide

R Slide 用 AI 把文字素材做成簡報。
你可以編輯簡報，再匯出為 PDF、PowerPoint 或 HTML。
你可以把 R Slide 安裝在自己的伺服器或公司內網。

![R Slide 介紹影片](docs/demo.gif)

高畫質影片：[docs/r_slide_showreel.mp4](docs/r_slide_showreel.mp4)

## 功能

- **AI 生成簡報**：貼上文字或匯入檔案，AI 自動規劃配色並選擇版型（14 種，例如封面、KPI 大數字、時間軸、比較表格）。可以先確認大綱再生成；頁數可指定 2~12 頁、1 頁式簡報報告（整份素材濃縮成一頁摘要），或交給 AI 決定。
- **兩種簡報模式**：簡易模式給上台報告用，每頁一個重點，細節寫在講者備註；詳細模式給會後閱讀用，標題是結論句，內文有完整說明。
- **思考長度**：模型選單旁可選「中等」或「更高」。更高時 AI 想得更久，版面與內容較好，但需要較長時間。
- **圖表**：AI 把數據做成直條、橫條、折線、圓餅或環圈圖，可加上目標線、凸顯重點項目。
- **匯入檔案**：PDF（含掃描檔）、Word（.docx）、PowerPoint（.pptx）、Markdown 與 TXT。PowerPoint 中的圖片與 PDF 的掃描頁由 AI 辨識，結果標示「AI 辨識」，生成前請核對數字。
- **編輯**：直接修改文字、拖曳移動與縮放，插入文字方塊、圖片、圖表、圖示與圖案，按 `Ctrl` + `Z` 撤銷。所有元素（含 AI 產生的元素）都可以設定陰影；AI 產生的元素也可以自由調整寬高與加上外框。
- **重產單頁**：AI 重新做出一頁，可以加上需求（例如「改成時間軸」）。每頁保留最近 3 個舊版本。
- **講者工具**：AI 為每頁寫講稿。按 `N` 顯示講者備註，按 `P` 開啟講者檢視（目前頁、下一頁、備註與計時器）。
- **匯出**：PDF、PowerPoint（PPTX）與 HTML。
- **帳號與後台**：可用內建帳號或公司 LDAP 帳號登入。每個帳號的簡報存在伺服器。管理者在 `/admin` 管理帳號、查看用量與意見回饋。

操作細節請按畫面右上角的「?」查看使用教學。

## 限制

- PDF 與 PPTX 的每一頁是圖片。匯出後，你不能編輯文字。
- AI 產生的元素放大後，可能蓋住旁邊的元素。旁邊的元素不會自動讓開。
- 重產一頁後，該頁的移動與縮放會消失。
- 舊的 `.doc` 檔不能讀取。先把它另存為 `.docx`。
- 舊的 `.ppt` 檔不能讀取。先把它另存為 `.pptx`。
- PowerPoint 的 EMF、WMF 向量圖不能辨識。
- 辨識圖片與掃描頁的模型必須支援圖片輸入。公司內部端點的部分模型不支援。
- PDF 中有文字的頁面，系統不辨識頁面上的圖片。

## 安裝與啟動

### 需求

- Python 3.11 或更新版本。
- 一組 AI 平台設定：Gemini、OpenAI，或公司內部的 OpenAI 相容端點。

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
8. 註冊一個帳號。使用公司 LDAP 登入時，直接以公司帳號登入（見「[登入方式](#登入方式)」）。

### 用 Docker 啟動

如果你已安裝 Docker Desktop，可以不安裝 Python，改用 Docker 啟動。

1. 下載專案，並進入專案目錄。
2. 建立設定檔，並在 `.env` 填入 API Key：

   ```bash
   cp .env_example .env
   ```

   在 Windows 的 PowerShell 上，改用 `copy .env_example .env`。

3. 建立映像檔並啟動服務：

   ```bash
   docker compose up -d --build
   ```

4. 在瀏覽器開啟 <http://127.0.0.1:8000>。

常用指令：

```bash
docker compose logs -f        # 查看服務的輸出訊息，按 Ctrl + C 離開
docker compose down           # 停止服務
docker compose up -d --build  # 修改程式碼或 .env 後，重新建立並啟動
docker compose exec rslide python manage_users.py list   # 在容器中執行管理指令
```

注意：

- 帳號與歷史記錄存在 Docker volume `rslide-data`。停止或重建容器，資料不會消失。
- `docker compose down -v` 會一併刪除 volume。刪除後，資料無法復原。
- 服務啟動後立即結束時，用 `docker compose logs` 查看原因。最常見的原因是 `.env` 沒有填 API Key。

## 設定

所有設定都在專案根目錄的 `.env` 檔。
修改 `.env` 後，重新啟動服務。

### AI 平台

設定以下其中一個，或兩個都設定：

| 變數 | 說明 |
|------|------|
| `GEMINI_API_KEY` | Gemini 的 API Key。 |
| `OPENAI_API_KEY` | OpenAI 或公司內部 AI 端點的 API Key。 |

### 公司內部的 AI 端點

R Slide 可以連到 OpenAI 相容的端點，例如公司內部的 AI 閘道、Azure OpenAI、Databricks、vLLM 或 Ollama。

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `OPENAI_BASE_URL` | 端點網址，通常以 `/v1` 結尾。不填時連到 OpenAI。 | 無 |
| `OPENAI_MODELS` | 可用的模型名稱。用逗號分開。第一個是預設模型。 | `gpt-6-luna` |
| `OPENAI_DISPLAY_NAME` | 模型選單上顯示的平台名稱。 | 有設定 `OPENAI_BASE_URL` 時為「OpenAI 相容端點」，否則為「OpenAI」 |
| `OPENAI_API_KEY` | 端點的 API Key。端點不需要 Key 時，填任意文字。 | 無 |

範例：

```env
OPENAI_API_KEY=<token>
OPENAI_BASE_URL=https://ai-gateway.example.com/v1
OPENAI_MODELS=corp-llm-large,corp-llm-small
OPENAI_DISPLAY_NAME=公司 AI 閘道
```

連到 Databricks 的範例：

```env
OPENAI_API_KEY=<Databricks 權杖>
OPENAI_BASE_URL=https://<workspace>.cloud.databricks.com/serving-endpoints
OPENAI_MODELS=databricks-claude-sonnet-4-5,databricks-gpt-oss-120b
OPENAI_DISPLAY_NAME=Databricks
```

說明：

- 使用者只能選擇 `OPENAI_MODELS` 中的模型。
- 如果端點不支援結構化輸出，系統自動改用另一種方式。
- 匯入 PowerPoint 或掃描的 PDF 時，辨識圖片的模型必須支援圖片輸入。
- 使用 Databricks 時：
  - 模型名稱是 Databricks「Serving」頁面上的 endpoint 名稱。
  - 正式環境使用 service principal 的權杖。不要使用個人權杖。

### 呼叫 AI 時附加的標頭

有些公司的 AI 閘道要求每次呼叫附加識別資料，例如系統名稱與使用區域。在 `LLM_EXTRA_HEADERS` 設定這些 HTTP 標頭：

```env
LLM_EXTRA_HEADERS={"system_name": "R_Slide", "use_area": "F12"}
```

說明：

- 格式是 JSON 物件。標頭名稱與值依公司 AI 閘道的規定填寫。
- 值只能使用英數字與符號。HTTP 標頭不支援中文。
- 所有 AI 平台的每一次呼叫都附加這些標頭，包含生成、大綱、重產與圖片辨識。
- 格式錯誤時，服務不會啟動，並顯示錯誤原因。

### 登入方式

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `AUTH_MODE` | 登入方式。`system`：內建的註冊與帳號。`ldap`：公司 LDAP（含 Active Directory）帳號。 | `system` |

使用 `ldap` 時，再設定以下變數：

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `LDAP_SERVER` | LDAP 伺服器網址，例如 `ldaps://ldap.example.com:636` 或 `ldap://ldap.example.com:389`。 | 無（必填） |
| `LDAP_USER_DN_TEMPLATE` | 直接綁定：使用者 DN 的格式，`{username}` 換成登入帳號。AD 可用 `{username}@corp.example.com`，OpenLDAP 可用 `uid={username},ou=people,dc=example,dc=com`。 | 無 |
| `LDAP_SEARCH_BASE` | 先搜尋再綁定：搜尋使用者的起點，例如 `dc=example,dc=com`。沒有設定 `LDAP_USER_DN_TEMPLATE` 時使用。 | 無 |
| `LDAP_USER_FILTER` | 搜尋使用者的條件，`{username}` 換成登入帳號。可加上群組條件，只讓特定群組登入。 | `(sAMAccountName={username})` |
| `LDAP_BIND_DN` | 搜尋用的服務帳號 DN。不填時匿名搜尋。 | 無 |
| `LDAP_BIND_PASSWORD` | 服務帳號的密碼。 | 無 |
| `LDAP_START_TLS` | 用 `ldap://` 連線時，是否先升級為 TLS 加密。 | `false` |
| `LDAP_CA_CERT_FILE` | 公司自簽憑證的 CA 檔案路徑（PEM）。 | 無 |
| `LDAP_TIMEOUT` | 連線逾時秒數。 | `5` |

`LDAP_USER_DN_TEMPLATE` 與 `LDAP_SEARCH_BASE` 二選一。

範例一：Active Directory，直接綁定。

```env
AUTH_MODE=ldap
LDAP_SERVER=ldaps://ad.corp.example.com
LDAP_USER_DN_TEMPLATE={username}@corp.example.com
```

範例二：先用服務帳號搜尋，只允許 `R_Slide_Users` 群組登入。

```env
AUTH_MODE=ldap
LDAP_SERVER=ldaps://ad.corp.example.com
LDAP_SEARCH_BASE=dc=corp,dc=example,dc=com
LDAP_BIND_DN=cn=svc_rslide,ou=service,dc=corp,dc=example,dc=com
LDAP_BIND_PASSWORD=<服務帳號密碼>
LDAP_USER_FILTER=(&(sAMAccountName={username})(memberOf=cn=R_Slide_Users,ou=groups,dc=corp,dc=example,dc=com))
```

說明：

- 使用 `ldap` 時，不開放註冊。畫面顯示「以公司帳號登入」。
- 公司帳號第一次登入時，系統自動建立同名的帳號，用來保存歷史記錄與用量。帳號名稱不分大小寫。
- 已有同名的內建帳號時，公司帳號沿用該帳號與歷史記錄。
- 系統不保存公司帳號的密碼。公司帳號不能用 `system` 方式登入。
- 登入失敗鎖定的規則與內建帳號相同。LDAP 伺服器連不上時，畫面顯示錯誤，不算登入失敗。
- 設定不完整時，服務不會啟動，並顯示缺少的設定。
- 請使用 `ldaps://` 或 `LDAP_START_TLS=true`，避免密碼以明文在網路上傳送。

### 帳號與用量

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `RSLIDE_DB_PATH` | 資料庫檔案的位置。 | `data/rslide.db` |
| `ALLOW_REGISTRATION` | 是否允許使用者自己註冊。只在 `AUTH_MODE=system` 時有作用。 | `true` |
| `REGISTER_LIMIT_PER_IP_PER_DAY` | 一個 IP 在 24 小時內可以註冊的帳號數。`0` 表示沒有限制。 | `1` |
| `COOKIE_SECURE` | 使用 HTTPS 時，設為 `true`。 | `false` |
| `LLM_RATE_LIMIT_PER_HOUR` | 一個帳號每小時可以使用 AI 的次數。 | `20` |
| `LLM_RATE_LIMIT_PER_DAY` | 一個帳號每 24 小時可以使用 AI 的次數。 | `100` |
| `LLM_MAX_CONCURRENT` | 一個帳號同時可以進行的 AI 工作數。 | `2` |
| `LLM_USAGE_RETENTION_DAYS` | 用量紀錄的保留天數。`0` 表示永久保留。 | `365` |

說明：

- 生成、大綱與重產都算一次用量。失敗的工作也算。
- 匯入 PowerPoint 或掃描的 PDF 時，辨識整個檔案算一次用量。
- 一個帳號最多保留 200 筆歷史記錄。系統自動刪除最舊的記錄。
- 系統不保存素材與 AI 回覆的內容。系統只記錄字數與用量。

### 匯入 PowerPoint 與掃描的 PDF

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `EXTRACT_IMAGES` | 是否用 AI 辨識投影片中的圖片與 PDF 的掃描頁。設為 `false` 時，只匯入文字。 | `true` |
| `EXTRACT_IMAGE_MAX` | 一個檔案最多辨識幾張圖片。PDF 的一個掃描頁算一張。`0` 表示沒有限制。 | `0` |
| `EXTRACT_IMAGE_CONCURRENCY` | 同時辨識幾頁。 | `4` |

說明：

- 系統不辨識太小的圖片（例如圖示），也不辨識在 3 頁以上重複出現的圖片（例如 Logo）。
- PDF 與 PowerPoint 檔的上限是 30 MB。其他檔案的上限是 10 MB。

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
| LLM 用量 | 查看每個帳號的用量：生成、重產、大綱與匯入辨識的次數，以及 token 數。 |
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
- 後台登入與一般登入使用相同的鎖定。IP 被鎖定時，管理者也不能從該 IP 登入後台。
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
6. 如果使用 Nginx，加上這兩行：

   ```nginx
   client_max_body_size 40m;
   proxy_read_timeout 300s;
   ```

   說明：
   - `client_max_body_size`：允許上傳 30 MB 的 PDF 與 PowerPoint 檔。
   - `proxy_read_timeout`：生成頁數多的簡報，或匯入圖片多的檔案，可能需要 1 分鐘以上。Nginx 的預設值是 60 秒，超過時使用者看到錯誤，但 AI 用量已經計算。
   - 使用其他反向代理時，做相同的設定。

警告：如果沒有做第 5 步，系統把所有使用者當成同一個 IP。一個人登入失敗 5 次，所有人都不能登入。

如果 IP 被鎖定，管理者也不能登入後台。在伺服器上執行以下指令解除鎖定：

```bash
python manage_users.py lockouts       # 查看被鎖定的 IP
python manage_users.py unlock <IP>    # 解除鎖定
```

### 對外開放時

做以下其中一項，防止他人使用你的 API 額度：

- 設定 `ALLOW_REGISTRATION=false`，由管理者建立帳號。
- 設定 `AUTH_MODE=ldap`，只讓公司帳號登入。
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
| AI 呼叫 | 伺服器連到 Gemini、OpenAI，或 `OPENAI_BASE_URL` 設定的端點。匯入 PowerPoint 或掃描的 PDF 時，圖片與掃描頁也傳送到 AI 平台。 |
| 字型 | 瀏覽器連到 Google Fonts。連不到時，畫面改用系統字型，其他功能不受影響。 |

介面與匯出使用的元件（Tailwind、Font Awesome 與匯出工具）由 R Slide 的伺服器提供，不需要連外網。
匯出的 HTML 檔也內嵌這些元件，離線開啟也能正常顯示。

系統不保存上傳的檔案與匯出的簡報。
如果要完全在內網使用，設定 `OPENAI_BASE_URL` 連到內部的 AI 端點。請參考「公司內部的 AI 端點」。

## 開發

專案結構、測試方法與開發規則在 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 授權

R Slide 以 [MIT 授權](LICENSE)釋出。你可以免費使用、修改與散布，包含商業用途。散布時保留 `LICENSE` 中的版權聲明。

`static/vendor/` 中的前端元件有各自的授權，請參考 [static/vendor/README.md](static/vendor/README.md)。
