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

/* ===================== 檔案匯入（PDF / DOCX / Markdown / TXT） ===================== */
const IMPORT_EXTS = ['.pdf', '.docx', '.md', '.markdown', '.txt'];
const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
let importing = false;

function setImporting(on, name = '') {
    importing = on;
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
    if (!IMPORT_EXTS.includes(ext)) { showToast('不支援的檔案格式，目前支援 PDF、DOCX、Markdown、TXT', 'error', 5000); return; }
    if (file.size > IMPORT_MAX_BYTES) { showToast('檔案過大（上限 10 MB）', 'error', 5000); return; }

    setImporting(true, file.name);
    try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/extract', { method: 'POST', body: form });
        if (!res.ok) throw await readApiError(res);
        applyImportedText(await res.json());
    } catch (err) {
        showToast(friendlyError(err), 'error', 6000);
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
    const meta = [data.pages ? `${data.pages} 頁` : '', `${data.text.length.toLocaleString()} 字`].filter(Boolean).join('，');
    const undoAction = prev.trim() ? {
        label: '復原', onClick: () => { ta.value = prev; updateCount(); saveDraft(); }
    } : null;
    showToast(`已匯入 ${data.filename}（${meta}）`, 'success', undoAction ? 6000 : 2600, undoAction);
    if (data.truncated) {
        showToast(`原文共 ${data.chars.toLocaleString()} 字，超過上限，已截斷至前 ${data.text.length.toLocaleString()} 字`, 'info', 7000);
    }
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
// 文字後方顯示示意色塊（底色 + 三個強調色）
function swatchHtml(i) {
    const [bg, a, b, c] = STYLE_SWATCHES[i] || ['#fff', '#000', '#888', '#bbb'];
    const dot = col => `<span class="inline-block w-3 h-3 rounded-full border border-black/15 dark:border-white/25" style="background:${col}"></span>`;
    return `<span class="inline-flex items-center gap-1 shrink-0" aria-hidden="true">${dot(bg)}${dot(a)}${dot(b)}${dot(c)}</span>`;
}
function styleLabel(opt) { return opt.textContent.replace(/\s+/g, ' ').trim(); }
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
        li.innerHTML = `<span class="truncate">${esc(styleLabel(opt))}</span>${swatchHtml(i)}`;
        li.onclick = () => { sel.value = opt.value; syncStyleCards(); setOpen(false); saveDraft(); btn.focus(); };
        list.appendChild(li);
    });
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
    const i = sel.selectedIndex;
    document.getElementById('styleBtn').innerHTML =
        `<span class="truncate">${esc(styleLabel(sel.options[i]))}</span><span class="flex items-center gap-2 shrink-0">${swatchHtml(i)}<i class="fa-solid fa-chevron-down text-[10px] text-zinc-400"></i></span>`;
    document.querySelectorAll('#styleList [role=option]').forEach(li => li.setAttribute('aria-selected', String(li.dataset.value === sel.value)));
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
                style: document.getElementById('stylePreference').value
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
    if (d.style) document.getElementById('stylePreference').value = d.style;
    updateCount();
    syncStyleCards();
    showToast('已還原上次未送出的草稿', 'info', 2400);
}
['inputContent', 'targetAudience'].forEach(id => document.getElementById(id).addEventListener('input', saveDraft));
['numPages', 'stylePreference'].forEach(id => document.getElementById(id).addEventListener('change', saveDraft));
initStyleCards();
