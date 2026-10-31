/* AI 修改此元素：選取投影片上的一個元素，輸入需求後只讓 AI 重新設計這個元素，頁面其他部分不變
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 media.js 之後）。 */
let aiEditTarget = null;          // 視窗開啟時選取的元素
let aiEditBusy = false;

// 根元素上決定位置、大小與圖層的 inline style（使用者移動、縮放、調整寬高與圖層的結果），換成新元素時沿用
const AI_EDIT_KEEP_STYLES = ['position', 'left', 'top', 'translate', 'scale', 'transform-origin', 'z-index', ...SIZE_PROPS];
const AI_EDIT_KEEP_ATTRS = ['data-rs-float', 'data-rs-text', 'data-rs-size'];
// AI 回傳多個根元素時，外層包一個 div 並沿用原元素決定版面位置的 class
const LAYOUT_CLASS_RE = /^(?:flex-(?:1|auto|initial|none)|grow|shrink|basis-|col-|row-|self-|justify-self-|order-|w-|h-|min-|max-|size-)/;

function canAiEdit(el) {
    return !!el && el.isConnected && !isRootBlock(el) && ['text', 'chart'].includes(elementKind(el));
}

function openAiEditModal() {
    const el = selectedEl;
    if (!editMode || !canAiEdit(el)) return;
    if (aiEditBusy) { showToast('AI 正在修改元素，請稍候', 'info', 2200); return; }
    if (regeneratingSlideIdx !== null || isGenerating()) { showToast('請等待目前的生成完成後再試', 'info', 2200); return; }
    stopTextEdit();
    aiEditTarget = el;
    const ta = document.getElementById('aiEditPrompt');
    ta.value = '';
    document.getElementById('aiEditModal').classList.remove('hidden');
    setTimeout(() => ta.focus(), 0);
}

function closeAiEditModal(force = false) {
    if (aiEditBusy && !force) return;
    document.getElementById('aiEditModal').classList.add('hidden');
    aiEditTarget = null;
}

function isAiEditModalOpen() { return !document.getElementById('aiEditModal').classList.contains('hidden'); }

// 快速需求：點一下填入（可再修改）
document.getElementById('aiEditChips').addEventListener('click', e => {
    const b = e.target.closest('[data-prompt]');
    if (!b) return;
    const ta = document.getElementById('aiEditPrompt');
    ta.value = ta.value.trim() ? ta.value.trim() + '；' + b.dataset.prompt : b.dataset.prompt;
    ta.focus();
});
document.getElementById('aiEditPrompt').addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); confirmAiEdit(); }
});

function setAiEditBusy(on) {
    aiEditBusy = on;
    const btn = document.getElementById('aiEditConfirmBtn');
    btn.disabled = on;
    document.getElementById('aiEditCancelBtn').disabled = on;
    document.getElementById('aiEditConfirmIcon').className = on ? 'fa-solid fa-circle-notch fa-spin text-[11px]' : 'fa-solid fa-wand-magic-sparkles text-[11px]';
    document.getElementById('aiEditConfirmLabel').textContent = on ? 'AI 修改中...' : '開始修改';
    const tb = fmtEl('aiEdit');
    if (tb) tb.disabled = on;
}

// 準備送給 AI 的資料：整頁 HTML（目標元素標上 data-rs-target）、目標元素本身，圖片換成代號、圖表容器清空；
// 元素內的圖表改用從 0 開始的索引，回來後再對應回整份簡報的 slide.charts
function buildAiEditPayload(el, slide) {
    el.setAttribute('data-rs-target', '1');
    let marked;
    try { marked = serializeScaler(getScaler()); } finally { el.removeAttribute('data-rs-target'); }
    const slim = slimSlidesForLlm([{ html_content: marked, charts: [] }]);
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${slim.slides[0].html_content}</body></html>`, 'text/html');
    const target = doc.querySelector('[data-rs-target]');
    const clone = target.cloneNode(true);
    clone.removeAttribute('data-rs-target');
    const charts = [];
    [clone, ...clone.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
        charts.push(slide.charts?.[Number(n.getAttribute('data-rs-chart'))] || null);
        n.setAttribute('data-rs-chart', String(charts.length - 1));
    });
    return { slideHtml: doc.body.innerHTML, elementHtml: clone.outerHTML, charts, images: slim.images };
}

// AI 回傳的 HTML → 單一元素（多個根元素時以沿用版面 class 的 div 包起來）
function parseAiElement(html, old) {
    const box = document.createElement('div');
    box.innerHTML = html;
    const kids = [...box.children];
    if (kids.length === 1 && !box.textContent.replace(kids[0].textContent, '').trim()) return kids[0];
    if (!box.textContent.trim() && !box.querySelector('img,svg,i,[data-rs-chart]')) return null;
    const wrap = document.createElement('div');
    const layout = [...old.classList].filter(c => LAYOUT_CLASS_RE.test(c));
    if (layout.length) wrap.className = layout.join(' ');
    wrap.innerHTML = box.innerHTML;
    return wrap;
}

function carryLayout(old, el) {
    AI_EDIT_KEEP_STYLES.forEach(p => {
        const v = old.style.getPropertyValue(p);
        if (v) el.style.setProperty(p, v);
    });
    AI_EDIT_KEEP_ATTRS.forEach(a => { if (old.hasAttribute(a)) el.setAttribute(a, old.getAttribute(a)); });
}

async function confirmAiEdit() {
    const el = aiEditTarget;
    if (aiEditBusy || !el) return;
    if (!el.isConnected || !editMode) { closeAiEditModal(); showToast('元素已不在畫面上，請重新選取', 'info', 2600); return; }
    const input = getCurrentGenerationInput();
    if (!input.content?.trim()) { showToast('缺少原始內容，無法使用 AI 修改', 'error', 3200); return; }
    const deck = currentPresentationData;
    const slideIdx = currentSlideIdx;
    const slide = deck.slides[slideIdx];
    const prompt = document.getElementById('aiEditPrompt').value.trim();
    const w = el.offsetWidth, h = el.offsetHeight;
    const payload = buildAiEditPayload(el, slide);

    setAiEditBusy(true);
    el.setAttribute('data-rs-busy', '1');
    try {
        const res = await fetch('/api/regenerate-element', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: input.content,
                target_audience: input.target_audience || '',
                num_pages: deck.slides.length,
                style_preference: input.style_preference || '',
                deck_mode: normDeckMode(input.deck_mode),
                presentation_title: deck.presentation_title || '未命名簡報',
                theme: deck.theme || null,
                slide_title: slide.slide_title || '',
                slide_html: payload.slideHtml,
                element_html: payload.elementHtml,
                element_width: Math.max(1, Math.round(w)),
                element_height: Math.max(1, Math.round(h)),
                charts: payload.charts,
                custom_prompt: prompt,
                ...getLlmChoice()
            })
        });
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();

        // 等待期間換了簡報、換頁、撤銷或刪除了元素：捨棄結果
        if (currentPresentationData !== deck || currentSlideIdx !== slideIdx || !el.isConnected || !editMode) {
            showToast('元素已變更或已離開編輯，已捨棄這次的 AI 修改結果', 'info', 3600);
            return;
        }
        const html = restoreSlideImages(sanitizeSlideHtml(data.html_content || ''), payload.images);
        const next = parseAiElement(html, el);
        if (!next) throw new Error('AI 沒有回傳可用的元素內容，請換個說法再試');

        pushUndoSnapshot();
        // 新圖表接在 slide.charts 後面，容器的索引改為整份簡報的索引
        const charts = Array.isArray(data.charts) ? data.charts : [];
        slide.charts = Array.isArray(slide.charts) ? slide.charts : [];
        [next, ...next.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
            const spec = charts[Number(n.getAttribute('data-rs-chart'))];
            if (!spec) { n.removeAttribute('data-rs-chart'); return; }
            slide.charts.push(spec);
            n.setAttribute('data-rs-chart', String(slide.charts.length - 1));
        });
        carryLayout(el, next);
        el.removeAttribute('data-rs-busy');
        if (selectedEl === el) clearSelection();
        el.replaceWith(next);
        [next, ...next.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(rerenderChart);
        commitSlideEdit(false);
        selectElement(next);
        closeAiEditModal(true);
        const grew = next.offsetWidth > w + 8 || next.offsetHeight > h + 8;
        showToast(grew ? 'AI 已修改此元素，但新內容比原本大，可能蓋到旁邊的元素' : 'AI 已修改此元素，頁面其他部分不變',
            grew ? 'info' : 'success', 6000, { label: '復原', onClick: undo });
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000);
    } finally {
        el.removeAttribute('data-rs-busy');
        setAiEditBusy(false);
        refreshQuota();
    }
}
