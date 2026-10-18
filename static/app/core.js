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

/* ===================== 歷史記錄（伺服器 SQLite，依帳號區分） ===================== */
// historyItems 只放摘要（id / title / createdAt / pages / input），投影片內容（data）開啟時才向伺服器讀取並快取
const MAX_HISTORY = 200;                 // 與 store.py 的 MAX_HISTORY_PER_USER 一致
const HISTORY_SAVE_DELAY = 800;          // 編輯時合併連續的修改，停手後才送出
let historyItems = [];
const pendingSaves = new Map();          // id -> { timer, patch }：尚未送出的修改
const saveChains = new Map();            // id -> Promise：同一筆紀錄的請求依序送出，避免舊資料覆蓋新資料
let inflightSaves = 0;

function historyError(err) {
    if (err?.status === 413) return '簡報內容過大（圖片太多），無法儲存到歷史記錄';
    return '歷史記錄同步失敗：' + friendlyError(err);
}

async function historyFetch(method, path = '', body, opts = {}) {
    const res = await fetch('/api/history' + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        ...opts
    });
    if (res.status === 401) { onSessionExpired(); throw Object.assign(new Error('請先登入'), { status: 401, handled: true }); }
    if (!res.ok) throw await readApiError(res);
    return res.json();
}

function enqueueHistoryRequest(id, method, path, body) {
    inflightSaves++;
    const run = () => historyFetch(method, path, body);
    const p = (saveChains.get(id) || Promise.resolve()).then(run, run);
    const tail = p.catch(() => { }).finally(() => {
        inflightSaves--;
        if (saveChains.get(id) === tail) saveChains.delete(id);
    });
    saveChains.set(id, tail);
    return p;
}

function queueHistorySave(id, patch) {
    const p = pendingSaves.get(id) || { patch: {} };
    clearTimeout(p.timer);
    Object.assign(p.patch, patch);
    p.timer = setTimeout(() => flushHistorySave(id), HISTORY_SAVE_DELAY);
    pendingSaves.set(id, p);
}
function flushHistorySave(id) {
    const p = pendingSaves.get(id);
    if (!p) return Promise.resolve();
    clearTimeout(p.timer);
    pendingSaves.delete(id);
    return enqueueHistoryRequest(id, 'PATCH', '/' + encodeURIComponent(id), p.patch)
        .catch(err => { if (!err.handled) showToast(historyError(err), 'error', 6000); });
}
function cancelHistorySave(id) {
    const p = pendingSaves.get(id);
    if (p) { clearTimeout(p.timer); pendingSaves.delete(id); }
}
async function flushAllHistorySaves() {
    await Promise.all([...pendingSaves.keys()].map(flushHistorySave));
    await Promise.all([...saveChains.values()]);
}
// 還有修改沒送完就關閉分頁時：先送出，並請瀏覽器跳出「確定離開？」以免資料遺失
window.addEventListener('beforeunload', e => {
    if (!pendingSaves.size && !inflightSaves) return;
    [...pendingSaves.keys()].forEach(flushHistorySave);
    e.preventDefault();
    e.returnValue = '';
});

async function loadHistory() {
    try {
        historyItems = await historyFetch('GET');
    } catch (err) {
        historyItems = [];
        if (!err.handled) showToast('無法讀取歷史記錄：' + friendlyError(err), 'error', 6000);
    }
    renderHistory(true);
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
        const pages = h.pages ?? h.data?.slides?.length ?? 0;
        return `
  <div data-id="${esc(h.id)}" data-act="open" class="hist-item group spot rounded-xl p-2.5 cursor-pointer transition-all duration-300 ${active
                ? 'hist-active bg-violet-50 dark:bg-violet-500/10 ring-1 ring-violet-300/70 dark:ring-violet-400/30'
                : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/70'}">
    <div class="relative flex items-center gap-3">
      ${styleThumbHtml(styleColors(h.input?.style_preference || ''))}
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold truncate ${active ? 'text-violet-700 dark:text-violet-200' : ''}" title="${esc(h.title)}">${esc(h.title)}</div>
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
        pages: data.slides?.length || 0,
        input,
        data
    };
    historyItems.unshift(entry);
    historyItems = historyItems.slice(0, MAX_HISTORY);
    currentHistoryId = entry.id;
    renderHistory(true);
    const { pages, ...body } = entry;
    enqueueHistoryRequest(entry.id, 'POST', '', body).catch(err => {
        cancelHistorySave(entry.id);
        historyItems = historyItems.filter(x => x !== entry);
        if (currentHistoryId === entry.id) currentHistoryId = null;
        renderHistory();
        if (!err.handled) showToast(historyError(err), 'error', 6000);
    });
}

function getCurrentGenerationInput() {
    const active = historyItems.find(x => x.id === currentHistoryId);
    if (active?.input?.content?.trim()) return { ...active.input };
    return {
        content: document.getElementById('inputContent').value.trim(),
        target_audience: document.getElementById('targetAudience').value,
        num_pages: parseInt(document.getElementById('numPages').value) || (currentPresentationData?.slides?.length || 3),
        style_preference: getStylePreference(),
        deck_mode: getDeckMode()
    };
}

function syncCurrentPresentationToHistory() {
    updatePresenter();
    if (!currentHistoryId || !currentPresentationData) return;
    const item = historyItems.find(x => x.id === currentHistoryId);
    if (!item) return;
    item.data = currentPresentationData;
    item.title = currentPresentationData.presentation_title || item.title;
    item.pages = currentPresentationData.slides?.length || 0;
    queueHistorySave(item.id, { title: item.title, data: item.data });
    renderHistory();
}

let openingHistoryId = null;
async function openHistory(id) {
    if (isGenerating()) { showToast('正在生成中，請稍候', 'info'); return; }
    const h = historyItems.find(x => x.id === id);
    if (!h || openingHistoryId) return;
    if (!h.data) {
        openingHistoryId = id;
        try {
            h.data = (await historyFetch('GET', '/' + encodeURIComponent(id))).data;
        } catch (err) {
            if (!err.handled) showToast('無法開啟此紀錄：' + friendlyError(err), 'error', 6000);
            return;
        } finally { openingHistoryId = null; }
        if (!historyItems.includes(h)) return;           // 讀取期間被刪除或已登出
    }
    if (!h.data || !Array.isArray(h.data.slides)) { showToast('此紀錄資料已損毀', 'error'); return; }
    stopAutoplay();
    currentHistoryId = id;
    currentPresentationData = sanitizePresentation(h.data);
    currentSlideIdx = 0;
    resetUndo();

    document.getElementById('inputContent').value = h.input?.content || '';
    document.getElementById('targetAudience').value = h.input?.target_audience || '';
    if (h.input?.num_pages != null) document.getElementById('numPages').value = String(h.input.num_pages);
    if (h.input?.style_preference) setStylePreference(h.input.style_preference);
    setDeckMode(h.input?.deck_mode);
    updateCount();

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
    queueHistorySave(id, { title: t });
    flushHistorySave(id);
    renderHistory();
}

function deleteHistory(id, el) {
    const finish = () => {
        historyItems = historyItems.filter(x => x.id !== id);
        cancelHistorySave(id);
        enqueueHistoryRequest(id, 'DELETE', '/' + encodeURIComponent(id))
            .catch(err => { if (!err.handled) { showToast(historyError(err), 'error', 6000); loadHistory(); } });
        if (id === currentHistoryId) { currentHistoryId = null; resetWorkspace(false); }
        renderHistory();
    };
    if (el) { el.classList.add('hist-out'); setTimeout(finish, 330); } else finish();
}

function clearHistory() {
    if (!historyItems.length) { showToast('目前沒有歷史記錄', 'info', 1800); return; }
    if (!confirm('確定要清除所有歷史記錄嗎？此動作無法復原。')) return;
    const ids = historyItems.map(h => h.id);
    ids.forEach(cancelHistorySave);
    historyItems = [];
    if (currentHistoryId) { currentHistoryId = null; }
    renderHistory();
    // 等這些紀錄尚未送完的請求結束後再清除，避免剛建立的紀錄在清除之後才寫入
    Promise.all(ids.map(id => saveChains.get(id)))
        .then(() => historyFetch('DELETE'))
        .then(() => showToast('已清除所有歷史記錄', 'success', 1800))
        .catch(err => { if (!err.handled) { showToast(historyError(err), 'error', 6000); loadHistory(); } });
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
