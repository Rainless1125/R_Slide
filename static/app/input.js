/* 範例、檔案匯入、輸入區（受眾 / 風格 / 草稿）
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 範例與輸入互動 ===================== */
const SAMPLES = [
    { text: "我們推出全新智慧手錶 Nova X：續航 7 天、支援血氧與睡眠分析、內建 AI 健康助理。目標是讓日常健康管理更簡單，預計下季開賣，首批限量 5,000 支。", audience: "科技愛好者與一般消費者" },
    { text: "第三季專案進度：核心功能完成 85%，使用者測試回饋正面，主要風險為第三方 API 延遲。下一步將優化效能並於 11 月底上線，需追加兩名後端人力。", audience: "公司主管與跨部門團隊" },
    { text: "什麼是機器學習？機器學習讓電腦從資料中找出規律而非手寫規則。常見類型有監督式、非監督式與強化學習，應用包含推薦系統、影像辨識與語音助理。", audience: "入門學習者" }
];
function fillSample(i) {
    const ta = document.getElementById('inputContent');
    ta.value = SAMPLES[i].text;
    document.getElementById('targetAudience').value = SAMPLES[i].audience;
    updateCount();
    ta.focus();
    showToast('已填入範例內容', 'success', 1800);
}
function clearInput() {
    document.getElementById('inputContent').value = '';
    document.getElementById('targetAudience').value = '';
    updateCount();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { }
}
function updateCount() {
    const ta = document.getElementById('inputContent');
    const c = document.getElementById('charCount');
    c.textContent = ta.value.length + ' 字';
    c.classList.toggle('text-emerald-500', ta.value.length > 20);
}
document.getElementById('inputContent').addEventListener('input', updateCount);
document.getElementById('inputContent').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') startGeneration();
});

/* ===================== 檔案匯入（PDF / DOCX / PPTX / Markdown / TXT） ===================== */
const IMPORT_EXTS = ['.pdf', '.docx', '.pptx', '.md', '.markdown', '.txt'];
const IMPORT_MAX_MB = { '.pptx': 30 };      // 其他格式 10 MB；簡報常內嵌大量截圖，上限較大
const OLD_OFFICE_HINT = { '.ppt': 'PowerPoint 檔請先另存為 .pptx', '.doc': 'Word 檔請先另存為 .docx' };
let importing = false;
let importTimer = null;

function setImporting(on, name = '') {
    importing = on;
    clearInterval(importTimer);
    // PPTX 的圖片會交給 AI 辨識，可能需要數十秒：顯示已等待的秒數
    if (on && /\.pptx$/i.test(name)) {
        const start = Date.now();
        const tick = () => {
            const sec = Math.floor((Date.now() - start) / 1000);
            document.getElementById('importLabel').textContent = `讀取中… ${sec} 秒`;
            document.getElementById('dropOverlayLabel').textContent = `正在讀取 ${name}，含圖片辨識（${sec} 秒）`;
        };
        importTimer = setInterval(tick, 1000);
    }
    document.getElementById('inputDropZone').classList.toggle('importing', on);
    document.getElementById('inputContent').readOnly = on;
    document.getElementById('importBtn').disabled = on;
    document.getElementById('importIcon').className = (on ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-file-arrow-up') + ' mr-1';
    document.getElementById('importLabel').textContent = on ? '匯入中…' : '上傳檔案';
    document.getElementById('dropOverlayIcon').className = (on ? 'fa-solid fa-circle-notch fa-spin' : 'fa-solid fa-file-arrow-up') + ' text-2xl';
    document.getElementById('dropOverlayLabel').textContent = on ? `正在讀取 ${name}…` : '放開以匯入檔案';
}

async function importFile(file) {
    if (!file || importing) return;
    if (isGenerating()) { showToast('生成中，請稍候再匯入檔案', 'info'); return; }
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    if (OLD_OFFICE_HINT[ext]) { showToast(`不支援舊版格式，${OLD_OFFICE_HINT[ext]}後再上傳`, 'error', 5000); return; }
    if (!IMPORT_EXTS.includes(ext)) { showToast('不支援的檔案格式，目前支援 PDF、DOCX、PPTX、Markdown、TXT', 'error', 5000); return; }
    const maxMb = IMPORT_MAX_MB[ext] || 10;
    if (file.size > maxMb * 1024 * 1024) { showToast(`檔案過大（上限 ${maxMb} MB）`, 'error', 5000); return; }

    setImporting(true, file.name);
    try {
        const form = new FormData();
        form.append('file', file);
        // PPTX 中的圖片用目前選擇的模型辨識
        const llm = getLlmChoice();
        form.append('provider', llm.provider);
        form.append('model', llm.model);
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        applyImportedText(await res.json());
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 6000);
    } finally {
        setImporting(false);
    }
}

// 以匯入內容取代輸入框；原本有內容時提供「復原」
function applyImportedText(data) {
    const ta = document.getElementById('inputContent');
    const prev = ta.value;
    ta.value = data.text;
    updateCount();
    saveDraft();
    ta.scrollTop = 0;
    const meta = [data.pages ? `${data.pages} 頁` : '', `${data.text.length.toLocaleString()} 字`,
        data.images_read ? `辨識 ${data.images_read} 張圖片` : ''].filter(Boolean).join('，');
    const undoAction = prev.trim() ? {
        label: '復原', onClick: () => { ta.value = prev; updateCount(); saveDraft(); }
    } : null;
    showToast(`已匯入 ${data.filename}（${meta}）`, 'success', undoAction ? 6000 : 2600, undoAction);
    if (data.truncated) {
        showToast(`原文共 ${data.chars.toLocaleString()} 字，超過上限，已截斷至前 ${data.text.length.toLocaleString()} 字`, 'info', 7000);
    }
    (data.notices || []).forEach(n => showToast(n, 'info', 7000));
    if (data.images_read) showToast('AI 辨識的圖片內容標有「AI 辨識」，生成前請核對數字', 'info', 7000);
}

(function initFileImport() {
    const zone = document.getElementById('inputDropZone');
    const input = document.getElementById('fileInput');
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    let dragDepth = 0;

    input.addEventListener('change', () => {
        importFile(input.files[0]);
        input.value = ''; // 允許重複選同一個檔案
    });
    zone.addEventListener('dragenter', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        zone.classList.add('dragging');
    });
    zone.addEventListener('dragover', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = importing ? 'none' : 'copy';
    });
    zone.addEventListener('dragleave', e => {
        if (!hasFiles(e)) return;
        if (--dragDepth <= 0) { dragDepth = 0; zone.classList.remove('dragging'); }
    });
    zone.addEventListener('drop', e => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth = 0;
        zone.classList.remove('dragging');
        const files = e.dataTransfer.files;
        if (files.length > 1) showToast('一次只能匯入一個檔案，已匯入第一個', 'info', 3000);
        importFile(files[0]);
    });
    // 從檔案總管複製後在輸入框貼上
    document.getElementById('inputContent').addEventListener('paste', e => {
        const file = e.clipboardData?.files?.[0];
        if (!file) return;
        e.preventDefault();
        importFile(file);
    });
    // 檔案若誤放在輸入框以外，避免瀏覽器直接開啟檔案而離開頁面
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (hasFiles(e)) e.preventDefault(); });
})();

/* ===================== 輸入區：受眾快選 / 風格卡片 / 草稿自動儲存 ===================== */
const AUDIENCE_PRESETS = ['公司主管', '客戶 / 投資人', '技術團隊', '學生 / 入門學習者', '一般大眾'];
(function initAudienceChips() {
    const box = document.getElementById('audienceChips');
    const input = document.getElementById('targetAudience');
    AUDIENCE_PRESETS.forEach(name => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.className = 'chip text-[11px] px-2.5 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800';
        b.onclick = () => { input.value = name; input.dispatchEvent(new Event('input')); };
        box.appendChild(b);
    });
})();

// 依選項順序對應的示意配色：[底色, 色塊1, 色塊2, 色塊3]
const STYLE_SWATCHES = [
    ['#ffffff', '#18181b', '#d4d4d8', '#a1a1aa'],
    ['#020617', '#ffffff', '#22d3ee', '#3b82f6'],
    ['#f8fafc', '#1e3a8a', '#3b82f6', '#94a3b8'],
    ['#fffbeb', '#facc15', '#f472b6', '#fb923c'],
    ['#f5f5f4', '#3f6212', '#78350f', '#a8a29e'],
    ['#fef3c7', '#000000', '#f472b6', '#38bdf8'],
    ['#09090b', '#e879f9', '#67e8f9', '#a855f7'],
    ['#0a0a0a', '#fcd34d', '#d97706', '#737373'],
    ['#ecfdf5', '#022c22', '#059669', '#6ee7b7'],
    ['#f4f4f5', '#000000', '#dc2626', '#a1a1aa']
];
const DEFAULT_SWATCH = ['#ffffff', '#000000', '#888888', '#bbbbbb'];

/* ----- 自訂風格：使用者自選四色，送出時組成含色碼的風格描述 ----- */
const CUSTOM_STYLE = '__custom__';               // stylePreference 中「自訂風格」選項的 value
const CUSTOM_STYLE_KEY = 'rslide_custom_style';
const CUSTOM_COLOR_ROLES = ['背景', '主色', '強調', '輔助'];
const CUSTOM_STYLE_RE = /^自訂配色 \(背景色 (#[0-9a-f]{6})、主色 (#[0-9a-f]{6})、強調色 (#[0-9a-f]{6})、輔助色 (#[0-9a-f]{6})/i;
let customColors = ['#ffffff', '#1e1b4b', '#7c3aed', '#f472b6'];
try {
    const saved = JSON.parse(localStorage.getItem(CUSTOM_STYLE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length === 4 && saved.every(c => /^#[0-9a-f]{6}$/i.test(c))) customColors = saved;
} catch (e) { }

function buildCustomStyle([bg, main, accent, sub]) {
    return `自訂配色 (背景色 ${bg}、主色 ${main}、強調色 ${accent}、輔助色 ${sub}；` +
        `請以 Tailwind 任意值語法精確套用這四個色碼：投影片背景 bg-[${bg}]、標題與主要文字 text-[${main}]、` +
        `重點色塊／圖示／數字 bg-[${accent}] text-[${accent}]、邊框與次要元素 border-[${sub}] text-[${sub}]，` +
        `可搭配透明度（例如 bg-[${accent}]/10），不要改用其他色系，並確保文字與背景對比清楚)`;
}
function parseCustomStyle(value) {
    const m = CUSTOM_STYLE_RE.exec(value || '');
    return m ? m.slice(1, 5).map(c => c.toLowerCase()) : null;
}
// 任一風格描述對應的四色（預設風格查表、自訂風格從描述中解析）
function styleColors(value) {
    const custom = parseCustomStyle(value);
    if (custom) return custom;
    const i = [...document.getElementById('stylePreference').options].findIndex(o => o.value === value);
    return STYLE_SWATCHES[i] || DEFAULT_SWATCH;
}
function getStylePreference() {
    const v = document.getElementById('stylePreference').value;
    return v === CUSTOM_STYLE ? buildCustomStyle(customColors) : v;
}
// 簡報模式：speaker = 簡易模式（演講型），document = 詳細模式（閱讀型）；舊紀錄沒有此欄位時視為演講型
const DECK_MODE_SHORT = { speaker: '演講型', document: '閱讀型' };
function normDeckMode(mode) { return mode === 'document' ? 'document' : 'speaker'; }
function getDeckMode() {
    return document.querySelector('input[name="deckMode"]:checked')?.value || 'speaker';
}
function setDeckMode(mode) {
    const radio = document.querySelector(`input[name="deckMode"][value="${normDeckMode(mode)}"]`);
    if (radio) radio.checked = true;
    updatePagesHint();
}
// 詳細模式每頁資訊較多：頁數固定時提醒可改由 AI 決定頁數
function updatePagesHint() {
    const fixed = document.getElementById('numPages').value !== '0';
    document.getElementById('pagesHint').classList.toggle('hidden', !(fixed && getDeckMode() === 'document'));
}
function setStylePreference(value) {
    const sel = document.getElementById('stylePreference');
    const custom = parseCustomStyle(value);
    if (custom) { customColors = custom; sel.value = CUSTOM_STYLE; }
    else if ([...sel.options].some(o => o.value === value)) sel.value = value;
    syncStyleCards();
}

// 文字後方顯示示意色塊（底色 + 三個強調色）
function swatchHtml(colors) {
    const [bg, a, b, c] = colors;
    const dot = col => `<span class="inline-block w-3 h-3 rounded-full border border-black/15 dark:border-white/25" style="background:${col}"></span>`;
    return `<span class="inline-flex items-center gap-1 shrink-0" aria-hidden="true">${dot(bg)}${dot(a)}${dot(b)}${dot(c)}</span>`;
}
function optionColors(i) {
    return document.getElementById('stylePreference').options[i]?.value === CUSTOM_STYLE ? customColors : (STYLE_SWATCHES[i] || DEFAULT_SWATCH);
}
// 歷史紀錄用的迷你投影片縮圖，以風格四色繪製
function styleThumbHtml([bg, a, b, c]) {
    const bar = (css, col) => `<div class="absolute rounded-sm" style="${css};background:${col}"></div>`;
    return `<div class="w-14 shrink-0 rounded-md overflow-hidden ring-1 ring-black/10 dark:ring-white/10 relative" style="aspect-ratio:16/9;background:${bg}" aria-hidden="true">
        ${bar('left:12%;top:20%;height:14%;width:52%', a)}${bar('left:12%;top:48%;height:9%;width:34%', b)}
        ${bar('left:12%;top:64%;height:9%;width:26%', c)}${bar('right:10%;top:44%;height:34%;width:22%;opacity:.9', b)}
      </div>`;
}
function styleLabel(opt) { return opt.textContent.replace(/\s+/g, ' ').trim(); }
function initCustomStylePanel() {
    const panel = document.getElementById('customStylePanel');
    panel.innerHTML = CUSTOM_COLOR_ROLES.map((role, i) => `
        <label class="flex flex-col gap-1 text-[11px] text-zinc-500 dark:text-zinc-400 cursor-pointer min-w-0">
          <input type="color" data-ci="${i}" class="custom-color" aria-label="自訂${role}色">
          <span class="text-center leading-tight"><span class="block font-semibold">${role}</span><span data-hex="${i}" class="block font-mono uppercase text-[10px] text-zinc-400"></span></span>
        </label>`).join('');
    panel.querySelectorAll('input[type=color]').forEach(inp => inp.addEventListener('input', () => {
        customColors[+inp.dataset.ci] = inp.value.toLowerCase();
        try { localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify(customColors)); } catch (e) { }
        syncStyleCards();
        saveDraft();
    }));
}
function initStyleCards() {
    const sel = document.getElementById('stylePreference');
    const list = document.getElementById('styleList');
    const btn = document.getElementById('styleBtn');
    const setOpen = open => {
        list.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
        if (open) list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
    };
    [...sel.options].forEach((opt, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.className = 'flex items-center justify-between gap-3 px-4 py-2 text-sm cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 aria-selected:font-bold aria-selected:bg-zinc-100 dark:aria-selected:bg-zinc-800';
        li.innerHTML = `<span class="truncate">${esc(styleLabel(opt))}</span><span data-swatch>${swatchHtml(optionColors(i))}</span>`;
        li.onclick = () => { sel.value = opt.value; syncStyleCards(); setOpen(false); saveDraft(); btn.focus(); };
        list.appendChild(li);
    });
    initCustomStylePanel();
    btn.onclick = () => setOpen(list.classList.contains('hidden'));
    document.addEventListener('click', e => { if (!e.target.closest('#styleDropdown')) setOpen(false); });
    document.getElementById('styleDropdown').addEventListener('keydown', e => {
        if (e.key === 'Escape') { setOpen(false); btn.focus(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const n = sel.options.length;
        sel.selectedIndex = (sel.selectedIndex + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        syncStyleCards(); saveDraft();
        setOpen(true);
    });
    syncStyleCards();
}
function syncStyleCards() {
    const sel = document.getElementById('stylePreference');
    if (sel.selectedIndex < 0) sel.selectedIndex = 0;
    const i = sel.selectedIndex;
    const isCustom = sel.value === CUSTOM_STYLE;
    document.getElementById('styleBtn').innerHTML =
        `<span class="truncate">${esc(styleLabel(sel.options[i]))}</span><span class="flex items-center gap-2 shrink-0">${swatchHtml(optionColors(i))}<i class="fa-solid fa-chevron-down text-[10px] text-zinc-400"></i></span>`;
    document.querySelectorAll('#styleList [role=option]').forEach(li => li.setAttribute('aria-selected', String(li.dataset.value === sel.value)));
    const customLi = document.querySelector(`#styleList [data-value="${CUSTOM_STYLE}"] [data-swatch]`);
    if (customLi) customLi.innerHTML = swatchHtml(customColors);
    const panel = document.getElementById('customStylePanel');
    panel.classList.toggle('hidden', !isCustom);
    panel.querySelectorAll('input[type=color]').forEach(inp => { inp.value = customColors[+inp.dataset.ci]; });
    panel.querySelectorAll('[data-hex]').forEach(s => { s.textContent = customColors[+s.dataset.hex]; });
}

const DRAFT_KEY = 'rslide_draft';
let draftTimer = null;
function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
        try {
            const content = document.getElementById('inputContent').value;
            if (!content.trim()) { localStorage.removeItem(DRAFT_KEY); return; }
            localStorage.setItem(DRAFT_KEY, JSON.stringify({
                content,
                audience: document.getElementById('targetAudience').value,
                pages: document.getElementById('numPages').value,
                style: getStylePreference(),
                mode: getDeckMode()
            }));
        } catch (e) { }
    }, 400);
}
function restoreDraft() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { }
    if (!d || !d.content) return;
    document.getElementById('inputContent').value = d.content;
    document.getElementById('targetAudience').value = d.audience || '';
    if (d.pages != null) document.getElementById('numPages').value = d.pages;
    if (d.style) setStylePreference(d.style);
    if (d.mode) setDeckMode(d.mode);
    updateCount();
    showToast('已還原上次未送出的草稿', 'info', 2400);
}
['inputContent', 'targetAudience'].forEach(id => document.getElementById(id).addEventListener('input', saveDraft));
['numPages', 'stylePreference'].forEach(id => document.getElementById(id).addEventListener('change', saveDraft));
document.querySelectorAll('input[name="deckMode"]').forEach(r => r.addEventListener('change', () => { saveDraft(); updatePagesHint(); }));
document.getElementById('numPages').addEventListener('change', updatePagesHint);
initStyleCards();
updatePagesHint();
