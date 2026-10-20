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
// 骨架屏：卡片結構與「版面審查」一致（縮圖 + 標題 + 版型 + 兩顆按鈕 + 操作列）
function buildSkeletonCards() {
    const n = parseInt(document.getElementById('numPages').value) || 6; // 0 = 由 AI 決定
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
const LOADING_MSGS = ['分析內容中…', '規劃版面結構…', 'AI 動態配色中…', '生成排版中…'];
function setLoading(on) {
    const btn = document.getElementById('btnGenerate');
    const spinner = document.getElementById('loadingSpinner');
    const icon = document.getElementById('btnIcon');
    const label = document.getElementById('btnLabel');
    const skel = document.getElementById('sectionSkeleton');
    btn.disabled = on;
    spinner.classList.toggle('hidden', !on);
    icon.classList.toggle('hidden', on);
    clearInterval(loadingTimer);
    if (on) {
        let i = 0;
        label.textContent = LOADING_MSGS[0];
        loadingTimer = setInterval(() => { i = (i + 1) % LOADING_MSGS.length; label.textContent = LOADING_MSGS[i]; }, 1800);
        document.getElementById('sectionReview').classList.add('hidden');
        document.getElementById('sectionPlayer').classList.add('hidden');
        buildSkeletonCards();
        skel.classList.remove('hidden');
        animateIn(skel);
        skel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        label.textContent = '生成排版';
        skel.classList.add('hidden');
    }
}

// /api/models 失敗時的備用清單，需與 app.py 的 MODEL_CATALOG 一致（tests/test_model_catalog.py 會檢查）
let modelCatalog = {
    gemini: { models: ['gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'] },
    openai: { models: ['gpt-6-luna'] },
    databricks: { models: [] }   // 模型清單由後端 .env 的 DATABRICKS_MODELS 決定
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
        model: document.getElementById('modelSelect').value
    };
}

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
    databricks: { name: 'Databricks', fa: 'fa-layer-group', color: '#FF3621' }
};
let providerIconSeq = 0;
function providerIcon(provider, cls = 'w-4 h-4') {
    const meta = PROVIDER_META[provider];
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
    document.getElementById('modelBtn').title = `${PROVIDER_META[provider]?.name || provider} · ${model}`;
    // 沒有任何模型的平台（例如沒設定 Databricks）整組不顯示
    document.getElementById('modelList').innerHTML = [...document.getElementById('providerSelect').options].filter(opt => modelCatalog[opt.value]?.models?.length).map(opt => {
        const p = opt.value;
        const header = `<li role="presentation" class="flex items-center gap-2 px-4 pt-2.5 pb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            ${providerIcon(p, 'w-3.5 h-3.5')}<span>${esc(PROVIDER_META[p]?.name || p)}</span>
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

async function startGeneration() {
    const ta = document.getElementById('inputContent');
    const content = ta.value.trim();
    const targetAudience = document.getElementById('targetAudience').value;
    const numPages = parseInt(document.getElementById('numPages').value);
    const stylePreference = getStylePreference(); // 讀取選擇的風格（自訂風格會組成含四色的描述）
    const deckMode = getDeckMode();

    if (importing) { showToast('檔案匯入中，請稍候', 'info'); return; }
    if (!content) {
        ta.classList.remove('shake'); void ta.offsetWidth; ta.classList.add('shake');
        ta.focus();
        showToast('請輸入內容！', 'error');
        return;
    }
    if (isGenerating()) return;

    burstFromButton(true);
    setLoading(true);

    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content,
                target_audience: targetAudience,
                num_pages: numPages,
                style_preference: stylePreference,
                deck_mode: deckMode,
                ...getLlmChoice()
            })
        });

        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = sanitizePresentation(await res.json());
        await bakeSlideCharts(data.slides);
        currentPresentationData = data;
        currentSlideIdx = 0;
        resetUndo();
        setLoading(false);
        addHistory({ content, target_audience: targetAudience, num_pages: numPages, style_preference: stylePreference, deck_mode: deckMode }, data);
        renderReviewSection();
        burstFromButton(false);
        showToast('版面生成完成，已存入歷史記錄', 'success', 2200);
    } catch (err) {
        setLoading(false);
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, { label: '重試', onClick: startGeneration });
    }
}

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
        card.className = "rv-card spot p-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-xl flex flex-col gap-3 transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-zinc-300 dark:hover:border-zinc-600";
        card.innerHTML = `
  <div class="rv-thumb" role="button" tabindex="0" onclick="previewSingleSlide(${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();previewSingleSlide(${idx})}" aria-label="預覽第 ${idx + 1} 頁：${esc(slide.slide_title)}" title="點擊放大預覽">
    <div class="slide-scaler">${slide.html_content}</div>
  </div>
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
            ...targetSlide,
            ...newSlide,
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
        showToast(`第 ${at + 1} 頁已重產完成`, 'success', 2200);
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, { label: '重試', onClick: () => regenerateSingleSlide(idx, customPrompt, mode) });
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
    }
}
