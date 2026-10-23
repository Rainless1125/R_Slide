/* 撤銷 / 重做、選取與行內文字編輯、格式工具列
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 撤銷／重做 ===================== */
const UNDO_LIMIT = 50;
let undoStack = [];
let redoStack = [];

function cloneSlides() {
    return JSON.parse(JSON.stringify(currentPresentationData.slides));
}

function resetUndo() {
    undoStack = [];
    redoStack = [];
    updateUndoButtons();
}

// 修改簡報前呼叫，記下修改前的版本
function pushUndoSnapshot() {
    undoStack.push(cloneSlides());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateUndoButtons();
}

function canEditSlides() {
    if (!currentPresentationData) return false;
    if (regeneratingSlideIdx !== null || isGenerating()) {
        showToast('請等待目前的生成完成後再撤銷／重做', 'info', 2200);
        return false;
    }
    return true;
}

function applySlides(slides) {
    currentPresentationData.slides = slides;
    currentSlideIdx = Math.min(currentSlideIdx, slides.length - 1);
    syncCurrentPresentationToHistory();

    const inPlayer = !document.getElementById('sectionPlayer').classList.contains('hidden');
    const inReview = !document.getElementById('sectionReview').classList.contains('hidden');
    if (inPlayer) {
        buildThumbnails();
        renderSlide(currentSlideIdx, 'fade');
    }
    if (inReview) renderReviewSection(true);
    updateUndoButtons();
}

function undo() {
    if (!canEditSlides() || !undoStack.length) return;
    redoStack.push(cloneSlides());
    applySlides(undoStack.pop());
    showToast('已撤銷上一步變更', 'info', 1800);
}

function redo() {
    if (!canEditSlides() || !redoStack.length) return;
    undoStack.push(cloneSlides());
    applySlides(redoStack.pop());
    showToast('已重做', 'info', 1800);
}

function updateUndoButtons() {
    const busy = regeneratingSlideIdx !== null;
    document.querySelectorAll('[data-undo]').forEach(b => b.disabled = busy || !undoStack.length);
    document.querySelectorAll('[data-redo]').forEach(b => b.disabled = busy || !redoStack.length);
}

/* ===================== 行內文字編輯 ===================== */
let editMode = false;
const PLAINTEXT_EDIT = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; } catch (e) { } return d.contentEditable === 'plaintext-only'; })();

// 序列化投影片 DOM：移除編輯用的標記屬性（文字編輯中 / 拼字檢查 / 選取標記），得到可存回 html_content 的字串
const EDIT_ATTRS = ['contenteditable', 'spellcheck', 'data-rs-sel'];
function serializeScaler(scaler) {
    const c = scaler.cloneNode(true);
    c.querySelectorAll(EDIT_ATTRS.map(a => `[${a}]`).join(',')).forEach(el => EDIT_ATTRS.forEach(a => el.removeAttribute(a)));
    return c.innerHTML;
}

function getScaler() { return document.querySelector('#slideCanvas .slide-scaler'); }

// 進入編輯模式／換頁後：記下目前內容作為比對基準
function prepareEditing() {
    const scaler = getScaler();
    if (scaler) scaler.dataset.base = serializeScaler(scaler);
}

function toggleEditMode(force) {
    const want = typeof force === 'boolean' ? force : !editMode;
    if (want === editMode) return;
    if (want) {
        if (!currentPresentationData || regeneratingSlideIdx !== null) return;
        stopAutoplay();
    } else {
        closeIconPicker();
        closeShapePicker();
        stopTextEdit();
        clearSelection();
        commitSlideEdit();
    }
    editMode = want;
    const canvas = document.getElementById('slideCanvas');
    canvas.classList.toggle('editing', editMode);
    const btn = document.getElementById('editBtn');
    btn.setAttribute('aria-pressed', String(editMode));
    document.getElementById('editLabel').textContent = editMode ? '完成編輯' : '編輯';
    document.getElementById('editIcon').className = 'fa-solid text-[11px] ' + (editMode ? 'fa-check' : 'fa-pen-to-square');
    document.querySelectorAll('[data-edit-only]').forEach(b => { b.classList.toggle('hidden', !editMode); b.classList.toggle('flex', editMode); });
    if (editMode) {
        prepareEditing();   // 操作提示顯示在投影片上方的編輯列（#fmtDockHint），不另外跳出提示
        revealFmtDock();
    }
}

// 進入編輯模式時，投影片頂端若太靠近頁首，往下捲讓編輯列完整出現在投影片上方，而不是疊在投影片上
// （編輯列黏在頁首下方 72px，見 app.css 的 #fmtDock）
function revealFmtDock() {
    requestAnimationFrame(() => {
        const dock = document.getElementById('fmtDock');
        const want = 72 + dock.offsetHeight + 8;
        const top = document.getElementById('slideCanvas').getBoundingClientRect().top;
        if (top < want) window.scrollBy({ top: top - want, behavior: 'smooth' });
    });
}

// 把畫面上的修改寫回資料（一次編輯 = 一個撤銷步驟）
// withUndo=false：呼叫端已自行 pushUndoSnapshot（例如同時修改了 slide.charts）
function commitSlideEdit(withUndo = true) {
    const scaler = getScaler();
    const slide = currentPresentationData?.slides?.[currentSlideIdx];
    if (!scaler || !slide || scaler.dataset.base === undefined) return;
    const html = serializeScaler(scaler);
    if (html === scaler.dataset.base) { if (!withUndo) syncCurrentPresentationToHistory(); return; }
    if (withUndo) pushUndoSnapshot();
    slide.html_content = html;
    scaler.dataset.base = html;
    const thumbScaler = document.querySelector(`#thumbnailContainer .thumb[data-idx="${currentSlideIdx}"] .slide-scaler`);
    if (thumbScaler) thumbScaler.innerHTML = html;
    syncCurrentPresentationToHistory();
}

/* ----- 選取（單擊）與文字編輯（雙擊） ----- */
let selectedEl = null;
let editingEl = null;

function hasOwnText(el) { return [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); }
function isRootBlock(el) { return !!el && el.parentElement === getScaler(); }

function selectElement(el) {
    if (selectedEl && selectedEl !== el) selectedEl.removeAttribute('data-rs-sel');
    selectedEl = el;
    el.setAttribute('data-rs-sel', '1');
    fmtRO.disconnect();
    fmtRO.observe(el);
    refreshToolbar();
}

function clearSelection() {
    if (selectedEl) selectedEl.removeAttribute('data-rs-sel');
    selectedEl = null;
    fmtRO.disconnect();
    hidePalette();
    hideMoreMenu();
    document.getElementById('fmtToolbar')?.classList.remove('open');
    document.getElementById('floatBox')?.classList.remove('open');
}

function startTextEdit(el, x, y) {
    if (editingEl && editingEl !== el) stopTextEdit();
    editingEl = el;
    el.setAttribute('contenteditable', PLAINTEXT_EDIT ? 'plaintext-only' : 'true');
    el.setAttribute('spellcheck', 'false');
    selectElement(el);
    el.focus({ preventScroll: true });
    // 游標放在雙擊的位置
    let range = null;
    if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) { range = document.createRange(); range.setStart(pos.offsetNode, pos.offset); range.collapse(true); }
    }
    if (range && el.contains(range.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}

function stopTextEdit() {
    if (!editingEl) return;
    const el = editingEl;
    editingEl = null;
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
    // 插入後沒有輸入任何文字的文字方塊直接移除（不留下撤銷步驟）
    if (el.hasAttribute('data-rs-text') && !el.textContent.trim()) {
        if (selectedEl === el) clearSelection();
        el.remove();
    }
    // 圖案文字編輯結束：選取回到整個圖案，方便接著調整外框與填色
    if (el.hasAttribute('data-rs-shape-text') && selectedEl === el && el.parentElement) selectElement(el.parentElement);
    commitSlideEdit();
}

const slideCanvasEl = document.getElementById('slideCanvas');
slideCanvasEl.addEventListener('click', e => {
    if (!editMode) return;
    const scaler = getScaler();
    let t = e.target;
    if (!scaler || !scaler.contains(t) || t === scaler) { clearSelection(); return; }
    if (editingEl && editingEl.contains(t)) return;          // 編輯中：保留游標操作
    e.preventDefault();                                       // 避免投影片內的連結跳轉
    if (editingEl) stopTextEdit();
    const svg = t.closest('svg');
    if (svg && svg !== t && scaler.contains(svg)) t = svg;   // SVG 內部以整個圖形為單位
    const obj = t.closest('[data-rs-chart],[data-rs-float]');
    if (obj && scaler.contains(obj)) t = obj;                // 圖表 / 浮動圖片以整個容器為單位
    selectElement(t);
});
slideCanvasEl.addEventListener('dblclick', e => {
    if (!editMode) return;
    const scaler = getScaler();
    let el = e.target;
    if (el.closest('[data-rs-icon]')) return;                // 圖示沒有文字可編輯
    const shapeText = el.closest('[data-rs-shape]')?.querySelector(':scope > [data-rs-shape-text]');
    if (shapeText && scaler.contains(shapeText)) {           // 圖案：雙擊任何位置都編輯圖案內的文字（可能還是空的）
        e.preventDefault();
        startTextEdit(shapeText, e.clientX, e.clientY);
        return;
    }
    while (el && el !== scaler && !hasOwnText(el)) el = el.parentElement;
    if (!el || el === scaler || el.closest('svg')) return;
    e.preventDefault();
    startTextEdit(el, e.clientX, e.clientY);
});
slideCanvasEl.addEventListener('focusout', e => {
    if (!editMode) return;
    if (e.target === editingEl) stopTextEdit(); else commitSlideEdit();
});
slideCanvasEl.addEventListener('keydown', e => {
    // 編輯中避免 Enter 觸發外層按鈕行為；貼上一律純文字
    if (editMode && e.key === 'Enter' && !PLAINTEXT_EDIT) { e.preventDefault(); document.execCommand('insertLineBreak'); }
});
slideCanvasEl.addEventListener('paste', e => {
    if (!editMode || PLAINTEXT_EDIT) return;
    e.preventDefault();
    document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
});

/* ----- 以 Tailwind class 為單位的樣式替換 ----- */
const TW_HUES = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];
const TW_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const COLOR_BODY = `(?:white|black|transparent|current|inherit|(?:${TW_HUES.join('|')})-(?:${TW_SHADES.join('|')}))(?:\\/\\d{1,3})?`;
const RE = {
    size: /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$|^text-\[\d*\.?\d+(?:px|rem|em|vw|vh|%)\]$/,
    weight: /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
    align: /^text-(?:left|center|right|justify|start|end)$/,
    justify: /^justify-(?:start|center|end)$/,
    items: /^items-(?:start|center|end)$/,
    textColor: new RegExp(`^text-${COLOR_BODY}$|^text-\\[(?:#|rgb|hsl)[^\\]]*\\]$`),
    bgColor: new RegExp(`^bg-${COLOR_BODY}$|^bg-\\[(?:#|rgb|hsl)[^\\]]*\\]$|^bg-gradient-to-\\w+$|^(?:from|via|to)-${COLOR_BODY}$`),
    radius: /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$|^rounded-\[[^\]]*\]$/
};
const SIZE_STEPS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'];
const SIZE_PX = [12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96, 128];
const WEIGHTS = [['thin', '極細', 100], ['light', '細', 300], ['normal', '標準', 400], ['medium', '中等', 500], ['semibold', '半粗', 600], ['bold', '粗', 700], ['extrabold', '特粗', 800], ['black', '黑', 900]];
const RADII = [['none', '無'], ['sm', '極小'], ['', '小'], ['md', '中'], ['lg', '大'], ['xl', '特大'], ['2xl', '2XL'], ['3xl', '3XL'], ['full', '圓形']];

function removeClasses(el, ...res) {
    [...el.classList].forEach(c => { if (res.some(re => re.test(c))) el.classList.remove(c); });
}
function setClass(el, groupRes, cls) {
    removeClasses(el, ...groupRes);
    if (cls) el.classList.add(cls);
    if (!el.getAttribute('class')) el.removeAttribute('class');
}
function clearInlineStyle(el, ...props) {
    props.forEach(p => el.style.removeProperty(p));
    if (!el.getAttribute('style')) el.removeAttribute('style');
}

// 圖表的文字大小由 chartFontScale 換算（只認容器自己的字級，範圍 xs ~ 4xl），沒設定時視為 base
const CHART_SIZE_MAX = SIZE_STEPS.indexOf('4xl');
function currentSizeIndex(el) {
    const cls = [...el.classList].find(c => /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/.test(c));
    if (cls) return SIZE_STEPS.indexOf(cls.slice(5));
    const px = el.hasAttribute('data-rs-chart') ? chartFontScale(el) * 16 : parseFloat(getComputedStyle(el).fontSize) || 16;
    return SIZE_PX.reduce((best, v, i) => Math.abs(v - px) < Math.abs(SIZE_PX[best] - px) ? i : best, 0);
}
function currentWeight(el) {
    const cls = [...el.classList].find(c => RE.weight.test(c));
    if (cls) { const n = cls.slice(5); return (WEIGHTS.find(w => w[0] === n) || WEIGHTS.find(w => w[0] === 'light'))[0]; }
    const w = parseInt(getComputedStyle(el).fontWeight) || 400;
    return WEIGHTS.reduce((best, x) => Math.abs(x[2] - w) < Math.abs(best[2] - w) ? x : best, WEIGHTS[2])[0];
}
function currentRadius(el) {
    const cls = [...el.classList].find(c => /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?$/.test(c));
    if (cls) return cls === 'rounded' ? '' : cls.slice(8);
    return getComputedStyle(el).borderTopLeftRadius === '0px' ? 'none' : '__custom';
}
function currentAlign(el) {
    const a = getComputedStyle(el).textAlign;
    return a === 'center' ? 'center' : (a === 'right' || a === 'end') ? 'right' : 'left';
}

// 套用樣式 → 寫回資料（一個撤銷步驟）→ 稍後更新工具列（等 Tailwind 產生新 class 的樣式）
function fmtCommit() {
    commitSlideEdit();
    setTimeout(refreshToolbar, 90);
}

const FMT_ACTIONS = {
    sizeDown() { stepSize(-1); },
    sizeUp() { stepSize(1); },
    align(v) {
        const el = selectedEl;
        setClass(el, [RE.align], 'text-' + v);
        const cs = getComputedStyle(el);
        const pos = { left: 'start', center: 'center', right: 'end' }[v];
        if (/flex/.test(cs.display)) {      // flex 容器的子項不吃 text-align，一併調整主軸／交叉軸對齊
            if (cs.flexDirection.startsWith('column')) setClass(el, [RE.items], 'items-' + pos);
            else setClass(el, [RE.justify], 'justify-' + pos);
        }
    },
    weight(v) { setClass(selectedEl, [RE.weight], 'font-' + v); },
    radius(v) { if (v !== '__custom') setClass(selectedEl, [RE.radius], v === '' ? 'rounded' : 'rounded-' + v); },
    color(kind, c) {                         // c === '' → 移除；圖案的 fill / stroke 為 HEX 或 none
        const el = selectedEl;
        if (kind === 'fill' || kind === 'stroke') { const s = shapeOf(el); if (s) setShapeStyle(s, kind, c); return; }
        if (kind === 'border') { setImgBorder(el, 'color', c); return; }
        if (kind === 'text') { setClass(el, [RE.textColor], c ? 'text-' + c : ''); clearInlineStyle(el, 'color'); }
        else { setClass(el, [RE.bgColor], c ? 'bg-' + c : ''); clearInlineStyle(el, 'background', 'background-color', 'background-image'); }
    },
    parent() {
        const p = selectedEl.parentElement;
        if (p && p !== getScaler()) { stopTextEdit(); selectElement(p); }
    },
    remove() {
        if (isRootBlock(selectedEl)) return;
        const el = selectedEl;
        stopTextEdit();
        clearSelection();
        el.remove();
    },
    duplicate() {
        if (isRootBlock(selectedEl)) return;
        stopTextEdit();
        const el = selectedEl;
        const c = el.cloneNode(true);
        [c, ...c.querySelectorAll(EDIT_ATTRS.map(a => `[${a}]`).join(','))].forEach(n => EDIT_ATTRS.forEach(a => n.removeAttribute(a)));
        // 複製出的圖表使用自己的一份資料，之後各自編輯互不影響
        const slide = currentPresentationData.slides[currentSlideIdx];
        [c, ...c.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
            const spec = slide.charts?.[Number(n.getAttribute('data-rs-chart'))];
            if (!spec) return;
            slide.charts.push(JSON.parse(JSON.stringify(spec)));
            n.setAttribute('data-rs-chart', String(slide.charts.length - 1));
        });
        if (c.hasAttribute('data-rs-float')) {      // 浮動物件錯開位置，避免完全疊在原物件上
            c.style.left = (parseFloat(c.style.left) || 0) + 24 + 'px';
            c.style.top = (parseFloat(c.style.top) || 0) + 24 + 'px';
        }
        el.after(c);
        selectElement(c);
    },
    imgBorder(prop, v) { setImgBorder(selectedEl, prop, v); },
    shapeProp(prop, v) { const s = shapeOf(selectedEl); if (s) setShapeStyle(s, prop, v); },
    resetPos() { setOffset(selectedEl, 0, 0); },
    resetScale() { setScale(selectedEl, 1); },      // 縮放以左上角為基準，還原後左上角位置不變
    moveUp() { moveSibling(-1); },
    moveDown() { moveSibling(1); }
};

function stepSize(dir) {
    const el = selectedEl;
    if (el.hasAttribute('data-rs-icon')) { scaleIcon(el, dir); return; }   // 圖示以外框邊長縮放
    const isChart = el.hasAttribute('data-rs-chart');
    const i = currentSizeIndex(el) + dir;
    if (i < 0 || i > (isChart ? CHART_SIZE_MAX : SIZE_STEPS.length - 1)) return;
    setClass(el, [RE.size], 'text-' + SIZE_STEPS[i]);
    if (isChart) { clearInlineStyle(el, 'font-size'); rerenderChart(el); }   // 圖表是 SVG，字級要重畫才會生效
}
function moveSibling(dir) {
    const el = selectedEl;
    if (isRootBlock(el)) return;
    const other = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!other) return;
    stopTextEdit();
    if (dir < 0) other.before(el); else other.after(el);
}

function runFmt(name, ...args) {
    if (!editMode || !selectedEl || !selectedEl.isConnected) return;
    FMT_ACTIONS[name](...args);
    fmtCommit();
}

/* ----- 圖片邊框 ----- */
// 以 inline style 存在 <img> 上（border-width / style / color），匯出 HTML、PDF、PPTX 都沿用
const IMG_BORDER_WIDTHS = [0, 1, 2, 3, 4, 6, 8, 12, 16];
const IMG_BORDER_STYLES = [['solid', '實線'], ['dashed', '虛線'], ['dotted', '點線']];
const IMG_BORDER_DEFAULT_W = 4;
function readImgBorder(el) {
    const w = parseFloat(el.style.borderWidth) || 0;
    const style = IMG_BORDER_STYLES.some(d => d[0] === el.style.borderStyle) ? el.style.borderStyle : 'solid';
    return { w, style, color: w ? cssColorToHex(el.style.borderColor) : 'none' };
}
// 原本沒有邊框時調了粗細或樣式：預設用投影片的文字顏色，在淺色與深色背景都看得到
function defaultImgBorderColor() {
    const c = cssColorToHex(getComputedStyle(slideRoot() || getScaler()).color);
    return c === 'none' ? '#18181b' : c;
}
function setImgBorder(el, prop, v) {
    let { w, style, color } = readImgBorder(el);
    if (prop === 'color') {
        color = /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : 'none';
        if (color === 'none') w = 0; else if (!w) w = IMG_BORDER_DEFAULT_W;
    } else {
        if (prop === 'width') w = Number(v) || 0;
        else { style = v; if (!w) w = IMG_BORDER_DEFAULT_W; }
        if (w && color === 'none') color = defaultImgBorderColor();
    }
    if (w) Object.assign(el.style, { borderWidth: w + 'px', borderStyle: style, borderColor: color });
    else ['border-width', 'border-style', 'border-color'].forEach(p => el.style.removeProperty(p));
}

/* ----- 浮動工具列 ----- */
const fmtRO = new ResizeObserver(() => positionToolbar());
(function buildToolbar() {
    const tb = document.createElement('div');
    tb.id = 'fmtToolbar';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', '文字與元素格式');
    const btn = (id, icon, title, extra, ctl) => `<button type="button" class="fb ${extra}" data-fmt="${id}" data-ctl="${ctl}" title="${title}" aria-label="${title}">${icon}</button>`;
    // data-ctl：控制項所屬的群組，依選取的元素類型顯示（見 TOOLBAR_CTLS）；分隔線由 refreshToolbar 依可見群組自動隱藏
    tb.innerHTML = `
  ${btn('parent', '<i class="fa-solid fa-turn-up text-[11px]"></i>', '選取父層元素', '', 'parent')}
  <span class="sep"></span>
  ${btn('sizeDown', '<i class="fa-solid fa-minus text-[9px]"></i><span>A</span>', '縮小字級', '', 'size')}
  <span id="fmtSize" data-ctl="size" class="px-1 tabular-nums min-w-[2.2rem] text-center" title="目前字級"></span>
  ${btn('sizeUp', '<span>A</span><i class="fa-solid fa-plus text-[9px]"></i>', '放大字級', '', 'size')}
  <span class="sep"></span>
  <select id="fmtWeight" data-ctl="weight" title="字體粗細" aria-label="字體粗細">${WEIGHTS.map(w => `<option value="${w[0]}">${w[1]}</option>`).join('')}</select>
  <span class="sep"></span>
  ${btn('align-left', '<i class="fa-solid fa-align-left text-[11px]"></i>', '靠左', '', 'align')}
  ${btn('align-center', '<i class="fa-solid fa-align-center text-[11px]"></i>', '置中', '', 'align')}
  ${btn('align-right', '<i class="fa-solid fa-align-right text-[11px]"></i>', '靠右', '', 'align')}
  <span class="sep"></span>
  ${btn('pal-text', '<span class="font-bold">A</span><span id="fmtTextChip" class="chipbox"></span>', '文字顏色', '', 'text')}
  ${btn('pal-bg', '<i class="fa-solid fa-fill-drip text-[11px]"></i><span id="fmtBgChip" class="chipbox"></span>', '背景顏色', '', 'bg')}
  <span class="sep"></span>
  <select id="fmtRadius" data-ctl="radius" title="圓角" aria-label="圓角"><option value="__custom" disabled hidden>圓角</option>${RADII.map(r => `<option value="${r[0]}">圓角：${r[1]}</option>`).join('')}</select>
  <span class="sep"></span>
  ${btn('pal-fill', '<i class="fa-solid fa-fill-drip text-[11px]"></i><span id="fmtFillChip" class="chipbox"></span>', '圖案填滿顏色', 'shape-fill', 'shape')}
  ${btn('pal-stroke', '<i class="fa-regular fa-square text-[11px]"></i><span id="fmtStrokeChip" class="chipbox"></span>', '外框顏色', '', 'shape')}
  <select id="fmtStrokeW" data-ctl="shape" title="外框粗細" aria-label="外框粗細">${SHAPE_STROKE_WIDTHS.map(w => `<option value="${w}">${w ? `外框：${w}px` : '無外框'}</option>`).join('')}</select>
  <select id="fmtShapeRadius" data-ctl="shape" class="shape-radius" title="圖案圓角（轉角倒圓）" aria-label="圖案圓角">${SHAPE_RADII.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
  <select id="fmtDash" data-ctl="shape" title="外框樣式" aria-label="外框樣式">${SHAPE_DASHES.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('')}</select>
  ${btn('pal-border', '<i class="fa-regular fa-square text-[11px]"></i><span id="fmtBorderChip" class="chipbox"></span>', '邊框顏色', '', 'border')}
  <select id="fmtBorderW" data-ctl="border" title="邊框粗細" aria-label="邊框粗細">${IMG_BORDER_WIDTHS.map(w => `<option value="${w}">${w ? `邊框：${w}px` : '無邊框'}</option>`).join('')}</select>
  <select id="fmtBorderStyle" data-ctl="border" title="邊框樣式" aria-label="邊框樣式">${IMG_BORDER_STYLES.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('')}</select>
  <span class="sep"></span>
  ${btn('chart', '<i class="fa-solid fa-chart-column text-[11px]"></i><span>圖表資料</span>', '編輯圖表資料', '', 'chart')}
  <span class="sep"></span>
  ${btn('more', '<i class="fa-solid fa-ellipsis text-[12px]"></i>', '更多操作（複製、排序、還原位置與大小）', 'more-btn', 'common')}
  ${btn('remove', '<i class="fa-regular fa-trash-can text-[11px]"></i>', '刪除元素（Delete）', 'danger', 'common')}`;
    // 工具列固定在投影片上方的編輯列（#fmtDock）內，不會蓋住投影片內容
    document.getElementById('fmtDock').appendChild(tb);
    tb.querySelector('[data-fmt="more"]').setAttribute('aria-haspopup', 'menu');

    // 較少用的操作收在「更多」選單，工具列維持一列
    const more = document.createElement('div');
    more.id = 'fmtMore';
    more.setAttribute('role', 'menu');
    const item = (id, icon, label, ctl, key = '') => `<button type="button" role="menuitem" class="mi" data-fmt="${id}" data-ctl="${ctl}" title="${label}">` +
        `<i class="${icon}"></i><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    more.innerHTML = `
  ${item('duplicate', 'fa-regular fa-clone', '複製元素', 'common', 'Ctrl+D')}
  ${item('moveUp', 'fa-solid fa-arrow-up', '同層上移（往前）', 'common')}
  ${item('moveDown', 'fa-solid fa-arrow-down', '同層下移（往後）', 'common')}
  <div class="msep" data-reset-sep></div>
  ${item('resetPos', 'fa-solid fa-arrows-to-dot', '還原位置', 'resetPos')}
  ${item('resetScale', 'fa-solid fa-compress', '還原大小（100%）', 'resetScale')}`;
    document.body.appendChild(more);
    more.addEventListener('mousedown', e => e.preventDefault());
    more.addEventListener('click', e => {
        const b = e.target.closest('[data-fmt]');
        if (!b || b.disabled) return;
        hideMoreMenu();
        runFmt(b.dataset.fmt);
    });
    [tb, more].forEach(root => root.querySelectorAll('[data-fmt]').forEach(b => { b.dataset.title = b.title; }));   // 依元素類型換提示後可還原

    const pal = document.createElement('div');
    pal.id = 'fmtPalette';
    const chip = (c, label) => `<button type="button" class="pal-chip ${c ? 'bg-' + c : ''}" data-color="${c}" title="${label}" aria-label="${label}"></button>`;
    pal.innerHTML = `
  <div class="flex items-center gap-1 mb-1">
    <button type="button" class="fb text-[11px] px-2 h-6 rounded-md border border-zinc-300 dark:border-zinc-600" data-color="" >預設（移除）</button>
    ${chip('white', 'white')}${chip('black', 'black')}<button type="button" class="pal-chip" data-color="transparent" title="transparent" aria-label="transparent" style="background:linear-gradient(135deg,#fff 45%,#ef4444 45%,#ef4444 55%,#fff 55%)"></button>
  </div>
  ${TW_HUES.map(h => `<div class="pal-row">${TW_SHADES.map(sh => chip(`${h}-${sh}`, `${h}-${sh}`)).join('')}</div>`).join('')}
  <label class="pal-custom"><span>自訂顏色</span><input id="palCustom" type="color" aria-label="自訂顏色"></label>`;
    document.body.appendChild(pal);

    // 按鈕不搶走焦點（維持文字編輯中的游標）；select 例外
    tb.addEventListener('mousedown', e => { if (!e.target.closest('select')) e.preventDefault(); });
    pal.addEventListener('mousedown', e => { if (!e.target.closest('#palCustom')) e.preventDefault(); });
    tb.addEventListener('click', e => {
        const b = e.target.closest('[data-fmt]');
        if (!b || b.disabled) return;
        const id = b.dataset.fmt;
        if (id === 'chart') openChartEditor(selectedEl);
        else if (id === 'more') toggleMoreMenu(b);
        else if (id.startsWith('align-')) runFmt('align', id.slice(6));
        else if (id.startsWith('pal-')) togglePalette(id.slice(4), b);
        else runFmt(id);
    });
    tb.querySelector('#fmtWeight').addEventListener('change', e => runFmt('weight', e.target.value));
    tb.querySelector('#fmtRadius').addEventListener('change', e => runFmt('radius', e.target.value));
    tb.querySelector('#fmtStrokeW').addEventListener('change', e => runFmt('shapeProp', 'strokeW', e.target.value));
    tb.querySelector('#fmtShapeRadius').addEventListener('change', e => runFmt('shapeProp', 'radius', e.target.value));
    tb.querySelector('#fmtDash').addEventListener('change', e => runFmt('shapeProp', 'dash', e.target.value));
    tb.querySelector('#fmtBorderW').addEventListener('change', e => runFmt('imgBorder', 'width', e.target.value));
    tb.querySelector('#fmtBorderStyle').addEventListener('change', e => runFmt('imgBorder', 'style', e.target.value));
    pal.addEventListener('click', e => {
        const c = e.target.closest('[data-color]');
        if (!c) return;
        let v = c.dataset.color;
        // 圖案的填色 / 外框與圖片邊框存實際色碼：從色塊的計算樣式取出；「預設」與透明代表無
        if (HEX_PAL_MODES.includes(palMode)) v = v && v !== 'transparent' ? cssColorToHex(getComputedStyle(c).backgroundColor) : 'none';
        runFmt('color', palMode, v);
        hidePalette();
    });
    // 自訂顏色：文字 / 背景以 Tailwind 任意值 class（text-[#hex]）套用，圖案直接存 HEX
    pal.querySelector('#palCustom').addEventListener('change', e => {
        const hex = e.target.value;
        runFmt('color', palMode, HEX_PAL_MODES.includes(palMode) ? hex : `[${hex}]`);
        hidePalette();
    });
})();

let palMode = 'text';
// 這些色盤模式存實際 HEX 色碼（圖案填色 / 外框、圖片邊框），其餘以 Tailwind class 套用
const HEX_PAL_MODES = ['fill', 'stroke', 'border'];
function togglePalette(mode, anchor) {
    const pal = document.getElementById('fmtPalette');
    if (pal.classList.contains('open') && palMode === mode) { hidePalette(); return; }
    palMode = mode;
    const isHexMode = HEX_PAL_MODES.includes(mode);
    pal.querySelector('[data-color=""]').textContent = isHexMode ? '無' : '預設（移除）';
    const cur = mode === 'border' ? readImgBorder(selectedEl).color
        : isHexMode ? shapeOf(selectedEl)?.getAttribute('data-' + mode) : cssColorToHex(getComputedStyle(selectedEl)[mode === 'text' ? 'color' : 'backgroundColor']);
    pal.querySelector('#palCustom').value = /^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#3b82f6';
    pal.classList.add('open');
    const r = anchor.getBoundingClientRect();
    const h = pal.offsetHeight, w = pal.offsetWidth;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pal.style.top = top + 'px';
    pal.style.left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8) + 'px';
}
// getComputedStyle 的 rgb(r, g, b) → #rrggbb（透明或無法解析時回傳 none）
function cssColorToHex(css) {
    const m = String(css).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?/);
    if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return 'none';
    return '#' + m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('');
}
function hidePalette() { document.getElementById('fmtPalette')?.classList.remove('open'); }

// 工具列或「更多」選單中的按鈕
function fmtEl(id) { return document.querySelector(`#fmtToolbar [data-fmt="${id}"], #fmtMore [data-fmt="${id}"]`); }

function toggleMoreMenu(anchor) {
    const menu = document.getElementById('fmtMore');
    if (menu.classList.contains('open')) { hideMoreMenu(); return; }
    hidePalette();
    menu.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth, h = menu.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    menu.style.top = top + 'px';
    menu.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
}
function hideMoreMenu() {
    document.getElementById('fmtMore')?.classList.remove('open');
    fmtEl('more')?.setAttribute('aria-expanded', 'false');
}

/* 各類元素實際有作用的控制項群組（data-ctl）；parent 與 common（複製、排序、刪除）一律顯示，
 * resetPos / resetScale 只在移動過 / 縮放過的 AI 元素顯示。
 * 圖片：文字類設定對 <img> 無效；背景只在透明圖片看得到，仍保留作為去背圖的底色。
 * 圖示：<i> 的 Font Awesome class 自帶字重、外框固定置中，粗細與對齊無效；字級 ± 為縮放圖示。
 * 圖表：SVG 文字用 currentColor 與固定字重，對齊與粗細看不出差別。 */
const TOOLBAR_CTLS = {
    text: ['size', 'weight', 'align', 'text', 'bg', 'radius'],     // 文字方塊與 AI 版面元素
    image: ['bg', 'radius', 'border'],
    icon: ['size', 'text', 'bg', 'radius'],
    chart: ['size', 'text', 'bg', 'radius', 'chart'],
    shape: ['size', 'weight', 'align', 'text', 'shape'],
};
// 依元素類型替換的按鈕提示（沒列出的沿用預設）
const TOOLBAR_TITLES = {
    image: { 'pal-bg': '背景顏色（透明圖片的底色）' },
    icon: { sizeDown: '縮小圖示', sizeUp: '放大圖示', 'pal-text': '圖示顏色' },
    chart: { sizeDown: '縮小圖表文字', sizeUp: '放大圖表文字', 'pal-text': '標籤與座標軸顏色' },
    shape: { 'pal-text': '圖案文字顏色' },
};
function elementKind(el) {
    if (shapeOf(el)) return 'shape';
    if (el.hasAttribute('data-rs-img')) return 'image';
    if (el.hasAttribute('data-rs-icon')) return 'icon';
    if (el.hasAttribute('data-rs-chart')) return 'chart';
    return 'text';
}
// 只顯示目前元素可用的控制項，並隱藏多餘的分隔線（開頭、結尾與連續的分隔線）
function applyToolbarCtls(tb, kind, extras = []) {
    const show = new Set(['parent', 'common', ...TOOLBAR_CTLS[kind], ...extras]);
    document.querySelectorAll('#fmtToolbar [data-ctl], #fmtMore [data-ctl]').forEach(n => { n.style.display = show.has(n.dataset.ctl) ? '' : 'none'; });
    // 「更多」選單：有還原項目時才顯示分隔線，並在「更多」按鈕加上提示點
    const canReset = extras.length > 0;
    document.querySelector('#fmtMore [data-reset-sep]').style.display = canReset ? '' : 'none';
    fmtEl('more').classList.toggle('has-dot', canReset);
    document.querySelectorAll('#fmtToolbar [data-fmt], #fmtMore [data-fmt]').forEach(b => {
        const t = TOOLBAR_TITLES[kind]?.[b.dataset.fmt] || b.dataset.title;
        b.title = t;
        b.setAttribute('aria-label', t);
    });
    let last = null;
    [...tb.children].forEach(n => {
        if (!n.classList.contains('sep')) { if (n.style.display !== 'none') last = n; return; }
        const visible = !!last && !last.classList.contains('sep');
        n.style.display = visible ? '' : 'none';
        if (visible) last = n;
    });
    if (last?.classList.contains('sep')) last.style.display = 'none';
}

function refreshToolbar() {
    const tb = document.getElementById('fmtToolbar');
    const el = selectedEl;
    if (!editMode || !el || !el.isConnected) { clearSelection(); return; }
    tb.classList.add('open');
    const kind = elementKind(el);
    const cs = getComputedStyle(el);
    const isIcon = kind === 'icon';
    const isChart = kind === 'chart';
    document.getElementById('fmtSize').textContent = isIcon ? el.offsetWidth + 'px' : SIZE_STEPS[currentSizeIndex(el)];
    document.getElementById('fmtWeight').value = currentWeight(el);
    const rad = currentRadius(el);
    const radSel = document.getElementById('fmtRadius');
    radSel.value = rad;
    if (radSel.value !== rad) radSel.value = '__custom';
    const al = currentAlign(el);
    tb.querySelectorAll('[data-fmt^="align-"]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fmt === 'align-' + al)));
    document.getElementById('fmtTextChip').style.background = cs.color;
    const bg = cs.backgroundColor;
    document.getElementById('fmtBgChip').style.background = bg === 'rgba(0, 0, 0, 0)' ? 'transparent' : bg;
    const root = isRootBlock(el);
    const sizeIdx = currentSizeIndex(el);
    fmtEl('parent').disabled = root;
    fmtEl('sizeDown').disabled = isIcon ? el.offsetWidth <= ICON_MIN : sizeIdx <= 0;
    fmtEl('sizeUp').disabled = isIcon ? el.offsetWidth >= ICON_MAX : sizeIdx >= (isChart ? CHART_SIZE_MAX : SIZE_STEPS.length - 1);
    fmtEl('duplicate').disabled = root;
    fmtEl('remove').disabled = root;
    fmtEl('moveUp').disabled = root || !el.previousElementSibling;
    fmtEl('moveDown').disabled = root || !el.nextElementSibling;
    const ai = !isFloat(el);
    applyToolbarCtls(tb, kind, [
        ...(ai && getOffset(el).some(Boolean) ? ['resetPos'] : []),
        ...(ai && getScale(el) !== 1 ? ['resetScale'] : [])
    ]);
    // 圖案：填滿 / 外框；線條沒有填滿，沒有轉角的圖案沒有圓角
    const shape = kind === 'shape' ? shapeOf(el) : null;
    if (shape) {
        const st = readShapeStyle(shape);
        const line = isLineShape(shape);
        tb.querySelector('.shape-fill').style.display = line ? 'none' : '';
        document.getElementById('fmtFillChip').style.background = st.fill === 'none' ? 'transparent' : st.fill;
        document.getElementById('fmtStrokeChip').style.background = st.sw ? st.stroke : 'transparent';
        const swSel = document.getElementById('fmtStrokeW');
        if (![...swSel.options].some(o => Number(o.value) === st.sw)) swSel.add(new Option(`外框：${st.sw}px`, String(st.sw)));
        swSel.value = String(st.sw);
        swSel.querySelector('option[value="0"]').disabled = line;
        document.getElementById('fmtDash').value = st.dash;
        const shapeRadSel = document.getElementById('fmtShapeRadius');
        shapeRadSel.style.display = shapeHasRadius(shape) ? '' : 'none';
        if (![...shapeRadSel.options].some(o => Number(o.value) === st.radius)) shapeRadSel.add(new Option(`圓角：${st.radius}px`, String(st.radius)));
        shapeRadSel.value = String(st.radius);
    }
    if (kind === 'image') {
        const b = readImgBorder(el);
        document.getElementById('fmtBorderChip').style.background = b.w ? b.color : 'transparent';
        const wSel = document.getElementById('fmtBorderW');
        if (![...wSel.options].some(o => Number(o.value) === b.w)) wSel.add(new Option(`邊框：${b.w}px`, String(b.w)));
        wSel.value = String(b.w);
        document.getElementById('fmtBorderStyle').value = b.style;
    }
    positionToolbar();
}

// 工具列固定在投影片上方的編輯列，不需要跟著元素移動；保留這個函式讓拖曳、縮放時同步更新控制點
function positionToolbar() {
    positionFloatBox();
}
document.addEventListener('mousedown', e => {
    if (!e.target.closest('#fmtPalette') && !e.target.closest('[data-fmt^="pal-"]')) hidePalette();
    if (!e.target.closest('#fmtMore') && !e.target.closest('[data-fmt="more"]')) hideMoreMenu();
});
