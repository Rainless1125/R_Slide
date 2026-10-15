/* 快速插入圖示：內建 150 個 Font Awesome 6 Free（solid）辦公室簡報常用圖示
 * 依用途分組；每個圖示附中英文關鍵字，搜尋時比對圖示名稱、關鍵字與分組名稱。
 * 名稱須存在於 index.html 載入的 Font Awesome 6.5.1 free（tests/test_icons.py 會檢查數量與重複）。 */
const RS_ICON_GROUPS = [
    {
        name: '商務策略', en: 'business strategy', icons: [
            ['briefcase', 'work job business 公事包 工作 商務'],
            ['building', 'company office 公司 辦公室 大樓 企業'],
            ['industry', 'factory manufacturing 工廠 產業 製造'],
            ['handshake', 'deal partner agreement cooperation meeting 握手 合作 夥伴 簽約 會議'],
            ['sitemap', 'organization hierarchy structure 組織 架構 階層'],
            ['bullseye', 'target goal aim objective 目標 靶心 精準'],
            ['chess-knight', 'strategy tactic 策略 戰略 棋'],
            ['lightbulb', 'idea innovation insight 點子 創意 靈感 想法'],
            ['rocket', 'launch startup growth 火箭 發射 啟動 新創 成長'],
            ['flag', 'milestone mark 旗子 里程碑 標記'],
            ['flag-checkered', 'finish goal complete 終點 完成 達標'],
            ['trophy', 'win award champion 獎盃 冠軍 獲勝 成就'],
            ['award', 'prize badge certificate 獎章 獎項 認證'],
        ]
    },
    {
        name: '財務金錢', en: 'finance money', icons: [
            ['dollar-sign', 'money cash usd price 錢 美元 金額 價格'],
            ['coins', 'money cash change 硬幣 零錢 金錢'],
            ['money-bill', 'cash bill money 鈔票 現金 紙鈔'],
            ['money-bill-wave', 'cash payment money 現金 付款 鈔票'],
            ['money-bill-trend-up', 'cash profit growth revenue 獲利 營收 成長 現金'],
            ['sack-dollar', 'cash money bag fund 錢袋 資金 現金'],
            ['wallet', 'cash money purse 錢包 皮夾 現金'],
            ['credit-card', 'payment card 信用卡 付款 刷卡'],
            ['piggy-bank', 'saving cash deposit 存錢 儲蓄 撲滿 現金'],
            ['cash-register', 'cash pos checkout sales 收銀機 結帳 銷售 現金'],
            ['hand-holding-dollar', 'cash investment donation pay 投資 捐款 給付 現金'],
            ['file-invoice-dollar', 'invoice bill accounting 發票 帳單 請款 會計'],
            ['landmark', 'bank government finance 銀行 政府 機構'],
        ]
    },
    {
        name: '數據分析', en: 'data analytics', icons: [
            ['chart-line', 'graph trend analytics 折線圖 趨勢 分析'],
            ['chart-column', 'graph bar statistics 直條圖 長條圖 統計'],
            ['chart-bar', 'graph horizontal statistics 橫條圖 統計'],
            ['chart-pie', 'graph share proportion 圓餅圖 占比 比例'],
            ['arrow-trend-up', 'growth increase rise 上升 成長 增加'],
            ['arrow-trend-down', 'decline decrease drop 下降 衰退 減少'],
            ['ranking-star', 'rank leaderboard top 排名 排行 名次'],
            ['gauge-high', 'performance speed kpi dashboard 儀表 效能 績效 指標'],
            ['percent', 'percentage rate ratio 百分比 比率'],
            ['calculator', 'math calculate budget 計算機 計算 預算'],
            ['table', 'spreadsheet grid data 表格 試算表 資料'],
            ['database', 'data storage 資料庫 數據 儲存'],
            ['magnifying-glass-chart', 'analysis research insight 分析 研究 洞察'],
        ]
    },
    {
        name: '人員團隊', en: 'people team', icons: [
            ['user', 'person member account 使用者 人員 個人'],
            ['users', 'people team group 使用者 團隊 群組'],
            ['user-group', 'team pair people 團隊 小組'],
            ['people-group', 'team community staff meeting 團體 社群 員工 會議'],
            ['user-tie', 'manager boss executive business 主管 經理 老闆 商務人士'],
            ['user-plus', 'add member hire recruit 新增成員 招募 徵才'],
            ['user-check', 'approved verified member 已核准 已驗證'],
            ['user-shield', 'security admin protect 安全 權限'],
            ['user-graduate', 'student alumni 學生 畢業 校友'],
            ['person-chalkboard', 'teacher presentation lecture meeting 講師 簡報 教學 授課 會議'],
            ['id-badge', 'employee badge identity 識別證 員工證'],
            ['id-card', 'identity card 身分證 證件'],
            ['address-card', 'contact business card 名片 聯絡人'],
        ]
    },
    {
        name: '溝通協作', en: 'communication', icons: [
            ['envelope', 'email mail message 信件 郵件 電子郵件'],
            ['envelope-open-text', 'email newsletter read 已讀 電子報 郵件'],
            ['paper-plane', 'send submit 傳送 寄出 送出'],
            ['phone', 'call telephone contact 電話 撥打 聯絡'],
            ['mobile-screen', 'mobile phone smartphone app 手機 行動裝置'],
            ['comment', 'chat message talk 留言 訊息 對話'],
            ['comments', 'chat discussion conversation meeting 討論 對話 交流 會議'],
            ['comment-dots', 'chat typing feedback 回饋 訊息'],
            ['bullhorn', 'announcement marketing megaphone 公告 宣傳 行銷 廣播'],
            ['bell', 'notification alert reminder 通知 提醒 鈴'],
            ['video', 'meeting camera conference 視訊 會議 影片'],
            ['microphone', 'speech voice podcast 麥克風 演講 語音'],
            ['headset', 'support customer service 客服 支援 耳機'],
        ]
    },
    {
        name: '文件資料', en: 'documents files', icons: [
            ['file', 'document page 檔案 文件'],
            ['file-lines', 'document text report 文件 報告 文字'],
            ['file-pdf', 'pdf document 檔案'],
            ['file-word', 'word doc document 文件'],
            ['file-excel', 'excel spreadsheet xls 試算表'],
            ['file-powerpoint', 'powerpoint ppt slide presentation 簡報'],
            ['file-contract', 'contract agreement sign 合約 契約 簽署'],
            ['folder', 'directory files 資料夾'],
            ['folder-open', 'directory open files 開啟資料夾'],
            ['clipboard-list', 'checklist list task 清單 待辦 檢核表'],
            ['clipboard-check', 'done approved checklist 已完成 核對 檢查'],
            ['book', 'manual guide reading 書 手冊 指南'],
            ['newspaper', 'news press article 新聞 報紙 文章'],
        ]
    },
    {
        name: '時間排程', en: 'time schedule', icons: [
            ['calendar', 'date schedule 日曆 日期 行事曆'],
            ['calendar-days', 'date schedule month 月曆 日程 排程'],
            ['calendar-check', 'appointment booked deadline meeting 預約 截止 已排定 會議'],
            ['clock', 'time hour 時鐘 時間'],
            ['hourglass-half', 'waiting time pending 沙漏 等待 進行中'],
            ['stopwatch', 'timer speed deadline 碼表 計時 效率'],
            ['business-time', 'working hours schedule 上班時間 工時'],
            ['timeline', 'roadmap history schedule 時間軸 里程 路線圖'],
            ['list-check', 'todo task checklist 待辦清單 任務 進度'],
            ['bars-progress', 'progress status gantt 進度 甘特圖 狀態'],
        ]
    },
    {
        name: '科技資訊', en: 'technology it', icons: [
            ['laptop', 'computer notebook 筆電 電腦'],
            ['desktop', 'computer monitor screen 桌機 螢幕 電腦'],
            ['server', 'hosting data center 伺服器 機房'],
            ['cloud', 'cloud computing saas 雲端'],
            ['cloud-arrow-up', 'upload backup 上傳 備份 雲端'],
            ['wifi', 'wireless internet network 無線 網路'],
            ['globe', 'world global international web 全球 國際 網站 世界'],
            ['code', 'programming developer software 程式 開發 軟體'],
            ['microchip', 'chip semiconductor hardware 晶片 半導體 硬體'],
            ['robot', 'ai bot automation 機器人 人工智慧 自動化'],
            ['network-wired', 'network infrastructure 網路 架構 連線'],
            ['shield-halved', 'security protection safe 資安 防護 安全'],
            ['lock', 'secure private password 鎖 加密 安全 隱私'],
            ['key', 'password access 鑰匙 密碼 權限'],
        ]
    },
    {
        name: '流程狀態', en: 'process status', icons: [
            ['gear', 'settings configuration 設定 齒輪'],
            ['gears', 'process operation system 流程 運作 系統'],
            ['diagram-project', 'workflow process flowchart 流程圖 專案'],
            ['puzzle-piece', 'solution integration part 拼圖 整合 解決方案'],
            ['filter', 'funnel sort 篩選 漏斗'],
            ['screwdriver-wrench', 'tools maintenance fix 工具 維修 維護'],
            ['arrows-rotate', 'refresh sync update cycle 更新 同步 循環'],
            ['recycle', 'recycle sustainability cycle 回收 循環 永續'],
            ['circle-check', 'success done ok yes 完成 成功 正確 通過'],
            ['circle-xmark', 'fail error no cancel 失敗 錯誤 取消'],
            ['circle-exclamation', 'warning important alert 注意 重要 警告'],
            ['triangle-exclamation', 'warning risk caution danger 警告 風險 危險'],
            ['circle-info', 'information note about 資訊 說明'],
            ['circle-question', 'help faq question 問題 說明 常見問題'],
        ]
    },
    {
        name: '箭頭方向', en: 'arrows direction', icons: [
            ['arrow-right', 'next forward 右 下一步 前進'],
            ['arrow-left', 'back previous 左 返回 上一步'],
            ['arrow-up', 'up increase 上 增加'],
            ['arrow-down', 'down decrease 下 減少'],
            ['arrow-right-arrow-left', 'exchange swap transfer 交換 轉換'],
            ['arrows-up-down-left-right', 'move expand all directions 移動 四方'],
            ['arrows-to-circle', 'focus converge center 聚焦 集中'],
            ['arrows-split-up-and-left', 'split branch decision 分流 分支 決策'],
            ['angles-right', 'fast forward next 快轉 推進'],
            ['share-nodes', 'share network connect 分享 連結 節點'],
        ]
    },
    {
        name: '地點物流', en: 'location logistics', icons: [
            ['location-dot', 'map pin place address 地點 位置 地址'],
            ['map-location-dot', 'map location 地圖 據點'],
            ['earth-asia', 'world asia global 亞洲 地球 全球'],
            ['house', 'home 首頁 家 房子'],
            ['store', 'shop retail 商店 門市 零售'],
            ['warehouse', 'storage inventory 倉庫 庫存 倉儲'],
            ['truck', 'delivery shipping logistics 貨車 運送 物流 出貨'],
            ['box', 'package product 箱子 包裹 產品'],
            ['plane', 'flight travel trip 飛機 出差 旅行 航空'],
            ['car', 'vehicle transport 汽車 交通'],
        ]
    },
    {
        name: '常用符號', en: 'common symbols', icons: [
            ['star', 'favorite rating 星星 評分 收藏 重點'],
            ['heart', 'like love care 愛心 喜歡 關懷'],
            ['thumbs-up', 'like approve good 讚 同意 好評'],
            ['thumbs-down', 'dislike disapprove bad 倒讚 不同意 負評'],
            ['face-smile', 'happy satisfaction 微笑 滿意 開心'],
            ['fire', 'hot trending popular 熱門 火'],
            ['bolt', 'fast energy power 閃電 快速 能源 電力'],
            ['leaf', 'eco green sustainability esg 環保 綠色 永續'],
            ['gift', 'present reward bonus 禮物 獎勵 福利'],
            ['tag', 'label price 標籤 價格'],
            ['cart-shopping', 'shopping cart ecommerce buy 購物車 電商 購買'],
            ['magnifying-glass', 'search find 搜尋 查詢 放大鏡'],
            ['eye', 'view vision visibility 觀看 願景 檢視'],
            ['crown', 'premium vip king leader 皇冠 頂級 領導'],
        ]
    },
];
