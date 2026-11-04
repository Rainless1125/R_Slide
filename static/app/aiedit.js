/* AI 修改此元素：選取投影片上的一個元素，輸入需求後只讓 AI 重新設計這個元素，頁面其他部分不變
 * 多選（multisel.js：Shift + 點擊或框選）2 個以上時，一次送出這些元素：各自修改、互相呼應，或合併成一個元素
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 media.js 之後）。 */
let aiEditTarget = null;          // 視窗開啟時選取的元素
let aiEditTargets = null;         // 多選時的元素（依文件順序），單選時為 null
let aiEditBusy = false;

// 根元素上決定位置、大小與圖層的 inline style（使用者移動、縮放、調整寬高與圖層的結果），換成新元素時沿用
const AI_EDIT_KEEP_STYLES = ['position', 'left', 'top', 'translate', 'scale', 'transform-origin', 'z-index', ...SIZE_PROPS];
const AI_EDIT_KEEP_ATTRS = ['data-rs-float', 'data-rs-text', 'data-rs-size'];
// AI 回傳多個根元素時，外層包一個 div 並沿用原元素決定版面位置的 class
const LAYOUT_CLASS_RE = /^(?:flex-(?:1|auto|initial|none)|grow|shrink|basis-|col-|row-|self-|justify-self-|order-|w-|h-|min-|max-|size-)/;

function canAiEdit(el) {
    if (!el || !el.isConnected || isRootBlock(el)) return false;
    const kind = elementKind(el);
    return ['text', 'chart'].includes(kind) || (kind === 'image' && isConvertibleImage(el));
}
// 可辨識並轉換的圖片：使用者上傳或貼上的圖片（存在簡報中的 data URL，送出前一律轉成 PNG / JPEG）；企業識別圖示等由伺服器提供的圖片不轉換
function isConvertibleImage(el) {
    return el.tagName === 'IMG' && /^data:image\/(?:png|jpe?g|webp|gif|bmp|svg\+xml)/i.test(el.getAttribute('src') || '');
}
// 多選一起修改：AI 看不到圖片內容（只送出圖片代號），圖片不加入多選
function canAiEditGroup(el) { return canAiEdit(el) && elementKind(el) !== 'image'; }

function openAiEditModal() {
    const multi = typeof isMultiSel === 'function' && isMultiSel() ? [...multiSel] : null;
    const el = selectedEl;
    if (!editMode || (multi ? !multi.every(canAiEditGroup) : !canAiEdit(el))) return;
    if (aiEditBusy) { showToast('AI 正在修改元素，請稍候', 'info', 2200); return; }
    if (regeneratingSlideIdx !== null || isGenerating()) { showToast('請等待目前的生成完成後再試', 'info', 2200); return; }
    stopTextEdit();
    aiEditTarget = multi ? null : el;
    aiEditTargets = multi;
    const image = !multi && elementKind(el) === 'image';
    document.getElementById('aiEditTitleText').textContent = multi ? `AI 修改 ${multi.length} 個元素` : image ? 'AI 轉換圖片' : 'AI 修改此元素';
    document.getElementById('aiEditSubtitle').textContent = multi
        ? '只會重新設計選取的元素，頁面其他部分不變；AI 會把它們當成一組，讓內容互相關聯。'
        : image ? 'AI 會讀出圖片中的內容（例如表格截圖），依需求轉成可編輯的表格、圖表或條列，取代這張圖片；留白則由 AI 選擇最適合的呈現。'
        : '只會重新設計選取的元素，頁面其他部分不變；留白則由 AI 自動優化。';
    document.getElementById('aiEditChips').hidden = image;
    document.getElementById('aiEditImageChips').hidden = !image;
    document.getElementById('aiEditPrompt').placeholder = image
        ? '例如：轉成表格，表頭用深藍底白字；或：轉成長條圖'
        : '例如：改成長條圖、只留三個重點、把數字放大並加上圖示';
    document.getElementById('aiEditMultiMode').hidden = !multi;
    if (multi) document.querySelector('input[name="aiEditMulti"][value="each"]').checked = true;
    const ta = document.getElementById('aiEditPrompt');
    ta.value = '';
    document.getElementById('aiEditModal').classList.remove('hidden');
    setTimeout(() => ta.focus(), 0);
}

function closeAiEditModal(force = false) {
    if (aiEditBusy && !force) return;
    document.getElementById('aiEditModal').classList.add('hidden');
    aiEditTarget = null;
    aiEditTargets = null;
}

function isAiEditModalOpen() { return !document.getElementById('aiEditModal').classList.contains('hidden'); }

// 快速需求：點一下填入（可再修改）
document.getElementById('aiEditModal').addEventListener('click', e => {
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
    if (typeof updateMultiSelBar === 'function') updateMultiSelBar();
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
    if (aiEditTargets) return confirmMultiAiEdit();
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
    const isImage = elementKind(el) === 'image';
    let sourceImage = null;
    if (isImage) {
        try { sourceImage = await imageForRecognition(el); }
        catch (err) { showToast(err.message || '無法讀取這張圖片', 'error', 5000); return; }
    }

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
                slide_title: slideTitleForLlm(slide, payload.slideHtml),
                slide_html: payload.slideHtml,
                element_html: payload.elementHtml,
                element_width: Math.max(1, Math.round(w)),
                element_height: Math.max(1, Math.round(h)),
                charts: payload.charts,
                custom_prompt: prompt,
                source_image: sourceImage,
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
        if (isImage) placeConvertedImage(el, next);
        el.removeAttribute('data-rs-busy');
        if (selectedEl === el) clearSelection();
        el.replaceWith(next);
        [next, ...next.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(rerenderChart);
        commitSlideEdit(false);
        selectElement(next);
        closeAiEditModal(true);
        // 元素調整過寬高（或沿用固定大小的 class）時框的大小不變，多出的內容會溢出框外：一併比較內容的實際尺寸
        const grew = Math.max(next.offsetWidth, next.scrollWidth) > w + 8 || Math.max(next.offsetHeight, next.scrollHeight) > h + 8;
        const done = isImage ? 'AI 已把圖片轉成可編輯的內容，請核對數字與原圖是否一致' : 'AI 已修改此元素，頁面其他部分不變';
        showToast(grew ? (isImage ? 'AI 已把圖片轉成可編輯的內容，但比原圖大，可能蓋到旁邊的元素；請核對數字與原圖是否一致'
            : 'AI 已修改此元素，但新內容比原本大，可能超出外框或蓋到旁邊的元素') : done,
            grew ? 'info' : 'success', isImage ? 9000 : 6000, { label: '復原', onClick: undo });
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000);
    } finally {
        el.removeAttribute('data-rs-busy');
        setAiEditBusy(false);
        refreshQuota();
    }
}

/* ===================== 辨識並轉換圖片 ===================== */
// 送給 AI 前縮小並壓縮：長邊最多 2048px（表格文字仍清楚），檔案不超過約 1.1 MB（後端上限見 app.py 的 MAX_SOURCE_IMAGE_BYTES）
const RECOGNIZE_MAX_SIDE = 2048;
const RECOGNIZE_MAX_BYTES = 1_100_000;
function dataUrlBytes(url) { return Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4); }
async function imageForRecognition(img) {
    const src = img.getAttribute('src') || '';
    const im = new Image();
    im.src = src;
    try { await im.decode(); } catch (e) { throw new Error('無法讀取這張圖片，請重新插入後再試'); }
    for (const side of [RECOGNIZE_MAX_SIDE, 1600, 1200]) {
        const k = Math.min(1, side / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.naturalWidth * k));
        c.height = Math.max(1, Math.round(im.naturalHeight * k));
        const g = c.getContext('2d');
        g.fillStyle = '#fff';                      // 透明背景補白，避免轉 JPEG 後變黑
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(im, 0, 0, c.width, c.height);
        // 截圖多為文字與色塊，PNG 較清楚；太大時改用 JPEG
        for (const [type, q] of [['image/png'], ['image/jpeg', 0.9], ['image/jpeg', 0.8]]) {
            const url = c.toDataURL(type, q);
            if (dataUrlBytes(url) <= RECOGNIZE_MAX_BYTES) return url;
        }
    }
    throw new Error('圖片太大，無法辨識；請改用較小的圖片');
}
// 轉換後的新元素取代圖片：自行插入的浮動圖片改為文字方塊（高度隨內容、拉角落等比例縮放），
// 不沿用圖片的固定高度與填滿方式，避免表格被截掉或變形
function placeConvertedImage(img, next) {
    next.style.removeProperty('object-fit');
    next.style.removeProperty('aspect-ratio');
    if (next.hasAttribute('data-rs-float')) {
        next.setAttribute('data-rs-text', '');
        next.style.height = 'auto';
    } else if (img.style.height) next.style.removeProperty('height');
    next.removeAttribute('data-rs-img');
}

/* ===================== 一次修改多個元素 ===================== */
// 與 buildAiEditPayload 相同，但依序標上 data-rs-target="1"、"2"…；圖表索引為所有元素共用、從 0 開始
function buildMultiAiEditPayload(els, slide) {
    els.forEach((el, i) => el.setAttribute('data-rs-target', String(i + 1)));
    let marked;
    try { marked = serializeScaler(getScaler()); } finally { els.forEach(el => el.removeAttribute('data-rs-target')); }
    const slim = slimSlidesForLlm([{ html_content: marked, charts: [] }]);
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${slim.slides[0].html_content}</body></html>`, 'text/html');
    const charts = [];
    const elements = els.map((el, i) => {
        const clone = doc.querySelector(`[data-rs-target="${i + 1}"]`).cloneNode(true);
        clone.removeAttribute('data-rs-target');
        [clone, ...clone.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
            charts.push(slide.charts?.[Number(n.getAttribute('data-rs-chart'))] || null);
            n.setAttribute('data-rs-chart', String(charts.length - 1));
        });
        return { html: clone.outerHTML, width: Math.max(1, Math.round(el.offsetWidth)), height: Math.max(1, Math.round(el.offsetHeight)) };
    });
    return { slideHtml: doc.body.innerHTML, elements, charts, images: slim.images };
}

// 所有選取元素合起來的範圍（投影片座標，含移動與縮放），合併時告訴 AI 新元素可用的大小
function unionSlideRect(els) {
    const rs = els.map(slideRectOf);
    const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
    return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
}

// 合併後的新元素放在第 1 個元素的位置：只沿用位置與圖層（不沿用第 1 個元素的寬高與縮放，否則會被縮在原本那一格）
const AI_MERGE_KEEP_STYLES = ['position', 'left', 'top', 'translate', 'z-index'];
function placeMergedElement(els, next) {
    const first = els[0];
    AI_MERGE_KEEP_STYLES.forEach(p => {
        const v = first.style.getPropertyValue(p);
        if (v) next.style.setProperty(p, v);
    });
    AI_EDIT_KEEP_ATTRS.filter(a => a !== 'data-rs-size').forEach(a => { if (first.hasAttribute(a)) next.setAttribute(a, first.getAttribute(a)); });
    // 同一個 grid 中的元素：新元素橫跨原本的格數（全部子元素都選取時橫跨整列），旁邊不會留下空格
    const parent = first.parentElement;
    if (parent && els.every(el => el.parentElement === parent) && getComputedStyle(parent).display.includes('grid')) {
        const all = [...parent.children].every(c => els.includes(c));
        next.classList.remove(...[...next.classList].filter(c => /^col-(?:span|start|end)-/.test(c)));
        next.style.gridColumn = all ? '1 / -1' : `span ${els.length}`;
    }
}

async function confirmMultiAiEdit() {
    const els = aiEditTargets;
    if (aiEditBusy || !els) return;
    if (!editMode || !els.every(el => el.isConnected)) { closeAiEditModal(); showToast('選取的元素已不在畫面上，請重新選取', 'info', 2600); return; }
    const input = getCurrentGenerationInput();
    if (!input.content?.trim()) { showToast('缺少原始內容，無法使用 AI 修改', 'error', 3200); return; }
    const merge = document.querySelector('input[name="aiEditMulti"]:checked')?.value === 'merge';
    const deck = currentPresentationData;
    const slideIdx = currentSlideIdx;
    const slide = deck.slides[slideIdx];
    const prompt = document.getElementById('aiEditPrompt').value.trim();
    const sizes = els.map(el => [el.offsetWidth, el.offsetHeight]);
    const area = unionSlideRect(els);
    const payload = buildMultiAiEditPayload(els, slide);

    setAiEditBusy(true);
    els.forEach(el => el.setAttribute('data-rs-busy', '1'));
    try {
        const res = await fetch('/api/regenerate-elements', {
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
                slide_title: slideTitleForLlm(slide, payload.slideHtml),
                slide_html: payload.slideHtml,
                elements: payload.elements,
                merge,
                merge_width: Math.max(1, Math.round(area.w)),
                merge_height: Math.max(1, Math.round(area.h)),
                charts: payload.charts,
                custom_prompt: prompt,
                ...getLlmChoice()
            })
        });
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();

        if (currentPresentationData !== deck || currentSlideIdx !== slideIdx || !els.every(el => el.isConnected) || !editMode) {
            showToast('元素已變更或已離開編輯，已捨棄這次的 AI 修改結果', 'info', 3600);
            return;
        }
        const htmls = Array.isArray(data.elements) ? data.elements : [];
        if (htmls.length !== (merge ? 1 : els.length)) throw new Error('AI 回傳的元素數量不符，請再試一次');
        const nodes = htmls.map((h, i) => parseAiElement(restoreSlideImages(sanitizeSlideHtml(h || ''), payload.images), els[merge ? 0 : i]));
        if (nodes.some(n => !n)) throw new Error('AI 沒有回傳可用的元素內容，請換個說法再試');

        pushUndoSnapshot();
        // 新圖表接在 slide.charts 後面（同一張圖表被多個元素引用時只加一次），容器的索引改為整份簡報的索引
        const charts = Array.isArray(data.charts) ? data.charts : [];
        slide.charts = Array.isArray(slide.charts) ? slide.charts : [];
        const mapped = new Map();
        nodes.forEach(node => [node, ...node.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
            const i = Number(n.getAttribute('data-rs-chart'));
            if (!charts[i]) { n.removeAttribute('data-rs-chart'); return; }
            if (!mapped.has(i)) { slide.charts.push(charts[i]); mapped.set(i, slide.charts.length - 1); }
            n.setAttribute('data-rs-chart', String(mapped.get(i)));
        }));
        els.forEach(el => el.removeAttribute('data-rs-busy'));
        clearSelection();
        if (merge) {
            placeMergedElement(els, nodes[0]);
            els[0].replaceWith(nodes[0]);
            els.slice(1).forEach(el => el.remove());
        } else {
            els.forEach((el, i) => { carryLayout(el, nodes[i]); el.replaceWith(nodes[i]); });
        }
        nodes.forEach(node => [node, ...node.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(rerenderChart));
        commitSlideEdit(false);
        if (merge) selectElement(nodes[0]); else setMultiSel(nodes);
        closeAiEditModal(true);
        const grew = merge
            ? (() => { const r = slideRectOf(nodes[0]); return r.w > area.w + 8 || r.h > area.h + 8; })()
            : nodes.some((n, i) => Math.max(n.offsetWidth, n.scrollWidth) > sizes[i][0] + 8 || Math.max(n.offsetHeight, n.scrollHeight) > sizes[i][1] + 8);
        const done = merge ? `AI 已把 ${els.length} 個元素合併成一個` : `AI 已修改 ${els.length} 個元素`;
        showToast(grew ? done + '，但新內容比原本大，可能超出外框或蓋到旁邊的元素' : done + '，頁面其他部分不變',
            grew ? 'info' : 'success', 6000, { label: '復原', onClick: undo });
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000);
    } finally {
        els.forEach(el => el.removeAttribute('data-rs-busy'));
        setAiEditBusy(false);
        refreshQuota();
    }
}
