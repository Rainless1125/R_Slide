/* 主題、全域狀態、小工具、錯誤訊息、歷史記錄、側邊欄
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 主題 ===================== */
function initTheme() {
    if (localStorage.getItem('theme') === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}
function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    const btn = document.getElementById('themeBtn');
    btn.classList.remove('theme-pop');
    void btn.offsetWidth;
    btn.classList.add('theme-pop');
}
initTheme();

/* ===================== 狀態 ===================== */
let currentPresentationData = null;
let currentSlideIdx = 0;
let currentHistoryId = null;
let autoplayTimer = null;
let loadingTimer = null;
let regeneratingSlideIdx = null;
let regeneratingDeck = null;     // 正在重產的頁面所屬的簡報（重產期間可切換到其他簡報）
let regenerateModalSlideIdx = null;
let currentStep = 1;

/* ===================== 小工具 ===================== */
// AI 產生的 HTML 不可信（可能被素材中的提示注入影響）：進入應用前先清理，
// 移除 script / 事件屬性 / meta refresh / iframe / 非白名單的外部資源（與匯出共用 sanitizeSlideHtml）
function sanitizeSlide(slide) {
    if (slide && typeof slide.html_content === 'string') slide.html_content = sanitizeSlideHtml(slide.html_content);
    return slide;
}
function sanitizePresentation(data) {
    if (data && Array.isArray(data.slides)) data.slides.forEach(sanitizeSlide);
    return data;
}
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function animateIn(el, cls = 'reveal') {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
}
function showToast(msg, type = 'info', ms = 3200, action = null) {
    const root = document.getElementById('toastRoot');
    const icon = {
        info: 'fa-circle-info text-sky-400',
        error: 'fa-triangle-exclamation text-amber-400',
        success: 'fa-circle-check text-emerald-400'
    }[type] || 'fa-circle-info';
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(msg)}</span>`;
    const dismiss = () => { t.classList.add('out'); setTimeout(() => t.remove(), 320); };
    if (action) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toast-action';
        btn.textContent = action.label;
        btn.onclick = () => { dismiss(); action.onClick(); };
        t.appendChild(btn);
    }
    root.appendChild(t);
    setTimeout(dismiss, ms);
}

/* ===================== 錯誤訊息白話化 ===================== */
// 讀出後端回傳的錯誤字串（FastAPI 的 {"detail": "..."} 或純文字）
async function readApiError(res) {
    let raw = '';
    try { raw = await res.text(); } catch (_) { }
    try {
        const j = JSON.parse(raw);
        const d = j?.detail;
        raw = typeof d === 'string' ? d : (d ? JSON.stringify(d) : raw);
    } catch (_) { }
    const err = new Error(raw || ('HTTP ' + res.status));
    err.status = res.status;
    return err;
}

// 將常見的 LLM / 網路錯誤轉成使用者看得懂的說明
function friendlyError(err) {
    const raw = String(err?.message || err || '');
    const status = err?.status || 0;
    const has = re => re.test(raw);
    let msg;
    if (err?.name === 'TypeError' && has(/fetch|network/i)) msg = '無法連線到伺服器，請確認網路或服務是否仍在執行。';
    else if (status === 413) msg = '檔案過大，超過伺服器允許的上傳大小。';
    else if (has(/未設定\s*(GEMINI|OPENAI)_API_KEY/i)) msg = '尚未設定此平台的 API Key，請改選其他平台，或到 .env 補上金鑰。';
    else if (status === 401 || status === 403 || has(/api[_ ]?key.*(invalid|not valid|expired)|incorrect api key|unauthorized|permission[_ ]denied|UNAUTHENTICATED/i)) msg = 'API Key 無效或沒有權限，請檢查 .env 內的金鑰。';
    else if (status === 429 || has(/quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i)) msg = 'API 額度已用完或請求過於頻繁，請稍候再試，或換一個模型 / 平台。';
    else if (has(/timed? ?out|deadline|DEADLINE_EXCEEDED|504/i)) msg = 'AI 回應逾時，請稍後再試，或減少頁數與內容長度。';
    else if (status === 503 || has(/overloaded|unavailable|UNAVAILABLE|high demand/i)) msg = 'AI 服務目前忙碌中，請稍後再試，或換一個模型。';
    else if (has(/拒絕回應|safety|blocked|refus/i)) msg = '模型拒絕處理這段內容，請調整素材後再試。';
    else if (has(/MAX_TOKENS|長度上限/)) msg = 'AI 輸出太長被截斷，請減少頁數或精簡內容後再試。';
    else if (has(/沒有回傳內容/)) msg = 'AI 沒有回傳任何內容，請稍後再試，或換一個模型。';
    else if (has(/JSON|Unterminated|Expecting|validation|parse/i)) msg = 'AI 回傳的格式有誤，通常重試一次即可。';
    else if (has(/not.?found|404|model/i) && has(/model/i)) msg = '找不到所選模型，請改選其他模型。';
    else if (status >= 500 || !raw) msg = '伺服器發生錯誤，請稍後再試。';
    else msg = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
    if (raw) console.error('[R Slide]', raw);
    return msg;
}
function fmtTime(ts) {
    const d = new Date(ts), now = new Date();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return '今天 ' + hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
function isGenerating() { return document.getElementById('btnGenerate').disabled; }

/* ===================== 歷史記錄（localStorage） ===================== */
const HKEY = 'rslide_history_v1';
const MAX_HISTORY = 30;
let historyItems = loadHistory();

function loadHistory() {
    try {
        const list = JSON.parse(localStorage.getItem(HKEY));
        return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
}
function saveHistory() {
    historyItems = historyItems.slice(0, MAX_HISTORY);
    let trimmed = false;
    while (true) {
        try {
            localStorage.setItem(HKEY, JSON.stringify(historyItems));
            if (trimmed) showToast('儲存空間不足，已移除最舊的紀錄', 'info');
            return true;
        } catch (e) {
            if (historyItems.length <= 1) { showToast('瀏覽器儲存空間不足，無法儲存紀錄', 'error'); return false; }
            historyItems.pop();
            trimmed = true;
        }
    }
}

function renderHistory(animate = false) {
    const list = document.getElementById('historyList');
    const q = document.getElementById('historySearch').value.trim().toLowerCase();
    document.getElementById('historyCount').textContent = historyItems.length ? `(${historyItems.length})` : '';

    const items = historyItems.filter(h =>
        !q || (h.title || '').toLowerCase().includes(q) || (h.input?.content || '').toLowerCase().includes(q));

    list.classList.toggle('stagger', animate);

    if (!items.length) {
        list.innerHTML = `
  <div class="text-center text-zinc-400 text-xs py-12 px-4 reveal">
    <i class="fa-regular fa-folder-open text-3xl mb-3 block"></i>
    ${historyItems.length ? '找不到符合的紀錄' : '還沒有生成紀錄<br>生成的簡報會自動儲存在這裡'}
  </div>`;
        return;
    }

    list.innerHTML = items.map(h => {
        const active = h.id === currentHistoryId;
        const style = (h.input?.style_preference || '').split(' (')[0];
        const pages = h.data?.slides?.length || 0;
        return `
  <div data-id="${esc(h.id)}" data-act="open" class="hist-item group spot rounded-xl border p-3 cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${active
                ? 'border-black dark:border-white bg-zinc-50 dark:bg-zinc-800 shadow-sm'
                : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600'}">
    <div class="relative flex items-start gap-2.5">
      <div class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-xs ${active ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500'}">
        <i class="fa-solid fa-display"></i>
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold truncate" title="${esc(h.title)}">${esc(h.title)}</div>
        <div class="text-[11px] text-zinc-400 mt-0.5 truncate">${fmtTime(h.createdAt)} · ${pages} 頁${style ? ' · ' + esc(style) : ''}</div>
      </div>
      <div class="flex flex-col gap-1 lg:opacity-0 lg:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button data-act="rename" class="icon-btn w-6 h-6 rounded-md text-[11px] text-zinc-400 hover:text-blue-500 hover:bg-zinc-100 dark:hover:bg-zinc-700" title="重新命名" aria-label="重新命名"><i class="fa-solid fa-pen"></i></button>
        <button data-act="delete" class="icon-btn w-6 h-6 rounded-md text-[11px] text-zinc-400 hover:text-red-500 hover:bg-zinc-100 dark:hover:bg-zinc-700" title="刪除" aria-label="刪除"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>
  </div>`;
    }).join('');
}

function addHistory(input, data) {
    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: Date.now(),
        title: data.presentation_title || '未命名簡報',
        input,
        data
    };
    historyItems.unshift(entry);
    currentHistoryId = entry.id;
    saveHistory();
    if (!historyItems.some(h => h.id === currentHistoryId)) currentHistoryId = null;
    renderHistory(true);
}

function getCurrentGenerationInput() {
    const active = historyItems.find(x => x.id === currentHistoryId);
    if (active?.input?.content?.trim()) return { ...active.input };
    return {
        content: document.getElementById('inputContent').value.trim(),
        target_audience: document.getElementById('targetAudience').value,
        num_pages: parseInt(document.getElementById('numPages').value) || (currentPresentationData?.slides?.length || 3),
        style_preference: document.getElementById('stylePreference').value
    };
}

function syncCurrentPresentationToHistory() {
    updatePresenter();
    if (!currentHistoryId || !currentPresentationData) return;
    const item = historyItems.find(x => x.id === currentHistoryId);
    if (!item) return;
    item.data = currentPresentationData;
    item.title = currentPresentationData.presentation_title || item.title;
    saveHistory();
    renderHistory();
}

function openHistory(id) {
    if (isGenerating()) { showToast('正在生成中，請稍候', 'info'); return; }
    const h = historyItems.find(x => x.id === id);
    if (!h || !h.data || !Array.isArray(h.data.slides)) { showToast('此紀錄資料已損毀', 'error'); return; }
    stopAutoplay();
    currentHistoryId = id;
    currentPresentationData = sanitizePresentation(h.data);
    currentSlideIdx = 0;
    resetUndo();

    document.getElementById('inputContent').value = h.input?.content || '';
    document.getElementById('targetAudience').value = h.input?.target_audience || '';
    if (h.input?.num_pages != null) document.getElementById('numPages').value = String(h.input.num_pages);
    if (h.input?.style_preference) document.getElementById('stylePreference').value = h.input.style_preference;
    updateCount();
    syncStyleCards();

    renderHistory();
    confirmAndPlay();
    if (window.innerWidth < 1024) setSidebar(false);
    showToast('已切換至「' + h.title + '」', 'success', 1800);
}

function renameHistory(id) {
    const h = historyItems.find(x => x.id === id);
    if (!h) return;
    const name = prompt('重新命名', h.title);
    if (name === null) return;
    const t = name.trim();
    if (!t) return;
    h.title = t;
    saveHistory();
    renderHistory();
}

function deleteHistory(id, el) {
    const finish = () => {
        historyItems = historyItems.filter(x => x.id !== id);
        saveHistory();
        if (id === currentHistoryId) { currentHistoryId = null; resetWorkspace(false); }
        renderHistory();
    };
    if (el) { el.classList.add('hist-out'); setTimeout(finish, 330); } else finish();
}

function clearHistory() {
    if (!historyItems.length) { showToast('目前沒有歷史記錄', 'info', 1800); return; }
    if (!confirm('確定要清除所有歷史記錄嗎？此動作無法復原。')) return;
    historyItems = [];
    saveHistory();
    if (currentHistoryId) { currentHistoryId = null; }
    renderHistory();
    showToast('已清除所有歷史記錄', 'success', 1800);
}

document.getElementById('historyList').addEventListener('click', e => {
    const item = e.target.closest('.hist-item');
    if (!item) return;
    const id = item.dataset.id;
    const actEl = e.target.closest('[data-act]');
    const act = actEl ? actEl.dataset.act : 'open';
    if (act === 'rename') { e.stopPropagation(); renameHistory(id); }
    else if (act === 'delete') { e.stopPropagation(); deleteHistory(id, item); }
    else openHistory(id);
});
document.getElementById('historySearch').addEventListener('input', () => renderHistory());

/* ----- 新增簡報 / 重置 ----- */
function resetWorkspace(clearFields = true) {
    stopAutoplay();
    if (document.fullscreenElement) document.exitFullscreen();
    currentPresentationData = null;
    currentSlideIdx = 0;
    resetUndo();
    document.getElementById('sectionReview').classList.add('hidden');
    document.getElementById('sectionPlayer').classList.add('hidden');
    if (clearFields) clearInput();
    setStep(1);
}
function newPresentation() {
    if (isGenerating()) { showToast('正在生成中，請稍候', 'info'); return; }
    currentHistoryId = null;
    resetWorkspace(true);
    renderHistory();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const sec = document.getElementById('sectionInput');
    animateIn(sec);
    document.getElementById('inputContent').focus({ preventScroll: true });
    if (window.innerWidth < 1024) setSidebar(false);
}

/* ----- 側邊欄開關 ----- */
function setSidebar(open) {
    document.body.classList.toggle('sb-open', open);
    document.getElementById('sbIcon').className = open && window.innerWidth < 1024 ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    if (window.innerWidth >= 1024) {
        try { localStorage.setItem('rslide_sb', open ? '1' : '0'); } catch (e) { }
    }
}
function toggleSidebar() { setSidebar(!document.body.classList.contains('sb-open')); }
(function initSidebar() {
    let saved = null;
    try { saved = localStorage.getItem('rslide_sb'); } catch (e) { }
    setSidebar(window.innerWidth >= 1024 ? saved !== '0' : false);
})();
