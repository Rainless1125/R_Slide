"""範例頁：附在提示詞中讓模型模仿版面結構與質感（模型模仿範例的效果遠好於只讀文字規則）。

範例使用虛構的通用內容與中性配色（灰階 + 一個強調色），提示詞會要求模型只學結構、層次與手法：
配色換成這份簡報的 theme、內容一律來自素材，不可照抄範例的文字或數字。
目前只用於密集資訊模式（deck_mode = "dense"）；圖表容器 data-rs-chart 的資料另外寫在 charts。
"""

# 一頁營運報告：不規則格線（bento grid）、區塊標題列、KPI 大數字、迷你圖表、狀態表格、頁尾結論列
DENSE_REPORT = """<div class="w-full h-full overflow-hidden flex flex-col gap-3 p-8 bg-slate-100">
  <div class="flex items-end justify-between gap-4">
    <div>
      <div class="text-xs font-semibold tracking-widest text-indigo-600">雲端客服平台 · 第三季營運報告</div>
      <h1 class="text-2xl font-bold text-slate-900 mt-1">營收創新高，客服回應時間縮短 32%</h1>
    </div>
    <span class="shrink-0 text-xs font-semibold text-indigo-700 bg-indigo-100 rounded-full px-3 py-1">第三季</span>
  </div>
  <div class="flex-1 min-h-0 grid grid-cols-4 grid-rows-[auto_1fr] gap-3">
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-sack-dollar text-[11px]"></i></span>季營收</div>
      <div class="mt-2 flex items-baseline gap-1"><span class="text-3xl font-extrabold text-slate-900">4,820</span><span class="text-sm text-slate-500">萬元</span></div>
      <div class="mt-1 text-xs font-semibold text-emerald-600"><i class="fa-solid fa-arrow-trend-up mr-1"></i>較上季 +18%</div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-stopwatch text-[11px]"></i></span>平均回應時間</div>
      <div class="mt-2 flex items-baseline gap-1"><span class="text-3xl font-extrabold text-slate-900">2.4</span><span class="text-sm text-slate-500">分鐘</span></div>
      <div class="mt-1 text-xs font-semibold text-emerald-600"><i class="fa-solid fa-arrow-trend-down mr-1"></i>較上季 −32%</div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-face-smile text-[11px]"></i></span>客戶滿意度</div>
      <div class="mt-2 flex items-baseline gap-1"><span class="text-3xl font-extrabold text-slate-900">4.6</span><span class="text-sm text-slate-500">/ 5 分</span></div>
      <div class="mt-1 text-xs font-semibold text-emerald-600"><i class="fa-solid fa-arrow-up mr-1"></i>較上季 +0.3 分</div>
    </div>
    <div class="rounded-2xl p-4 bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm">
      <div class="flex items-center gap-2 text-xs font-bold text-indigo-100"><i class="fa-solid fa-lightbulb"></i>本季重點</div>
      <p class="mt-2 text-sm leading-snug font-medium">智慧分流上線後，七成案件由系統直接派給專責人員，尖峰時段不再積壓。</p>
    </div>
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col min-h-0">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-chart-column text-indigo-600"></i>每月營收（萬元）</div>
      <div data-rs-chart="0" class="flex-1 min-h-0 mt-2"></div>
    </div>
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col min-h-0">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-list-check text-indigo-600"></i>重點專案進度</div>
      <table class="w-full text-xs mt-2">
        <thead class="text-slate-400"><tr><th class="text-left font-semibold pb-2">專案</th><th class="text-left font-semibold pb-2">負責單位</th><th class="text-right font-semibold pb-2">狀態</th></tr></thead>
        <tbody class="divide-y divide-slate-100 text-slate-700">
          <tr><td class="py-2 font-semibold">智慧分流上線</td><td>產品部</td><td class="text-right"><span class="rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700 font-semibold">完成</span></td></tr>
          <tr><td class="py-2 font-semibold">知識庫改版</td><td>客服部</td><td class="text-right"><span class="rounded-full px-2 py-0.5 bg-amber-100 text-amber-700 font-semibold">進行中</span></td></tr>
          <tr><td class="py-2 font-semibold">海外據點開設</td><td>業務部</td><td class="text-right"><span class="rounded-full px-2 py-0.5 bg-rose-100 text-rose-700 font-semibold">延遲</span></td></tr>
          <tr><td class="py-2 font-semibold">語音機器人</td><td>研發部</td><td class="text-right"><span class="rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 font-semibold">規劃中</span></td></tr>
        </tbody>
      </table>
    </div>
  </div>
  <div class="rounded-xl bg-indigo-600 text-white text-sm px-4 py-2.5 flex items-center gap-2"><i class="fa-solid fa-flag"></i><b>下一步</b><span>第四季擴大智慧分流至全部產品線，目標回應時間降到 2 分鐘內</span></div>
</div>"""

# 一頁專案摘要：區塊大小不同（橫跨欄 / 列）、問題與解法並列、大數字、編號策略、角色清單、頁尾結論列
DENSE_SUMMARY = """<div class="w-full h-full overflow-hidden flex flex-col gap-3 p-8 bg-slate-100">
  <div>
    <div class="text-xs font-semibold tracking-widest text-indigo-600">新產品上市計畫 · 一頁摘要</div>
    <h1 class="text-2xl font-bold text-slate-900 mt-1">鎖定中小企業，首年營收目標 3,200 萬元</h1>
  </div>
  <div class="flex-1 min-h-0 grid grid-cols-4 grid-rows-2 gap-3">
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm grid grid-cols-2 grid-rows-[1fr_auto] gap-x-4 gap-y-3">
      <div>
        <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><span class="w-7 h-7 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center"><i class="fa-solid fa-circle-exclamation text-xs"></i></span>問題</div>
        <p class="mt-2 text-xs text-slate-600 leading-relaxed">中小企業缺少專職人力，現有工具設定複雜，導入平均要三個月。</p>
      </div>
      <div class="border-l border-slate-100 pl-4">
        <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><span class="w-7 h-7 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center"><i class="fa-solid fa-circle-check text-xs"></i></span>解法</div>
        <p class="mt-2 text-xs text-slate-600 leading-relaxed">預設範本加上引導式設定，一天內完成導入，月費制免安裝。</p>
      </div>
      <div class="col-span-2 rounded-xl bg-slate-50 px-4 py-2 flex items-center justify-center gap-4">
        <span class="text-xs font-semibold text-slate-500">導入時間</span>
        <span class="text-xl font-extrabold text-slate-400 line-through decoration-2">90 天</span>
        <i class="fa-solid fa-arrow-right text-indigo-400"></i>
        <span class="text-2xl font-extrabold text-indigo-600">1 天</span>
      </div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-chart-pie text-indigo-600"></i>市場規模</div>
      <div class="mt-3 text-3xl font-extrabold text-indigo-600">120<span class="text-base font-bold ml-1">億元</span></div>
      <div class="mt-1 text-xs font-semibold text-emerald-600"><i class="fa-solid fa-arrow-up mr-1"></i>年成長 15%</div>
    </div>
    <div class="row-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-bullseye text-indigo-600"></i>首年目標</div>
      <div class="mt-3 flex-1 flex flex-col justify-around divide-y divide-slate-100">
        <div class="py-2"><div class="text-xs text-slate-500">營收</div><div class="text-2xl font-extrabold text-slate-900">3,200<span class="text-xs font-semibold text-slate-500 ml-1">萬元</span></div></div>
        <div class="py-2"><div class="text-xs text-slate-500">付費客戶</div><div class="text-2xl font-extrabold text-slate-900">1,500<span class="text-xs font-semibold text-slate-500 ml-1">家</span></div></div>
        <div class="py-2"><div class="text-xs text-slate-500">毛利率</div><div class="text-2xl font-extrabold text-slate-900">42<span class="text-xs font-semibold text-slate-500 ml-1">%</span></div></div>
      </div>
    </div>
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-route text-indigo-600"></i>上市策略</div>
      <div class="flex-1 flex items-center"><div class="w-full grid grid-cols-[1fr_auto_1fr_auto_1fr] items-start gap-2">
        <div><span class="inline-flex w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold items-center justify-center">1</span><div class="mt-1.5 text-sm font-bold text-slate-800">試用推廣</div><div class="text-xs text-slate-500 leading-snug">前三個月免費試用</div><span class="mt-2 inline-block text-[11px] font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">第 1~3 月</span></div>
        <i class="fa-solid fa-chevron-right text-slate-300 mt-1.5"></i>
        <div><span class="inline-flex w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold items-center justify-center">2</span><div class="mt-1.5 text-sm font-bold text-slate-800">通路合作</div><div class="text-xs text-slate-500 leading-snug">與會計事務所聯合推廣</div><span class="mt-2 inline-block text-[11px] font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">第 4~6 月</span></div>
        <i class="fa-solid fa-chevron-right text-slate-300 mt-1.5"></i>
        <div><span class="inline-flex w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold items-center justify-center">3</span><div class="mt-1.5 text-sm font-bold text-slate-800">加值服務</div><div class="text-xs text-slate-500 leading-snug">報表與串接模組加購</div><span class="mt-2 inline-block text-[11px] font-semibold text-indigo-700 bg-indigo-50 rounded-full px-2 py-0.5">第 7~12 月</span></div>
      </div></div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-users text-indigo-600"></i>專案團隊</div>
      <div class="mt-2 space-y-2">
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">產</span><span class="text-xs text-slate-700">產品規劃 · 3 人</span></div>
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">行</span><span class="text-xs text-slate-700">行銷推廣 · 2 人</span></div>
        <div class="flex items-center gap-2"><span class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center">業</span><span class="text-xs text-slate-700">通路業務 · 4 人</span></div>
      </div>
    </div>
  </div>
  <div class="rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm px-4 py-2.5 flex items-center gap-2"><i class="fa-solid fa-rocket"></i><b>結論</b><span>先以試用累積口碑，第二季起透過通路放量，年底達成損益兩平</span></div>
</div>"""

# 帶編號的決策流程：步驟編號圓章、膠囊形起點與終點、菱形判斷、分支標籤、補充說明便利貼
DENSE_FLOW = """<div class="w-full h-full overflow-hidden flex flex-col gap-3 p-8 bg-slate-100">
  <div>
    <div class="text-xs font-semibold tracking-widest text-indigo-600">客戶服務 · 處理流程</div>
    <h1 class="text-2xl font-bold text-slate-900 mt-1">退貨申請依金額分流，小額案件當天完成</h1>
  </div>
  <div class="flex-1 min-h-0 bg-white rounded-2xl p-5 shadow-sm flex items-center gap-3">
    <div class="flex flex-col items-center gap-1"><span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">1</span><div class="rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-base font-bold px-6 py-5 text-center">客戶提出申請</div></div>
    <i class="fa-solid fa-arrow-right text-indigo-400 text-lg"></i>
    <div class="flex flex-col items-center gap-1"><span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">2</span><div class="rounded-xl border border-slate-200 px-5 py-4"><div class="text-base font-bold text-slate-800">系統檢核</div><div class="text-sm text-slate-500 mt-1">訂單與保固期限</div></div></div>
    <i class="fa-solid fa-arrow-right text-indigo-400 text-lg"></i>
    <div class="flex flex-col items-center gap-1"><span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">3</span><div class="w-32 h-32 flex items-center justify-center"><div class="w-24 h-24 rotate-45 border-2 border-indigo-500 bg-indigo-50 flex items-center justify-center"><span class="-rotate-45 text-sm font-bold text-indigo-800 text-center leading-tight">金額<br>超過 5 千？</span></div></div></div>
    <div class="flex-1 flex flex-col gap-12">
      <div class="flex items-center gap-2"><span class="text-sm rounded-full bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5">否</span><i class="fa-solid fa-arrow-right text-indigo-400"></i><div class="flex flex-col items-center gap-1"><span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">4</span><div class="rounded-xl border border-slate-200 px-4 py-3"><div class="text-base font-bold text-slate-800">客服主管核准</div><div class="text-sm text-slate-500">當天回覆</div></div></div><i class="fa-solid fa-arrow-right text-indigo-400"></i><div class="rounded-full bg-emerald-500 text-white text-base font-bold px-5 py-3">退款完成</div></div>
      <div class="flex items-center gap-2"><span class="text-sm rounded-full bg-amber-100 text-amber-700 font-semibold px-2 py-0.5">是</span><i class="fa-solid fa-arrow-right text-indigo-400"></i><div class="flex flex-col items-center gap-1"><span class="w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center">5</span><div class="rounded-xl border border-slate-200 px-4 py-3"><div class="text-base font-bold text-slate-800">財務與品保審查</div><div class="text-sm text-slate-500">2~3 個工作天</div></div></div><i class="fa-solid fa-arrow-right text-indigo-400"></i><div class="rounded-full bg-amber-500 text-white text-base font-bold px-5 py-3">退款或換貨</div></div>
    </div>
  </div>
  <div class="grid grid-cols-3 gap-3">
    <div class="rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5 text-xs text-amber-900"><i class="fa-solid fa-note-sticky mr-1"></i><b>注意：</b>超過保固期的案件直接轉維修流程</div>
    <div class="rounded-xl bg-sky-50 border border-sky-200 px-4 py-2.5 text-xs text-sky-900"><i class="fa-solid fa-clock mr-1"></i><b>時效：</b>步驟 2 由系統自動完成，約 5 分鐘</div>
    <div class="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-xs text-emerald-900"><i class="fa-solid fa-chart-line mr-1"></i><b>成效：</b>八成案件走小額路線，當天結案</div>
  </div>
</div>"""

# 效益對比：上方一列 KPI 小卡（前 → 後、變化百分比標籤、迷你比較條，列高依內容），下方橫跨 2 欄的圖表與前後對照
DENSE_BENEFIT = """<div class="w-full h-full overflow-hidden flex flex-col gap-3 p-8 bg-slate-100">
  <div class="flex items-end justify-between gap-4">
    <div>
      <div class="text-xs font-semibold tracking-widest text-indigo-600">自動化包裝線 · 導入效益</div>
      <h1 class="text-2xl font-bold text-slate-900 mt-1">包裝時間縮短六成，每月加班減少 200 小時</h1>
    </div>
    <span class="shrink-0 text-xs font-semibold text-indigo-700 bg-indigo-100 rounded-full px-3 py-1">導入前後比較</span>
  </div>
  <div class="flex-1 min-h-0 grid grid-cols-4 grid-rows-[auto_1fr] gap-3">
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between"><div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-stopwatch text-[11px]"></i></span>每箱包裝時間</div><span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">−61%</span></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-base font-bold text-slate-400">90</span><i class="fa-solid fa-arrow-right text-xs text-slate-300"></i><span class="text-3xl font-extrabold text-indigo-600">35</span><span class="text-xs text-slate-500">秒</span></div>
      <div class="mt-2 space-y-1"><div class="h-1.5 rounded-full bg-slate-200"></div><div class="h-1.5 rounded-full bg-indigo-500 w-[39%]"></div></div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between"><div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-circle-xmark text-[11px]"></i></span>包裝錯誤率</div><span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">−78%</span></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-base font-bold text-slate-400">1.8</span><i class="fa-solid fa-arrow-right text-xs text-slate-300"></i><span class="text-3xl font-extrabold text-indigo-600">0.4</span><span class="text-xs text-slate-500">%</span></div>
      <div class="mt-2 space-y-1"><div class="h-1.5 rounded-full bg-slate-200"></div><div class="h-1.5 rounded-full bg-indigo-500 w-[22%]"></div></div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between"><div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-clock text-[11px]"></i></span>每月加班時數</div><span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">−63%</span></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-base font-bold text-slate-400">320</span><i class="fa-solid fa-arrow-right text-xs text-slate-300"></i><span class="text-3xl font-extrabold text-indigo-600">120</span><span class="text-xs text-slate-500">小時</span></div>
      <div class="mt-2 space-y-1"><div class="h-1.5 rounded-full bg-slate-200"></div><div class="h-1.5 rounded-full bg-indigo-500 w-[38%]"></div></div>
    </div>
    <div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between"><div class="flex items-center gap-2 text-xs font-bold text-slate-500"><span class="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center"><i class="fa-solid fa-people-group text-[11px]"></i></span>包裝線人力</div><span class="text-[11px] font-bold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5">−5 人</span></div>
      <div class="mt-2 flex items-baseline gap-2"><span class="text-base font-bold text-slate-400">12</span><i class="fa-solid fa-arrow-right text-xs text-slate-300"></i><span class="text-3xl font-extrabold text-indigo-600">7</span><span class="text-xs text-slate-500">人</span></div>
      <div class="mt-2 space-y-1"><div class="h-1.5 rounded-full bg-slate-200"></div><div class="h-1.5 rounded-full bg-indigo-500 w-[58%]"></div></div>
    </div>
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col min-h-0">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-chart-column text-indigo-600"></i>每月包裝量（千箱）</div>
      <div data-rs-chart="0" class="flex-1 min-h-0 mt-2"></div>
    </div>
    <div class="col-span-2 bg-white rounded-2xl p-4 shadow-sm flex flex-col">
      <div class="flex items-center gap-2 text-sm font-bold text-slate-800"><i class="fa-solid fa-right-left text-indigo-600"></i>作業方式的改變</div>
      <div class="flex-1 mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div class="rounded-xl bg-slate-50 p-4">
          <div class="text-xs font-bold text-slate-500">導入前</div>
          <ul class="mt-2 space-y-2 text-sm text-slate-600 list-disc pl-4"><li>人工摺箱、封箱與貼標</li><li>紙本記錄每班產量</li><li>旺季需臨時加派人力</li></ul>
        </div>
        <i class="fa-solid fa-arrow-right text-indigo-400 text-lg"></i>
        <div class="rounded-xl bg-indigo-50 border border-indigo-100 p-4">
          <div class="text-xs font-bold text-indigo-700">導入後</div>
          <ul class="mt-2 space-y-2 text-sm text-slate-700 list-disc pl-4"><li>機器自動成型與封箱</li><li>產量即時上傳看板</li><li>人力轉調品質檢驗</li></ul>
        </div>
      </div>
    </div>
  </div>
  <div class="rounded-xl bg-indigo-600 text-white text-sm px-4 py-2.5 flex items-center gap-2"><i class="fa-solid fa-bullseye"></i><b>效益焦點</b><span>同樣人力下產能提升，省下的工時轉投入品質檢驗</span></div>
</div>"""

DENSE_EXAMPLES = [("一頁營運報告", DENSE_REPORT), ("效益對比", DENSE_BENEFIT), ("一頁專案摘要", DENSE_SUMMARY),
                  ("帶編號的決策流程", DENSE_FLOW)]


def examples_block(examples: list[tuple[str, str]]) -> str:
    """把範例頁組成提示詞的一段；說明只學結構與手法，不可照抄配色、文字與數字。"""
    pages = "\n\n".join(f"    ▍範例：{name}\n{html}" for name, html in examples)
    return f"""
    【範例頁（只學版面結構、層次與設計手法）】：
    以下 HTML 示範這個模式該有的版面品質：區塊的大小變化、區塊標題列、數字與單位的比例、狀態標籤、留白與對齊，
    以及「一列 KPI 小卡 + 下方大區塊」的配置與前後對比的呈現方式（變化百分比標籤、迷你比較條）。
    1. 依素材內容選擇並組合這些手法，不要每一頁都套用同一個範例的格局。
    2. 範例的配色只是示意，一律換成這份簡報 theme 的顏色與卡片樣式（狀態色可保留綠 / 黃 / 紅的語意）。
    3. 範例中的主題、文字與數字都是虛構的，不可出現在簡報中；內容只能來自原始素材。
    4. 範例中的 data-rs-chart 是圖表容器，圖表資料另外寫在 charts。

{pages}
"""
