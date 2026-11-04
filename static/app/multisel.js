/* 多選元素：Shift（或 Ctrl / ⌘）+ 點擊加入或移除、在投影片上拖曳框選，選取 2 個以上時可一次交給 AI 修改（aiedit.js）
 * 多選只用於「AI 修改」：格式工具列、移動與縮放仍針對單一元素（selectedEl），兩者互斥。
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 editor.js、media.js、aiedit.js 之後）。 */
const MAX_MULTI_SELECT = 8;       // 與 app.py 的 MAX_MULTI_ELEMENTS 一致
let multiSel = [];

function isMultiSel() { return multiSel.length >= 2; }

function clearMultiSel() {
    if (!multiSel.length) return;
    multiSel.forEach(el => el.removeAttribute('data-rs-msel'));
    multiSel = [];
    updateMultiSelBar();
}

// 依文件順序排列（AI 收到的編號即閱讀順序），並移除被其他已選元素包住的元素
function normalizeSelection(els) {
    const uniq = [...new Set(els)].filter(el => el?.isConnected);
    return uniq.filter(el => !uniq.some(o => o !== el && o.contains(el)))
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

function setMultiSel(els) {
    let list = normalizeSelection(els);
    if (list.length > MAX_MULTI_SELECT) {
        showToast(`一次最多選取 ${MAX_MULTI_SELECT} 個元素交給 AI 修改`, 'info', 2600);
        list = list.slice(0, MAX_MULTI_SELECT);
    }
    clearSelection();             // 會一併清除舊的多選
    if (list.length === 1) { selectElement(list[0]); return; }
    if (!list.length) return;
    multiSel = list;
    multiSel.forEach(el => el.setAttribute('data-rs-msel', '1'));
    updateMultiSelBar();
}

function updateMultiSelBar() {
    const bar = document.getElementById('multiSelBar');
    if (!bar) return;
    const on = editMode && isMultiSel();
    bar.hidden = !on;
    if (!on) return;
    document.getElementById('multiSelCount').textContent = `已選取 ${multiSel.length} 個元素`;
    document.getElementById('multiSelAiBtn').disabled = aiEditBusy;
}

// 點擊位置對應的「第一次點擊會選到的元素」（最外層看得到外框的區塊），與一般單擊的規則相同
function firstClickTarget(t) {
    const keep = selectedEl;
    selectedEl = null;
    try { return pickSelectTarget(t); } finally { selectedEl = keep; }
}
function normalizeClickTarget(t) {
    const scaler = getScaler();
    const svg = t.closest('svg');
    if (svg && svg !== t && scaler.contains(svg)) t = svg;
    const obj = t.closest('[data-rs-chart],[data-rs-float]');
    if (obj && scaler.contains(obj)) t = obj;
    return t;
}
function currentSelectionList() {
    if (isMultiSel()) return [...multiSel];
    return selectedEl && canAiEditGroup(selectedEl) ? [selectedEl] : [];
}

/* ----- Shift / Ctrl / ⌘ + 點擊：加入或移除 ----- */
// capture：比 editor.js 的單擊選取先處理，處理後不再往下傳
slideCanvasEl.addEventListener('click', e => {
    if (!editMode || editingEl || painterClip || !(e.shiftKey || e.ctrlKey || e.metaKey)) return;
    const scaler = getScaler();
    if (!scaler || !scaler.contains(e.target) || e.target === scaler) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const t = normalizeClickTarget(e.target);
    const base = currentSelectionList();
    const hit = base.find(m => m.contains(t));
    if (hit) { setMultiSel(base.filter(m => m !== hit)); return; }
    const target = firstClickTarget(t);
    if (!canAiEditGroup(target)) {
        showToast('多選只支援文字、卡片與圖表（整頁容器、圖片、圖示與圖案除外）', 'info', 3000);
        return;
    }
    setMultiSel([...base.filter(m => !target.contains(m) && !m.contains(target)), target]);
}, true);

/* ----- 拖曳框選 ----- */
// 在沒有選取的位置按住拖曳即可框選（拖曳已選取的元素仍是移動）；完全落在框內的元素會被選取。按住 Shift 框選可加入原本的選取。
const MARQUEE_MIN = 5;            // 螢幕像素：拖動超過才算框選，保留單擊與雙擊
let marquee = null;
const marqueeEl = document.createElement('div');
marqueeEl.id = 'marqueeBox';
marqueeEl.hidden = true;
document.body.appendChild(marqueeEl);

slideCanvasEl.addEventListener('pointerdown', e => {
    if (!editMode || editingEl || painterClip || e.button !== 0 || offsetDrag) return;
    const scaler = getScaler();
    if (!scaler || !scaler.contains(e.target)) return;
    if (e.target.closest('[data-rs-float]') || e.target.closest('#floatBox')) return;            // 浮動物件：拖曳移動
    if (selectedEl && selectedEl.contains(e.target) && canOffset(selectedEl)) return;          // 已選取的元素：拖曳移動
    marquee = { sx: e.clientX, sy: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, moved: false };
    window.addEventListener('pointermove', onMarqueeMove);
    window.addEventListener('pointerup', endMarquee, { once: true });
    window.addEventListener('pointercancel', cancelMarquee, { once: true });
});

function marqueeRect(e, m = marquee) {
    return { left: Math.min(m.sx, e.clientX), top: Math.min(m.sy, e.clientY), right: Math.max(m.sx, e.clientX), bottom: Math.max(m.sy, e.clientY) };
}
function onMarqueeMove(e) {
    const m = marquee;
    if (!m) return;
    if (!m.moved && Math.abs(e.clientX - m.sx) + Math.abs(e.clientY - m.sy) < MARQUEE_MIN) return;
    if (!m.moved) {
        m.moved = true;
        document.body.classList.add('rs-marquee');
        window.getSelection()?.removeAllRanges();
    }
    const r = marqueeRect(e);
    Object.assign(marqueeEl.style, { left: r.left + 'px', top: r.top + 'px', width: (r.right - r.left) + 'px', height: (r.bottom - r.top) + 'px' });
    marqueeEl.hidden = false;
}
function stopMarqueeListeners() {
    window.removeEventListener('pointermove', onMarqueeMove);
    window.removeEventListener('pointerup', endMarquee);
    window.removeEventListener('pointercancel', cancelMarquee);
    marqueeEl.hidden = true;
    document.body.classList.remove('rs-marquee');
}
function cancelMarquee() { stopMarqueeListeners(); marquee = null; }
function endMarquee(e) {
    const m = marquee;
    stopMarqueeListeners();
    marquee = null;
    if (!m || !m.moved || !editMode) return;
    suppressNextClick = true;                 // media.js：放開後的 click 不要再當成單擊選取
    setTimeout(() => { suppressNextClick = false; }, 0);
    const found = elementsInRect(marqueeRect(e, m));
    setMultiSel(m.add ? [...currentSelectionList().filter(a => !found.some(b => a.contains(b) || b.contains(a))), ...found] : found);
}

// 框選的候選：可交給 AI 修改，且是「看得到外框的區塊、有文字的元素或圖表」（略過沒有外框的排版容器，與單擊的規則一致）
function elementsInRect(r) {
    const root = slideRoot();
    if (!root) return [];
    const tol = 2;
    const hits = [...root.querySelectorAll('*')].filter(el => {
        if (el === root || !canAiEditGroup(el)) return false;
        if (el.parentElement.closest('svg') || el.parentElement.closest('[data-rs-chart]')) return false;
        if (!(isVisualBox(el) || hasOwnText(el) || el.hasAttribute('data-rs-chart') || el.hasAttribute('data-rs-text'))) return false;
        const b = el.getBoundingClientRect();
        if (b.width < 4 || b.height < 4) return false;
        return b.left >= r.left - tol && b.top >= r.top - tol && b.right <= r.right + tol && b.bottom <= r.bottom + tol;
    });
    return normalizeSelection(hits);
}
