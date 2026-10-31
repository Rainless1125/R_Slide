/* 步驟條、模型選單、生成、檢閱頁、單頁重新生成
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 步驟條 ===================== */
function setStep(n) {
    currentStep = n;
    if (n !== 3) toggleEditMode(false);
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById('stepTag' + i);
        const active = i === n;
        const done = i < n;
        el.className = 'transition-all duration-300 ' + (active
            ? 'text-violet-600 dark:text-violet-300 scale-110'
            : done ? 'text-zinc-600 dark:text-zinc-300 hover:text-black dark:hover:text-white' : 'text-zinc-400 dark:text-zinc-600');
    }
    document.getElementById('stepLine1').style.width = n >= 2 ? '100%' : '0%';
    document.getElementById('stepLine2').style.width = n >= 3 ? '100%' : '0%';
}
function goStep(n) {
    if (n === 1) {
        stopAutoplay();
        document.getElementById('sectionPlayer').classList.add('hidden');
        document.getElementById('sectionReview').classList.toggle('hidden', !currentPresentationData);
        setStep(1);
        document.getElementById('sectionInput').scrollIntoView({ behavior: 'smooth' });
        return;
    }
    if (!currentPresentationData) { showToast('請先生成簡報內容', 'info'); return; }
    if (n === 2) backToReview(); else confirmAndPlay();
}

/* ===================== 生成 ===================== */
// 骨架屏：卡片結構與「版面審查」一致（縮圖 + 標題 + 版型 + 兩顆按鈕 + 操作列）；產生大綱時改為大綱列表的樣子
function buildSkeletonCards(kind = 'deck', pages) {
    const n = pages || parseInt(document.getElementById('numPages').value) || 6; // 0 = 由 AI 決定
    if (kind === 'outline') {
        const row = `
  <div class="sm:col-span-2 xl:col-span-3 p-4 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-xl flex gap-4">
    <div class="skeleton h-8 w-8 rounded-lg shrink-0"></div>
    <div class="flex-1 space-y-2"><div class="skeleton h-5 w-1/2"></div><div class="skeleton h-3 w-5/6"></div><div class="skeleton h-3 w-2/3"></div></div>
  </div>`;
        document.getElementById('skeletonGrid').innerHTML = row.repeat(Math.min(Math.max(n, 1), 5));
        return;
    }
    const card = `
  <div class="p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-xl flex flex-col gap-3">
    <div class="skeleton w-full rounded-xl" style="aspect-ratio:16/9"></div>
    <div class="px-1">
      <div class="flex items-center gap-2 mb-2"><div class="skeleton h-5 w-8"></div><div class="skeleton h-4 flex-1"></div></div>
      <div class="skeleton h-3 w-3/4"></div>
    </div>
    <div class="flex items-center gap-2 px-1"><div class="skeleton h-8 flex-1 rounded-full"></div><div class="skeleton h-8 flex-1 rounded-full"></div></div>
    <div class="flex items-center justify-between px-1 pb-1"><div class="skeleton h-6 w-6 rounded-full"></div><div class="skeleton h-6 w-6 rounded-full"></div><div class="skeleton h-6 w-14 rounded-full"></div><div class="skeleton h-6 w-14 rounded-full"></div></div>
  </div>`;
    document.getElementById('skeletonGrid').innerHTML = card.repeat(Math.min(Math.max(n, 1), 6));
}
// 生成中顯示的階段依經過秒數往下走、停在最後一個（不循環，避免看起來像重新開始）；只是大略的示意，不是實際進度
const LOADING_PHASES = [[0, '分析內容中…'], [3, '正在規劃版面…'], [8, '設計配色與排版…'], [15, '生成每頁版面…']];
const OUTLINE_LOADING_PHASES = [[0, '分析內容中…'], [3, '規劃故事線…'], [8, '整理每頁重點…']];
// 等待較久時的補充說明
const LOADING_SLOW_HINTS = [[40, '頁數較多、詳細模式、思考長度「更高」或較慢的模型需要較長時間，請稍候'], [120, '等待時間比平常久，仍在等候 AI 回應']];
const pickByElapsed = (list, sec) => list.reduce((cur, [t, text]) => sec >= t ? text : cur, '');

// kind：'deck' 生成整份簡報，'outline' 產生大綱；pages 為骨架屏的頁數（依大綱生成時以大綱頁數為準）
function setLoading(on, kind = 'deck', pages) {
    const btn = document.getElementById('btnGenerate');
    const wand = document.getElementById('loadingWand');
    const icon = document.getElementById('btnIcon');
    const label = document.getElementById('btnLabel');
    const skel = document.getElementById('sectionSkeleton');
    btn.disabled = on;
    setOutlineBusy(on);
    wand.classList.toggle('hidden', !on);
    icon.classList.toggle('hidden', on);
    clearInterval(loadingTimer);
    if (on) {
        const phases = kind === 'outline' ? OUTLINE_LOADING_PHASES : LOADING_PHASES;
        const verb = kind === 'outline' ? '產生大綱中' : '生成中';
        const phaseEl = document.getElementById('loadingPhase');
        const elapsedEl = document.getElementById('loadingElapsed');
        const hintEl = document.getElementById('loadingHint');
        const start = Date.now();
        const tick = () => {
            const sec = Math.floor((Date.now() - start) / 1000);
            const phase = pickByElapsed(phases, sec);
            if (phaseEl.textContent !== phase) phaseEl.textContent = phase;   // 只在換階段時更新，螢幕閱讀器不會每秒朗讀
            elapsedEl.textContent = `已等待 ${sec} 秒`;
            const hint = pickByElapsed(LOADING_SLOW_HINTS, sec);
            hintEl.textContent = hint ? '・' + hint : '';
            label.textContent = `${verb} ${sec} 秒`;
        };
        tick();
        loadingTimer = setInterval(tick, 1000);
        document.getElementById('sectionReview').classList.add('hidden');
        document.getElementById('sectionPlayer').classList.add('hidden');
        document.getElementById('sectionOutline').classList.add('hidden');
        buildSkeletonCards(kind, pages);
        skel.classList.remove('hidden');
        animateIn(skel);
        skel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        updateGenerateLabel();
        skel.classList.add('hidden');
    }
}

// /api/models 失敗時的備用清單，需與 app.py 的 MODEL_CATALOG 一致（tests/test_model_catalog.py 會檢查）
let modelCatalog = {
    gemini: { models: ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'] },
    openai: { models: ['gpt-6-luna'] }   // 後端設定 OPENAI_MODELS 時以 /api/models 的清單為準
};

function populateModels(preferred) {
    const provider = document.getElementById('providerSelect').value;
    const sel = document.getElementById('modelSelect');
    const models = modelCatalog[provider]?.models || [];
    sel.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    if (preferred && models.includes(preferred)) sel.value = preferred;
}

function saveModelPref() {
    try {
        localStorage.setItem('rslide_llm', JSON.stringify({
            provider: document.getElementById('providerSelect').value,
            model: document.getElementById('modelSelect').value
        }));
    } catch (e) { }
}

function getLlmChoice() {
    return {
        provider: document.getElementById('providerSelect').value,
        model: document.getElementById('modelSelect').value,
        thinking: getThinking()
    };
}

/* ---------- 思考長度（中等 / 更高）：對應後端的 thinking = medium / high ---------- */
const THINKING_KEY = 'rslide_thinking';
const THINKING_LEVELS = ['medium', 'high'];
function getThinking() {
    return document.querySelector('#thinkingToggle [aria-checked="true"]')?.dataset.thinking || 'medium';
}
function setThinking(level, save = true) {
    if (!THINKING_LEVELS.includes(level)) level = 'medium';
    document.querySelectorAll('#thinkingToggle [data-thinking]').forEach(b => {
        const on = b.dataset.thinking === level;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
    });
    if (save) try { localStorage.setItem(THINKING_KEY, level); } catch (e) { }
}
(function initThinkingToggle() {
    const group = document.getElementById('thinkingToggle');
    let saved = null;
    try { saved = localStorage.getItem(THINKING_KEY); } catch (e) { }
    setThinking(saved, false);
    group.addEventListener('click', e => {
        const b = e.target.closest('[data-thinking]');
        if (b) setThinking(b.dataset.thinking);
    });
    // 方向鍵切換（radiogroup 的標準操作）
    group.addEventListener('keydown', e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const i = THINKING_LEVELS.indexOf(getThinking());
        const next = THINKING_LEVELS[(i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? THINKING_LEVELS.length - 1 : 1)) % THINKING_LEVELS.length];
        setThinking(next);
        group.querySelector(`[data-thinking="${next}"]`).focus();
    });
})();

/* ---------- 模型選單（樣式與「簡報風格」一致，附廠商圖示） ---------- */
// 圖示路徑取自 simple-icons（CC0）；沒有 path 的平台改用 Font Awesome 圖示（fa）
const PROVIDER_META = {
    gemini: {
        name: 'Google Gemini',
        path: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
        gradient: ['#4796e3', '#9177c7', '#ca6673']
    },
    openai: {
        name: 'OpenAI',
        path: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
    },
    // 自訂的 OpenAI 相容端點（後端設定 OPENAI_BASE_URL）：名稱來自 /api/models，圖示改為通用的伺服器圖示
    custom: { name: 'OpenAI 相容端點', fa: 'fa-server', color: '#71717a' }
};
// 平台的顯示資訊：openai 連到自訂端點時改用 custom 的圖示與後端設定的名稱
function providerMeta(provider) {
    const info = modelCatalog[provider] || {};
    if (provider === 'openai' && info.custom) return { ...PROVIDER_META.custom, name: info.name || PROVIDER_META.custom.name };
    return PROVIDER_META[provider];
}
let providerIconSeq = 0;
function providerIcon(provider, cls = 'w-4 h-4') {
    const meta = providerMeta(provider);
    if (!meta) return '<i class="fa-solid fa-microchip"></i>';
    if (meta.fa) return `<i class="fa-solid ${meta.fa} ${cls} shrink-0 inline-flex items-center justify-center" style="color:${meta.color}" aria-hidden="true"></i>`;
    // 漸層 id 每個圖示各自獨立：若引用到隱藏清單內的同名漸層，Chrome 會畫不出來
    const id = 'pg' + (++providerIconSeq);
    const fill = meta.gradient ? `url(#${id})` : 'currentColor';
    const defs = meta.gradient ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${meta.gradient.map((c, i) => `<stop offset="${i / (meta.gradient.length - 1)}" stop-color="${c}"/>`).join('')}</linearGradient></defs>` : '';
    return `<svg class="${cls} shrink-0" viewBox="0 0 24 24" aria-hidden="true">${defs}<path fill="${fill}" d="${meta.path}"/></svg>`;
}

function modelOptions() {
    return [...document.getElementById('providerSelect').options].flatMap(opt =>
        (modelCatalog[opt.value]?.models || []).map(model => ({ provider: opt.value, model, disabled: opt.disabled })));
}

function selectModel(provider, model) {
    document.getElementById('providerSelect').value = provider;
    populateModels(model);
    saveModelPref();
    renderModelPicker();
}

function renderModelPicker() {
    const provider = document.getElementById('providerSelect').value;
    const model = document.getElementById('modelSelect').value;
    document.getElementById('modelBtn').innerHTML =
        `${providerIcon(provider)}<span class="font-medium truncate max-w-[11rem]">${esc(model || '選擇模型')}</span><i class="fa-solid fa-chevron-down text-[10px] text-zinc-400"></i>`;
    document.getElementById('modelBtn').title = `${providerMeta(provider)?.name || provider} · ${model}`;
    // 沒有任何模型的平台整組不顯示
    document.getElementById('modelList').innerHTML = [...document.getElementById('providerSelect').options].filter(opt => modelCatalog[opt.value]?.models?.length).map(opt => {
        const p = opt.value;
        const header = `<li role="presentation" class="flex items-center gap-2 px-4 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            ${providerIcon(p, 'w-3.5 h-3.5')}<span>${esc(providerMeta(p)?.name || p)}</span>
            ${opt.disabled ? '<span class="ml-auto normal-case tracking-normal font-medium text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">未設定金鑰</span>' : ''}</li>`;
        const items = (modelCatalog[p]?.models || []).map(m => {
            const selected = p === provider && m === model;
            return `<li role="option" data-provider="${esc(p)}" data-model="${esc(m)}" aria-selected="${selected}" aria-disabled="${opt.disabled}"
                class="flex items-center justify-between gap-3 pl-10 pr-4 py-2 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 aria-selected:font-bold aria-selected:bg-zinc-100 dark:aria-selected:bg-zinc-800 aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent">
                <span class="truncate">${esc(m)}</span>${selected ? '<i class="fa-solid fa-check text-xs"></i>' : ''}</li>`;
        }).join('');
        return header + items;
    }).join('');
}

(function initModelPicker() {
    const wrap = document.getElementById('modelDropdown');
    const btn = document.getElementById('modelBtn');
    const list = document.getElementById('modelList');
    const setOpen = open => {
        list.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
        if (!open) return;
        // 窄螢幕時按鈕會換行到左側，選單改為靠左對齊以免超出畫面
        const alignLeft = btn.getBoundingClientRect().right < list.offsetWidth + 16;
        list.classList.toggle('left-0', alignLeft);
        list.classList.toggle('right-0', !alignLeft);
        list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    };
    btn.onclick = () => setOpen(list.classList.contains('hidden'));
    list.addEventListener('click', e => {
        const li = e.target.closest('[role=option]');
        if (!li || li.getAttribute('aria-disabled') === 'true') return;
        selectModel(li.dataset.provider, li.dataset.model);
        setOpen(false);
        btn.focus();
    });
    document.addEventListener('click', e => { if (!e.target.closest('#modelDropdown')) setOpen(false); });
    wrap.addEventListener('keydown', e => {
        if (e.key === 'Escape') { setOpen(false); btn.focus(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const opts = modelOptions().filter(o => !o.disabled);
        if (!opts.length) return;
        const cur = getLlmChoice();
        const i = opts.findIndex(o => o.provider === cur.provider && o.model === cur.model);
        const step = e.key === 'ArrowDown' ? 1 : opts.length - 1;
        const next = i < 0 ? opts[e.key === 'ArrowDown' ? 0 : opts.length - 1] : opts[(i + step) % opts.length];
        selectModel(next.provider, next.model);
        setOpen(true);
    });
})();

async function initModelSelectors() {
    try {
        const res = await fetch('/api/models');
        if (res.ok) {
            const data = await res.json();
            for (const k of Object.keys(data)) modelCatalog[k] = data[k];
            const providerSel = document.getElementById('providerSelect');
            for (const opt of providerSel.options) {
                if (data[opt.value] && !data[opt.value].available) opt.disabled = true;
            }
        }
    } catch (e) { }
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('rslide_llm') || '{}'); } catch (e) { }
    const providerSel = document.getElementById('providerSelect');
    const opt = [...providerSel.options].find(o => o.value === saved.provider && !o.disabled);
    providerSel.value = opt ? opt.value : ([...providerSel.options].find(o => !o.disabled)?.value || 'gemini');
    populateModels(saved.model);
    renderModelPicker();
}
initModelSelectors();

// 讀取輸入區的設定；內容空白或正在匯入檔案時提示並回傳 null
function readGenerationInput() {
    const ta = document.getElementById('inputContent');
    const content = ta.value.trim();
    if (importing) { showToast('檔案匯入中，請稍候', 'info'); return null; }
    if (!content) {
        ta.classList.remove('shake'); void ta.offsetWidth; ta.classList.add('shake');
        ta.focus();
        showToast('請輸入內容！', 'error');
        return null;
    }
    return {
        content,
        target_audience: document.getElementById('targetAudience').value,
        num_pages: parseInt(document.getElementById('numPages').value),
        style_preference: getStylePreference(),  // 自訂風格會組成含四色的描述
        deck_mode: getDeckMode()
    };
}

// 輸入區的生成按鈕：開啟「先確認大綱」時先產生大綱，否則直接生成整份簡報
function startGeneration() {
    if (isGenerating()) return;
    const input = readGenerationInput();
    if (!input) return;
    if (isOutlineFirst()) requestOutline(input);
    else generateDeck(input);
}

// outline 為使用者確認過的大綱（見 outline.js）；有值時頁數以大綱為準
async function generateDeck(input, outline = null) {
    if (isGenerating()) return;
    if (outline) input = { ...input, num_pages: outline.slides.length };

    burstFromButton(true);
    setLoading(true, 'deck', outline?.slides.length);

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, ...getLlmChoice(), ...(outline ? { outline } : {}) })
        });

        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = sanitizePresentation(await res.json());
        await bakeSlideCharts(data.slides);
        currentPresentationData = data;
        currentSlideIdx = 0;
        resetUndo();
        setLoading(false);
        if (outline) clearOutline();
        addHistory(input, data);
        renderReviewSection();
        burstFromButton(false);
        showToast('版面生成完成，已存入歷史記錄', 'success', 2200);
    } catch (err) {
        setLoading(false);
        if (outline) showOutlineSection();       // 失敗時回到大綱，修改的內容不會遺失
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, retryAction(err, () => generateDeck(input, outline)));
    }
    refreshQuota();                // 成功或失敗都算次數
}

/* ===================== 剩餘次數 =====================
 * 伺服器限制每個帳號 1 小時內與 24 小時內的 AI 使用次數（生成、大綱、重產與匯入檔案時的 AI 辨識合併計算，
 * 失敗的呼叫也算；見 store.begin_llm_call），
 * 剩餘次數顯示在生成按鈕旁與重產視窗。上限設為 0（不限制）的區間伺服器回傳 null，不顯示 */
let llmQuota = null;
let quotaTimer = null;

async function refreshQuota() {
    clearTimeout(quotaTimer);
    if (!currentUser) { llmQuota = null; renderQuota(); return; }
    try {
        const res = await fetch('/api/quota');
        llmQuota = res.ok ? await res.json() : null;
    } catch (_) { llmQuota = null; }
    renderQuota();
    // 用完時到恢復的時間點（最多每分鐘）再查一次，倒數與按鈕旁的文字才會跟著更新
    const waits = ['hour', 'day'].map(k => llmQuota?.[k]?.reset_in).filter(Boolean);
    if (waits.length) quotaTimer = setTimeout(refreshQuota, Math.min(60, Math.max(...waits) + 1) * 1000);
}

// 次數已達上限（伺服器的 429 訊息以「本帳號」開頭）時重試一定也會被擋，錯誤提示不放「重試」按鈕
function retryAction(err, onClick) {
    return err?.status === 429 && /^本帳號/.test(err.message || '') ? null : { label: '重試', onClick };
}

function fmtQuotaWait(seconds) {
    const m = Math.ceil(seconds / 60);
    return m < 60 ? `${m} 分鐘` : `${Math.floor(m / 60)} 小時` + (m % 60 ? ` ${m % 60} 分鐘` : '');
}

// 剩 3 次以內提醒，用完時顯示恢復時間
function quotaState(q) { return !q.remaining ? 'out' : q.remaining <= 3 ? 'low' : 'ok'; }

function quotaRow(label, q) {
    const pct = Math.min(100, Math.round(q.used / q.limit * 100));
    return `<div class="quota-row" data-state="${quotaState(q)}">
  <div class="quota-row-head"><span>${label}</span><span>已用 <b>${Math.min(q.used, q.limit)} / ${q.limit}</b> 次</span></div>
  <div class="quota-bar" role="progressbar" aria-label="${label}已用次數" aria-valuemin="0" aria-valuemax="${q.limit}" aria-valuenow="${Math.min(q.used, q.limit)}"><i style="width:${pct}%"></i></div>
  ${q.remaining ? '' : `<div class="quota-reset">已達上限，${fmtQuotaWait(q.reset_in)}後恢復</div>`}
</div>`;
}

function renderQuota() {
    const rows = llmQuota ? [['1 小時內', llmQuota.hour], ['24 小時內', llmQuota.day]].filter(([, q]) => q) : [];
    // 圖示的顏色依兩個區間中較少的剩餘次數：那才是目前真正還能用的次數
    const tight = rows.length ? rows.map(([, q]) => q).reduce((a, b) => (b.remaining < a.remaining ? b : a)) : null;
    const summary = rows.map(([label, q]) => `${label}剩 ${q.remaining} / ${q.limit} 次`).join('，');
    const html = tight ? `
<button type="button" class="quota-chip" data-state="${quotaState(tight)}" aria-label="用量限制：${summary}" aria-expanded="false" onclick="toggleQuotaPop(this)">
  <i class="fa-regular fa-clock" aria-hidden="true"></i><span>用量限制</span>
</button>
<div class="quota-pop" role="tooltip">
  <div class="quota-pop-title"><i class="fa-regular fa-clock text-violet-500" aria-hidden="true"></i>用量限制</div>
  ${rows.map(([label, q]) => quotaRow(label, q)).join('')}
  <p class="quota-note">生成、大綱、重產與匯入檔案時的 AI 辨識合併計算（一個檔案算一次），失敗的也會算一次</p>
</div>` : '';
    ['quotaInfo', 'regenQuotaInfo'].forEach(id => {
        const el = document.getElementById(id);
        const open = el.classList.contains('open');              // 更新數字時保留觸控開啟的狀態
        el.innerHTML = html;
        el.classList.toggle('hidden', !html);
        el.classList.toggle('open', open && !!html);
        el.querySelector('.quota-chip')?.setAttribute('aria-expanded', String(open && !!html));
    });
}

// 觸控裝置沒有 hover：點一下圖示開關浮框，點其他地方或按 Esc 關閉
function toggleQuotaPop(btn) {
    const wrap = btn.closest('.quota');
    const open = !wrap.classList.contains('open');
    closeQuotaPops();
    placeQuotaPop(wrap);
    wrap.classList.remove('dismissed');
    wrap.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
}
function closeQuotaPops() {
    document.querySelectorAll('.quota.open').forEach(w => {
        w.classList.remove('open');
        w.querySelector('.quota-chip')?.setAttribute('aria-expanded', 'false');
    });
}
// Esc 也要收起滑鼠 hover 或鍵盤聚焦顯示的浮框：標記 dismissed，滑鼠再次移入或焦點從外面移進來時恢復
function dismissQuotaPops() {
    closeQuotaPops();
    document.querySelectorAll('.quota').forEach(w => {
        if (w.matches(':hover') || w.contains(document.activeElement)) w.classList.add('dismissed');
    });
}
['quotaInfo', 'regenQuotaInfo'].forEach(id => {
    const w = document.getElementById(id);
    w.addEventListener('mouseenter', () => w.classList.remove('dismissed'));
    w.addEventListener('focusin', e => { if (!w.contains(e.relatedTarget)) w.classList.remove('dismissed'); });
});
// 浮框預設對齊圖示的左緣或右緣（data-align），超出視窗時往內推，手機上圖示不在最右邊也不會被切掉；
// 預設往上開，上方空間被固定的頂部標題列擋住時改往下開
function placeQuotaPop(wrap) {
    const pop = wrap.querySelector('.quota-pop');
    if (!pop) return;
    pop.style.left = pop.style.right = '';
    const r = wrap.getBoundingClientRect(), w = pop.offsetWidth, margin = 16, vw = document.documentElement.clientWidth;
    const header = document.getElementById('topHeader').getBoundingClientRect();
    const top = Math.max(0, header.bottom);
    wrap.classList.toggle('below', r.top - top < pop.offsetHeight + margin && window.innerHeight - r.bottom > r.top - top);
    if (wrap.dataset.align === 'right') {
        const shift = Math.max(0, margin - (r.right - w));          // 浮框左緣超出視窗的距離
        if (shift) pop.style.right = -shift + 'px';
    } else {
        const shift = Math.max(0, r.left + w - (vw - margin));
        if (shift) pop.style.left = -shift + 'px';
    }
}
['mouseover', 'focusin'].forEach(type => document.addEventListener(type, e => {
    const wrap = e.target.closest?.('.quota');
    if (wrap) placeQuotaPop(wrap);
}));
document.addEventListener('click', e => { if (!e.target.closest('.quota')) closeQuotaPops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') dismissQuotaPops(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuota(); });

function renderReviewSection(quiet = false) {
    const review = document.getElementById('sectionReview');
    review.classList.remove('hidden');
    document.getElementById('sectionPlayer').classList.add('hidden');
    if (!quiet) animateIn(review);
    setStep(2);
    updateDeckModeBadges();

    const container = document.getElementById('reviewContainer');
    container.innerHTML = '';

    currentPresentationData.slides.forEach((slide, idx) => {
        const card = document.createElement('div');
        card.className = "rv-card relative spot p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-xl flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-600";
        card.innerHTML = `
  <div class="rv-thumb" role="button" tabindex="0" onclick="previewSingleSlide(${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();previewSingleSlide(${idx})}" aria-label="預覽第 ${idx + 1} 頁：${esc(slide.slide_title)}" title="點擊放大預覽">
    <div class="slide-scaler">${slide.html_content}</div>
  </div>
  ${slideVersions(slide).length ? `<button type="button" class="rv-versions" onclick="openVersionModal(${idx})" title="比較或還原此頁的舊版本"
    aria-label="第 ${idx + 1} 頁有 ${slideVersions(slide).length} 個舊版本，點擊比較或還原"><i class="fa-solid fa-clock-rotate-left"></i><span>舊版本 ${slideVersions(slide).length}</span></button>` : ''}
  <div class="relative min-w-0 px-1">
    <div class="flex items-center gap-2 mb-1">
      <span class="drag-handle text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-0.5" draggable="true" title="拖曳調整頁序" aria-hidden="true"
        ondragstart="onSlideDragStart(event, ${idx})" ondragend="onSlideDragEnd()"><i class="fa-solid fa-grip-vertical text-[11px]"></i></span>
      <span class="text-xs font-mono bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-600 dark:text-zinc-300">${pad(idx + 1)}</span>
      <span class="slide-title-edit font-bold text-sm truncate min-w-0 flex-1" contenteditable="plaintext-only" spellcheck="false" title="點擊可修改標題"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}else if(event.key==='Escape'){this.textContent=currentPresentationData.slides[${idx}].slide_title;this.blur()}"
        onblur="commitSlideTitle(${idx}, this)">${esc(slide.slide_title)}</span>
    </div>
    <div class="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1 min-w-0">
      <span class="inline-block w-2 h-2 shrink-0 rounded-full bg-green-500 pulse-dot"></span>
      <span class="truncate" title="${esc(slide.layout_concept)}">${esc(slide.layout_concept)}</span>
    </div>
  </div>
  <div class="flex items-center gap-2 px-1 pb-1">
    <button onclick="previewSingleSlide(${idx})" class="icon-btn flex-1 justify-center text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold flex items-center gap-1.5 whitespace-nowrap">
      <i class="fa-regular fa-eye text-[10px]"></i>
      <span>預覽</span>
    </button>
    <button id="regenSlideBtn-${idx}" onclick="openRegenerateModal(${idx})" class="icon-btn flex-1 justify-center text-xs px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-semibold flex items-center gap-1.5 whitespace-nowrap">
      <i id="regenSlideIcon-${idx}" class="fa-solid fa-arrows-rotate text-[10px]"></i>
      <span id="regenSlideLabel-${idx}">重產此頁</span>
    </button>
  </div>
  <div class="flex items-center justify-between gap-1 px-1 pb-1 text-zinc-500 dark:text-zinc-400">
    <button onclick="moveSlide(${idx}, ${idx - 1})" ${idx === 0 ? 'disabled' : ''} class="icon-btn w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center" title="前移" aria-label="前移"><i class="fa-solid fa-arrow-left text-[11px]"></i></button>
    <button onclick="moveSlide(${idx}, ${idx + 1})" ${idx === currentPresentationData.slides.length - 1 ? 'disabled' : ''} class="icon-btn w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center" title="後移" aria-label="後移"><i class="fa-solid fa-arrow-right text-[11px]"></i></button>
    <button onclick="duplicateSlide(${idx})" class="icon-btn h-8 px-3 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5" title="複製此頁" aria-label="複製此頁"><i class="fa-regular fa-clone text-[11px]"></i><span>複製</span></button>
    <button onclick="addBlankSlide(${idx})" class="icon-btn w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center" title="在此頁後新增空白頁" aria-label="在此頁後新增空白頁"><i class="fa-solid fa-plus text-[11px]"></i></button>
    <button onclick="deleteSlide(${idx})" ${currentPresentationData.slides.length <= 1 ? 'disabled' : ''} class="icon-btn h-8 px-3 rounded-full hover:bg-red-50 hover:text-red-500 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5" title="刪除此頁" aria-label="刪除此頁"><i class="fa-regular fa-trash-can text-[11px]"></i><span>刪除</span></button>
  </div>
`;
        card.dataset.idx = idx;
        card.addEventListener('dragover', e => { if (dragSlideIdx !== null) { e.preventDefault(); card.classList.add('drag-over'); } });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', e => {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (dragSlideIdx !== null) moveSlide(dragSlideIdx, idx);
        });
        container.appendChild(card);
    });
    // 最後一格：在最後一頁之後新增空白頁
    const addTile = document.createElement('button');
    addTile.type = 'button';
    addTile.className = 'rv-add min-h-[10rem] rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-950 transition-colors flex flex-col items-center justify-center gap-2 text-sm font-semibold';
    addTile.innerHTML = '<i class="fa-solid fa-plus text-lg"></i><span>新增空白頁</span>';
    addTile.onclick = () => addBlankSlide(currentPresentationData.slides.length - 1);
    container.appendChild(addTile);
    fitReviewThumbs();
    if (regeneratingSlideIdx !== null && regeneratingDeck === currentPresentationData) setReviewRegenerateState(regeneratingSlideIdx, true);

    if (!quiet) review.scrollIntoView({ behavior: 'smooth' });
}

// 縮圖寬度不固定（隨視窗變動），依容器寬度等比縮放 1024px 的投影片
// Tailwind CDN 會在元素插入「之後」才產生 class 樣式，建立當下量到的寬度可能不對，
// 因此用 ResizeObserver 監看每個縮圖，寬度一變就重算縮放。
const thumbFitRO = new ResizeObserver(entries => {
    entries.forEach(({ target: box }) => {
        const scaler = box.querySelector('.slide-scaler');
        if (scaler && box.clientWidth) scaler.style.transform = `scale(${box.clientWidth / 1024})`;
    });
});
function fitReviewThumbs() {
    document.querySelectorAll('#reviewContainer .rv-thumb').forEach(box => thumbFitRO.observe(box));
}

function previewSingleSlide(idx) {
    currentSlideIdx = idx;
    confirmAndPlay();
}

function confirmAndPlay() {
    const player = document.getElementById('sectionPlayer');
    player.classList.remove('hidden');
    document.getElementById('sectionReview').classList.add('hidden');
    animateIn(player);
    setStep(3);

    document.getElementById('presentationTitleDisplay').innerText = currentPresentationData.presentation_title;
    updateDeckModeBadges();
    buildThumbnails();
    renderSlide(currentSlideIdx, 'fade');
    player.scrollIntoView({ behavior: 'smooth' });
}

function backToReview() {
    stopAutoplay();
    toggleEditMode(false);
    if (document.fullscreenElement) document.exitFullscreen();
    renderReviewSection();
}

function setReviewRegenerateState(idx, on) {
    const btn = document.getElementById(`regenSlideBtn-${idx}`);
    const icon = document.getElementById(`regenSlideIcon-${idx}`);
    const label = document.getElementById(`regenSlideLabel-${idx}`);
    if (!btn || !icon || !label) return;
    btn.disabled = on;
    icon.className = on ? 'fa-solid fa-circle-notch fa-spin text-[10px]' : 'fa-solid fa-arrows-rotate text-[10px]';
    label.textContent = on ? '重產中...' : '重產此頁';
}

function setCurrentRegenerateState(on) {
    const btn = document.getElementById('regenCurrentBtn');
    const icon = document.getElementById('regenCurrentIcon');
    const label = document.getElementById('regenCurrentLabel');
    if (!btn || !icon || !label) return;
    btn.disabled = on;
    icon.className = on ? 'fa-solid fa-circle-notch fa-spin text-[11px]' : 'fa-solid fa-arrows-rotate text-[11px]';
    label.textContent = on ? '重產中...' : '重產此頁';
}

function regenerateCurrentSlide() {
    openRegenerateModal(currentSlideIdx);
}

function openRegenerateModal(idx) {
    if (regeneratingSlideIdx !== null) {
        showToast('已有頁面正在重產中，請稍候', 'info', 2200);
        return;
    }
    if (!currentPresentationData || !Array.isArray(currentPresentationData.slides) || idx < 0 || idx >= currentPresentationData.slides.length) return;
    regenerateModalSlideIdx = idx;
    const modal = document.getElementById('regenModal');
    const ta = document.getElementById('regenPromptInput');
    ta.value = '';
    // 預設沿用這份簡報的模式（不是輸入區目前選的模式）
    const mode = currentDeckMode();
    document.querySelectorAll('input[name="regenDeckMode"]').forEach(r => { r.checked = r.value === mode; });
    modal.classList.remove('hidden');
    setTimeout(() => ta.focus(), 0);
    refreshQuota();
}

function closeRegenerateModal(force = false) {
    if (!force && regeneratingSlideIdx !== null) return;
    regenerateModalSlideIdx = null;
    document.getElementById('regenPromptInput').value = '';
    document.getElementById('regenModal').classList.add('hidden');
}

async function confirmRegenerateFromModal() {
    if (regenerateModalSlideIdx === null) return;
    const prompt = document.getElementById('regenPromptInput').value.trim();
    const mode = document.querySelector('input[name="regenDeckMode"]:checked')?.value;
    await regenerateSingleSlide(regenerateModalSlideIdx, prompt, mode);
}

// deckMode 省略時沿用這份簡報的模式；與原模式不同時，成功後寫回簡報設定
async function regenerateSingleSlide(idx, customPrompt = '', deckMode) {
    if (!currentPresentationData || !Array.isArray(currentPresentationData.slides)) {
        showToast('目前沒有可重產的簡報內容', 'info', 2200);
        return;
    }
    if (isGenerating()) {
        showToast('正在生成整份簡報中，請稍候', 'info', 2200);
        return;
    }
    if (regeneratingSlideIdx !== null) {
        showToast('已有頁面正在重產中，請稍候', 'info', 2200);
        return;
    }
    if (idx < 0 || idx >= currentPresentationData.slides.length) return;

    const input = getCurrentGenerationInput();
    if (!input.content?.trim()) {
        showToast('缺少原始內容，無法重產此頁', 'error', 3200);
        return;
    }
    const mode = normDeckMode(deckMode ?? input.deck_mode);

    // 重產期間使用者仍可切換 / 新增 / 刪除簡報：記下發出請求時的簡報與頁面，回來後依物件找回位置
    const deck = currentPresentationData;
    const targetSlide = deck.slides[idx];
    regeneratingSlideIdx = idx;
    regeneratingDeck = deck;
    updateUndoButtons();
    setReviewRegenerateState(idx, true);
    setCurrentRegenerateState(true);
    const modalConfirmBtn = document.getElementById('regenModalConfirmBtn');
    const modalConfirmIcon = document.getElementById('regenModalConfirmIcon');
    const modalConfirmLabel = document.getElementById('regenModalConfirmLabel');
    const modalCancelBtn = document.getElementById('regenModalCancelBtn');
    const modalOpen = !document.getElementById('regenModal').classList.contains('hidden');
    if (modalOpen) {
        modalConfirmBtn.disabled = true;
        modalCancelBtn.disabled = true;
        modalConfirmIcon.className = 'fa-solid fa-circle-notch fa-spin text-[11px]';
        modalConfirmLabel.textContent = '重產中...';
    }

    try {
        // 上傳的圖片（data URL）與已畫好的圖表 SVG 不送給 LLM：省 token，回來後再換回原圖
        const slim = slimSlidesForLlm(currentPresentationData.slides);
        const res = await fetch('/api/regenerate-slide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: input.content,
                target_audience: input.target_audience || '',
                num_pages: currentPresentationData.slides.length,
                style_preference: input.style_preference || '',
                deck_mode: mode,
                presentation_title: currentPresentationData.presentation_title || '未命名簡報',
                slide_index: idx,
                slides: slim.slides,
                custom_prompt: customPrompt,
                theme: currentPresentationData.theme || null,   // 整份簡報的設計規範，讓重產的頁面沿用（舊簡報沒有）
                ...getLlmChoice()
            })
        });

        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);

        const newSlide = sanitizeSlide(await res.json());
        newSlide.html_content = restoreSlideImages(newSlide.html_content, slim.images);
        await bakeSlideCharts([newSlide]);
        const at = currentPresentationData === deck ? deck.slides.indexOf(targetSlide) : -1;
        if (at < 0) {
            if (modalOpen) closeRegenerateModal(true);
            showToast('簡報已切換或此頁已不存在，已捨棄這次的重產結果', 'info', 3200);
            return;
        }
        pushUndoSnapshot();
        deck.slides[at] = {
            ...slideWithNewVersion(targetSlide, newSlide, customPrompt ? `重產：${customPrompt}` : '重產：AI 自動優化'),
            page_number: targetSlide.page_number || at + 1
        };

        syncCurrentPresentationToHistory();
        if (mode !== normDeckMode(input.deck_mode)) setCurrentDeckMode(mode);

        const inPlayer = !document.getElementById('sectionPlayer').classList.contains('hidden');
        const inReview = !document.getElementById('sectionReview').classList.contains('hidden');
        if (inPlayer) {
            buildThumbnails();
            if (at === currentSlideIdx) renderSlide(at, 'fade');
            else updateThumbnails();
        }
        if (inReview) renderReviewSection(true);
        if (modalOpen) closeRegenerateModal(true);
        // 之後可能調整過頁序或編輯過此頁（頁面物件會換新），以版本記錄找回這一頁
        const versions = deck.slides[at].versions;
        showToast(`第 ${at + 1} 頁已重產完成，舊版已保留`, 'success', 6000, {
            label: '比較舊版', onClick: () => {
                const i = currentPresentationData === deck ? deck.slides.findIndex(s => s.versions === versions) : -1;
                if (i >= 0) openVersionModal(i);
            }
        });
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, retryAction(err, () => regenerateSingleSlide(idx, customPrompt, mode)));
    } finally {
        setReviewRegenerateState(idx, false);
        setCurrentRegenerateState(false);
        regeneratingSlideIdx = null;
        regeneratingDeck = null;
        updateUndoButtons();
        modalConfirmBtn.disabled = false;
        modalCancelBtn.disabled = false;
        modalConfirmIcon.className = 'fa-solid fa-arrows-rotate text-[11px]';
        modalConfirmLabel.textContent = '確認重產';
        refreshQuota();
    }
}
