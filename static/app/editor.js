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
    if (editMode) { prepareEditing(); showToast('單擊選取元素、雙擊編輯文字；插入的文字、圖片、圖表、圖示與圖案可拖曳移動、拉角落縮放（Esc 取消選取，可撤銷）', 'info', 4000); }
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
    shapeProp(prop, v) { const s = shapeOf(selectedEl); if (s) setShapeStyle(s, prop, v); },
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

/* ----- 浮動工具列 ----- */
const fmtRO = new ResizeObserver(() => positionToolbar());
(function buildToolbar() {
    const tb = document.createElement('div');
    tb.id = 'fmtToolbar';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', '文字與元素格式');
    const btn = (id, icon, title, extra = '') => `<button type="button" class="fb ${extra}" data-fmt="${id}" title="${title}" aria-label="${title}">${icon}</button>`;
    tb.innerHTML = `
  ${btn('parent', '<i class="fa-solid fa-turn-up text-[11px]"></i>', '選取父層元素')}
  <span class="sep"></span>
  ${btn('sizeDown', '<i class="fa-solid fa-minus text-[9px]"></i><span>A</span>', '縮小字級')}
  <span id="fmtSize" class="px-1 tabular-nums min-w-[2.2rem] text-center" title="目前字級"></span>
  ${btn('sizeUp', '<span>A</span><i class="fa-solid fa-plus text-[9px]"></i>', '放大字級')}
  <span class="sep"></span>
  <select id="fmtWeight" title="字體粗細" aria-label="字體粗細">${WEIGHTS.map(w => `<option value="${w[0]}">${w[1]}</option>`).join('')}</select>
  <span class="sep"></span>
  ${btn('align-left', '<i class="fa-solid fa-align-left text-[11px]"></i>', '靠左')}
  ${btn('align-center', '<i class="fa-solid fa-align-center text-[11px]"></i>', '置中')}
  ${btn('align-right', '<i class="fa-solid fa-align-right text-[11px]"></i>', '靠右')}
  <span class="sep"></span>
  ${btn('pal-text', '<span class="font-bold">A</span><span id="fmtTextChip" class="chipbox"></span>', '文字顏色')}
  ${btn('pal-bg', '<i class="fa-solid fa-fill-drip text-[11px]"></i><span id="fmtBgChip" class="chipbox"></span>', '背景顏色', 'no-shape')}
  <span class="sep no-shape"></span>
  <select id="fmtRadius" class="no-shape" title="圓角" aria-label="圓角"><option value="__custom" disabled hidden>圓角</option>${RADII.map(r => `<option value="${r[0]}">圓角：${r[1]}</option>`).join('')}</select>
  <span class="sep"></span>
  ${btn('pal-fill', '<i class="fa-solid fa-fill-drip text-[11px]"></i><span id="fmtFillChip" class="chipbox"></span>', '圖案填滿顏色', 'shape-only shape-fill')}
  ${btn('pal-stroke', '<i class="fa-regular fa-square text-[11px]"></i><span id="fmtStrokeChip" class="chipbox"></span>', '外框顏色', 'shape-only')}
  <select id="fmtStrokeW" class="shape-only" title="外框粗細" aria-label="外框粗細">${SHAPE_STROKE_WIDTHS.map(w => `<option value="${w}">${w ? `外框：${w}px` : '無外框'}</option>`).join('')}</select>
  <select id="fmtShapeRadius" class="shape-only shape-radius" title="圖案圓角（轉角倒圓）" aria-label="圖案圓角">${SHAPE_RADII.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
  <select id="fmtDash" class="shape-only" title="外框樣式" aria-label="外框樣式">${SHAPE_DASHES.map(d => `<option value="${d[0]}">${d[1]}</option>`).join('')}</select>
  <span class="sep shape-only"></span>
  ${btn('chart', '<i class="fa-solid fa-chart-column text-[11px]"></i><span>圖表資料</span>', '編輯圖表資料', 'chart-only')}
  <span class="sep chart-only"></span>
  ${btn('duplicate', '<i class="fa-regular fa-clone text-[11px]"></i>', '複製元素')}
  ${btn('moveUp', '<i class="fa-solid fa-arrow-up text-[11px]"></i>', '同層上移（往前）')}
  ${btn('moveDown', '<i class="fa-solid fa-arrow-down text-[11px]"></i>', '同層下移（往後）')}
  ${btn('remove', '<i class="fa-regular fa-trash-can text-[11px]"></i>', '刪除元素（Delete）', 'danger')}`;
    document.body.appendChild(tb);

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
        else if (id.startsWith('align-')) runFmt('align', id.slice(6));
        else if (id.startsWith('pal-')) togglePalette(id.slice(4), b);
        else runFmt(id);
    });
    tb.querySelector('#fmtWeight').addEventListener('change', e => runFmt('weight', e.target.value));
    tb.querySelector('#fmtRadius').addEventListener('change', e => runFmt('radius', e.target.value));
    tb.querySelector('#fmtStrokeW').addEventListener('change', e => runFmt('shapeProp', 'strokeW', e.target.value));
    tb.querySelector('#fmtShapeRadius').addEventListener('change', e => runFmt('shapeProp', 'radius', e.target.value));
    tb.querySelector('#fmtDash').addEventListener('change', e => runFmt('shapeProp', 'dash', e.target.value));
    pal.addEventListener('click', e => {
        const c = e.target.closest('[data-color]');
        if (!c) return;
        let v = c.dataset.color;
        // 圖案的填色 / 外框存實際色碼：從色塊的計算樣式取出；「預設」與透明代表無
        if (palMode === 'fill' || palMode === 'stroke') v = v && v !== 'transparent' ? cssColorToHex(getComputedStyle(c).backgroundColor) : 'none';
        runFmt('color', palMode, v);
        hidePalette();
    });
    // 自訂顏色：文字 / 背景以 Tailwind 任意值 class（text-[#hex]）套用，圖案直接存 HEX
    pal.querySelector('#palCustom').addEventListener('change', e => {
        const hex = e.target.value;
        runFmt('color', palMode, palMode === 'fill' || palMode === 'stroke' ? hex : `[${hex}]`);
        hidePalette();
    });
})();

let palMode = 'text';
function togglePalette(mode, anchor) {
    const pal = document.getElementById('fmtPalette');
    if (pal.classList.contains('open') && palMode === mode) { hidePalette(); return; }
    palMode = mode;
    const isShapeMode = mode === 'fill' || mode === 'stroke';
    pal.querySelector('[data-color=""]').textContent = isShapeMode ? '無' : '預設（移除）';
    const cur = isShapeMode ? shapeOf(selectedEl)?.getAttribute('data-' + mode) : cssColorToHex(getComputedStyle(selectedEl)[mode === 'text' ? 'color' : 'backgroundColor']);
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

function refreshToolbar() {
    const tb = document.getElementById('fmtToolbar');
    const el = selectedEl;
    if (!editMode || !el || !el.isConnected) { clearSelection(); return; }
    tb.classList.add('open');
    const cs = getComputedStyle(el);
    const isIcon = el.hasAttribute('data-rs-icon');
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
    tb.querySelector('[data-fmt="parent"]').disabled = root;
    tb.querySelector('[data-fmt="sizeDown"]').disabled = isIcon ? el.offsetWidth <= ICON_MIN : sizeIdx <= 0;
    tb.querySelector('[data-fmt="sizeUp"]').disabled = isIcon ? el.offsetWidth >= ICON_MAX : sizeIdx >= (el.hasAttribute('data-rs-chart') ? CHART_SIZE_MAX : SIZE_STEPS.length - 1);
    tb.querySelector('[data-fmt="duplicate"]').disabled = root;
    tb.querySelector('[data-fmt="remove"]').disabled = root;
    tb.querySelector('[data-fmt="moveUp"]').disabled = root || !el.previousElementSibling;
    tb.querySelector('[data-fmt="moveDown"]').disabled = root || !el.nextElementSibling;
    const isChart = el.hasAttribute('data-rs-chart');
    tb.querySelectorAll('.chart-only').forEach(n => n.style.display = isChart ? '' : 'none');
    // 圖案：以填滿 / 外框控制取代背景與圓角；線條沒有填滿
    const shape = shapeOf(el);
    tb.querySelectorAll('.no-shape').forEach(n => n.style.display = shape ? 'none' : '');
    tb.querySelectorAll('.shape-only').forEach(n => n.style.display = shape ? '' : 'none');
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
    positionToolbar();
}

// 工具列固定在視窗座標：優先放在元素上方，放不下就改放下方
function positionToolbar() {
    positionFloatBox();
    const tb = document.getElementById('fmtToolbar');
    if (!tb || !selectedEl || !tb.classList.contains('open')) return;
    const r = selectedEl.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) { tb.style.visibility = 'hidden'; return; }
    tb.style.visibility = 'visible';
    const w = tb.offsetWidth, h = tb.offsetHeight;
    let top = r.top - h - 8;
    if (top < 8) top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, Math.min(r.top + 8, window.innerHeight - h - 8));
    tb.style.top = top + 'px';
    tb.style.left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - w - 8)) + 'px';
}
document.addEventListener('mousedown', e => {
    if (!e.target.closest('#fmtPalette') && !e.target.closest('[data-fmt^="pal-"]')) hidePalette();
});
