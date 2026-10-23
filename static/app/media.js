/* 圖片、文字方塊、圖示、浮動物件拖曳縮放、圖表資料編輯
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 圖片與圖表 ===================== */
// 圖片以 data URL 內嵌在 html_content（不經伺服器、不需外部資源，sanitizeSlideHtml 本來就允許 data:image/png|jpeg）；
// 圖表為 static/charts.js 畫出的靜態 SVG，資料存在 slide.charts，容器以 data-rs-chart 指向索引。
// 使用者插入的圖片 / 圖表為絕對定位的「浮動物件」（data-rs-float），可拖曳移動、拉角落縮放。
const IMG_MAX_INPUT = 15 * 1024 * 1024;
const IMG_MAX_SIDE = 1600;
const IMG_MAX_DATA_URL = 3 * 1024 * 1024;
const SLIDE_W = 1024, SLIDE_H = 576;

// 重產單頁時送給 LLM 的版本：圖片換成 rs-img:N 代號、圖表容器清空
function slimSlidesForLlm(slides) {
    const images = [];
    const out = slides.map(s => {
        const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${s.html_content || ''}</body></html>`, 'text/html');
        doc.querySelectorAll('[data-rs-chart]').forEach(el => { el.innerHTML = ''; });
        doc.querySelectorAll('img[src^="data:"]').forEach(img => {
            images.push(img.getAttribute('src'));
            img.setAttribute('src', 'rs-img:' + (images.length - 1));
            img.setAttribute('data-rs-img', '');
        });
        return { ...withoutVersions(s), html_content: doc.body.innerHTML, charts: s.charts || [] };
    });
    return { slides: out, images };
}
function restoreSlideImages(html, images) {
    if (!/rs-img:/.test(html || '')) return html;
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
    doc.querySelectorAll('img[src^="rs-img:"]').forEach(img => {
        img.setAttribute('src', images[Number(img.getAttribute('src').slice(7))] || EXPORT_PLACEHOLDER_IMG);
    });
    return doc.body.innerHTML;
}

// 浮動物件放在投影片最外層容器（LLM 依規範產生 w-full h-full 的單一根元素）內；
// 定位基準是 .slide-scaler（position: relative，與根元素同為 1024×576），匯出時也相同
function slideRoot() {
    const scaler = getScaler();
    if (!scaler) return null;
    const root = scaler.firstElementChild;
    return root && scaler.children.length === 1 ? root : scaler;
}
function slideScale() { return document.getElementById('slideCanvas').clientWidth / SLIDE_W; }

/* ----- 插入圖片 ----- */
function pickSlideImage() {
    if (!editMode) return;
    const input = document.getElementById('slideImageInput');
    input.value = '';
    input.click();
}
document.getElementById('slideImageInput').addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) insertSlideImage(f);
});

function loadImageElement(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('無法讀取這張圖片'));
        img.src = url;
    });
}

// 縮到最長邊 1600px 並重新編碼：PNG / GIF / WebP / SVG 保留透明（PNG），太大或照片類改 JPEG
async function compressImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await loadImageElement(url);
        let w = img.naturalWidth || 800, h = img.naturalHeight || 600;
        const k = Math.min(1, IMG_MAX_SIDE / Math.max(w, h));
        w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        const keepAlpha = file.type !== 'image/jpeg';
        if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
        ctx.drawImage(img, 0, 0, w, h);
        let data = keepAlpha ? c.toDataURL('image/png') : '';
        if (!data || data.length > IMG_MAX_DATA_URL / 2) {
            // 照片存成 PNG 會很大：鋪白底後改存 JPEG
            const j = document.createElement('canvas');
            j.width = w; j.height = h;
            const jctx = j.getContext('2d');
            jctx.fillStyle = '#fff'; jctx.fillRect(0, 0, w, h);
            jctx.drawImage(c, 0, 0);
            data = j.toDataURL('image/jpeg', 0.85);
        }
        if (data.length > IMG_MAX_DATA_URL) throw new Error('圖片壓縮後仍過大，請換一張較小的圖片');
        return { data, w, h };
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function insertSlideImage(file, at) {
    if (!editMode || !currentPresentationData) return;
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) { showToast('只支援 PNG、JPG、WebP、GIF、SVG 圖片', 'error'); return; }
    if (file.size > IMG_MAX_INPUT) { showToast('圖片過大（上限 15 MB）', 'error'); return; }
    const slideIdx = currentSlideIdx;
    let result;
    try { result = await compressImage(file); }
    catch (err) { showToast(err.message || '無法讀取這張圖片', 'error'); return; }
    if (!editMode || slideIdx !== currentSlideIdx) return;   // 處理期間已換頁或離開編輯
    const root = slideRoot();
    if (!root) return;
    stopTextEdit();
    // 預設寬度約 40% 版面，太高時以高度為準
    let w = Math.min(result.w, SLIDE_W * 0.4), h = w * result.h / result.w;
    if (h > SLIDE_H * 0.6) { h = SLIDE_H * 0.6; w = h * result.w / result.h; }
    let x = (SLIDE_W - w) / 2, y = (SLIDE_H - h) / 2;
    if (at) { x = at.x - w / 2; y = at.y - h / 2; }
    const img = document.createElement('img');
    img.src = result.data;
    img.alt = file.name.replace(/\.[^.]+$/, '').slice(0, 80);
    img.setAttribute('data-rs-img', '');
    img.setAttribute('data-rs-float', '');
    img.setAttribute('draggable', 'false');
    setFloatRect(img, x, y, w, null);
    img.style.zIndex = '10';
    img.style.objectFit = 'contain';
    root.appendChild(img);
    commitSlideEdit();
    selectElement(img);
    showToast('已插入圖片，可拖曳移動、拉角落調整大小', 'success', 2200);
}

// 拖放 / 貼上圖片到投影片（僅編輯模式）
slideCanvasEl.addEventListener('dragover', e => {
    if (!editMode || ![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    slideCanvasEl.classList.add('drop-target');
});
slideCanvasEl.addEventListener('dragleave', () => slideCanvasEl.classList.remove('drop-target'));
slideCanvasEl.addEventListener('drop', e => {
    slideCanvasEl.classList.remove('drop-target');
    if (!editMode) return;
    const f = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    const r = slideCanvasEl.getBoundingClientRect(), s = slideScale();
    insertSlideImage(f, { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s });
});
slideCanvasEl.addEventListener('dragstart', e => { if (editMode) e.preventDefault(); });
// 貼上：剪貼簿有圖片時插入圖片；否則若剪貼簿仍是從投影片複製的浮動物件（見 copyFloat），貼上該物件
document.addEventListener('paste', e => {
    if (!editMode || editingEl || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (document.getElementById('sectionPlayer').classList.contains('hidden')) return;
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); insertSlideImage(f); return; }
    if (floatClip && e.clipboardData?.getData('text/plain') === floatClip.text) { e.preventDefault(); pasteFloat(); }
});

/* ----- 插入文字方塊 ----- */
// 與圖片相同的浮動物件，可拖曳移動、拉角落調整寬度；格式（字級、粗細、對齊、顏色）沿用浮動工具列
function insertTextBox() {
    if (!editMode || !currentPresentationData) return;
    const root = slideRoot();
    if (!root) return;
    stopTextEdit();
    const w = 360;
    const el = document.createElement('div');
    el.setAttribute('data-rs-text', '');
    el.setAttribute('data-rs-float', '');
    el.className = 'text-2xl font-semibold leading-snug';
    el.textContent = '輸入文字';
    setFloatRect(el, (SLIDE_W - w) / 2, SLIDE_H / 2 - 24, w, null);
    el.style.zIndex = '10';
    el.style.whiteSpace = 'pre-wrap';
    root.appendChild(el);
    startTextEdit(el, 0, 0);
    // 預設文字全選，直接輸入即可取代
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

/* ----- 插入圖示 ----- */
// 清單在 static/icons.js（RS_ICON_GROUPS）；圖示為 Font Awesome 字型，以浮動物件外框（data-rs-icon）包住 <i>，
// 外框固定為正方形、字級隨邊長調整；顏色、背景、圓角沿用格式工具列（套在外框上，<i> 繼承文字顏色）
const ICON_DEFAULT = 96, ICON_MIN = 16, ICON_MAX = 480;
function iconFontPx(size) { return Math.round(size * 0.75) + 'px'; }
function setIconBox(el, x, y, size) {
    setFloatRect(el, x, y, size, size);
    Object.assign(el.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: '1', fontSize: iconFontPx(size) });
}

function insertSlideIcon(name) {
    if (!editMode || !currentPresentationData) return;
    const root = slideRoot();
    if (!root) return;
    stopTextEdit();
    const el = document.createElement('div');
    el.setAttribute('data-rs-icon', '');
    el.setAttribute('data-rs-float', '');
    const i = document.createElement('i');
    i.className = 'fa-solid fa-' + name;
    i.setAttribute('aria-hidden', 'true');
    el.appendChild(i);
    // 連續插入時錯開位置，避免疊在一起
    const n = root.querySelectorAll(':scope > [data-rs-icon]').length % 6;
    setIconBox(el, (SLIDE_W - ICON_DEFAULT) / 2 + n * 24, (SLIDE_H - ICON_DEFAULT) / 2 + n * 24, ICON_DEFAULT);
    el.style.zIndex = '10';
    root.appendChild(el);
    commitSlideEdit();
    selectElement(el);
}

// 格式工具列的放大 / 縮小：圖示以外框邊長縮放（±25%），中心點不動
function scaleIcon(el, dir) {
    const r = floatRect(el);
    const size = Math.min(ICON_MAX, Math.max(ICON_MIN, Math.round(r.w * (dir > 0 ? 1.25 : 0.8))));
    setIconBox(el, r.x + (r.w - size) / 2, r.y + (r.h - size) / 2, size);
}

(function buildIconPicker() {
    const grid = document.getElementById('iconGrid');
    // 搜尋字串：圖示名稱（含以空白分隔的版本）、關鍵字、分組中英文名稱
    const entries = [];
    grid.innerHTML = RS_ICON_GROUPS.map((g, gi) => `
        <section class="icon-group" data-group="${gi}">
            <h4 class="icon-group-title">${esc(g.name)}<span>${esc(g.en)}</span></h4>
            <div class="icon-grid">${g.icons.map(([name, kw]) => {
        entries.push({ name, group: gi, hay: `${name} ${name.replace(/-/g, ' ')} ${kw} ${g.name} ${g.en}`.toLowerCase() });
        return `<button type="button" class="icon-cell" data-icon="${name}" title="${name}" aria-label="${name}"><i class="fa-solid fa-${name}" aria-hidden="true"></i></button>`;
    }).join('')}</div>
        </section>`).join('') + '<p id="iconEmpty" class="hidden py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">找不到符合的圖示，試試其他關鍵字</p>';
    const cells = [...grid.querySelectorAll('.icon-cell')];
    const sections = [...grid.querySelectorAll('.icon-group')];

    // 多個關鍵字以空白分隔，需全部符合
    function filterIcons() {
        const terms = document.getElementById('iconSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
        const visible = new Set();
        let count = 0;
        entries.forEach((e, i) => {
            const ok = terms.every(t => e.hay.includes(t));
            cells[i].classList.toggle('hidden', !ok);
            if (ok) { count++; visible.add(e.group); }
        });
        sections.forEach((s, gi) => s.classList.toggle('hidden', !visible.has(gi)));
        document.getElementById('iconEmpty').classList.toggle('hidden', count > 0);
        document.getElementById('iconCount').textContent = terms.length ? `找到 ${count} 個圖示` : `共 ${entries.length} 個圖示`;
    }
    filterIcons();

    const search = document.getElementById('iconSearch');
    search.addEventListener('input', () => { filterIcons(); grid.scrollTop = 0; });
    search.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const first = cells.find(c => !c.classList.contains('hidden'));
            if (first) pickIcon(first.dataset.icon);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            cells.find(c => !c.classList.contains('hidden'))?.focus();
        }
    });
    grid.addEventListener('click', e => {
        const c = e.target.closest('.icon-cell');
        if (c) pickIcon(c.dataset.icon);
    });
    // 方向鍵在可見的圖示間移動（一列 10 個）
    grid.addEventListener('keydown', e => {
        const i = cells.indexOf(document.activeElement);
        if (i < 0) return;
        const vis = cells.filter(c => !c.classList.contains('hidden'));
        const k = vis.indexOf(cells[i]);
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 }[e.key];
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();                      // 避免觸發全域的換頁快捷鍵
        if (k + step < 0) { search.focus(); return; }
        vis[Math.min(vis.length - 1, k + step)]?.focus();
    });
    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#iconPicker') && !e.target.closest('#iconPickerBtn')) closeIconPicker();
    });

    function pickIcon(name) {
        closeIconPicker();
        insertSlideIcon(name);
    }
})();

function isIconPickerOpen() { return !document.getElementById('iconPicker').classList.contains('hidden'); }
function toggleIconPicker() {
    if (isIconPickerOpen()) { closeIconPicker(); return; }
    if (!editMode || !currentPresentationData) return;
    stopTextEdit();
    document.getElementById('iconPicker').classList.remove('hidden');
    document.getElementById('iconPickerBtn').setAttribute('aria-expanded', 'true');
    positionIconPicker();
    const search = document.getElementById('iconSearch');
    search.focus();
    search.select();
}
function closeIconPicker() {
    const panel = document.getElementById('iconPicker');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    document.getElementById('iconPickerBtn').setAttribute('aria-expanded', 'false');
}
// 面板固定在視窗座標：工具列在投影片下方，空間夠就往上開，否則往下開
function positionIconPicker() {
    if (!isIconPickerOpen()) return;
    const panel = document.getElementById('iconPicker');
    const r = document.getElementById('iconPickerBtn').getBoundingClientRect();
    const w = Math.min(460, window.innerWidth - 16);
    const above = r.top - 16, below = window.innerHeight - r.bottom - 16;
    const up = above >= Math.min(420, below);
    const h = Math.min(520, Math.max(220, up ? above : below));
    panel.style.width = w + 'px';
    panel.style.height = h + 'px';
    panel.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
    panel.style.top = (up ? Math.max(8, r.top - 8 - h) : r.bottom + 8) + 'px';
}

/* ----- 浮動物件：移動與縮放 ----- */
function setFloatRect(el, x, y, w, h) {
    Object.assign(el.style, { position: 'absolute', left: Math.round(x) + 'px', top: Math.round(y) + 'px', width: Math.round(w) + 'px' });
    el.style.height = h == null ? 'auto' : Math.round(h) + 'px';
}
function floatRect(el) {
    return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0, w: el.offsetWidth, h: el.offsetHeight };
}
function isFloat(el) { return !!el && el.hasAttribute('data-rs-float') && el.style.position === 'absolute'; }

(function buildFloatBox() {
    const box = document.createElement('div');
    box.id = 'floatBox';
    box.innerHTML = ['nw', 'ne', 'sw', 'se'].map(h => `<span class="fh" data-h="${h}"></span>`).join('') + '<span class="fsize"></span>';
    document.body.appendChild(box);
    box.addEventListener('pointerdown', e => {
        const h = e.target.closest('.fh');
        if (h) startFloatDrag(e, h.dataset.h);
    });
})();

function positionFloatBox() {
    const box = document.getElementById('floatBox');
    if (!box) return;
    if (!editMode || !isFloat(selectedEl) || !selectedEl.isConnected) { box.classList.remove('open'); return; }
    const r = selectedEl.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    box.querySelector('.fsize').textContent = `${selectedEl.offsetWidth} × ${selectedEl.offsetHeight}`;
    box.classList.add('open');
}

let floatDrag = null;
function startFloatDrag(e, handle) {
    const el = selectedEl;
    if (!editMode || !isFloat(el) || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    stopTextEdit();
    floatDrag = { el, handle, sx: e.clientX, sy: e.clientY, r: floatRect(el), s: slideScale(), moved: false, keepRatio: el.hasAttribute('data-rs-img') || el.hasAttribute('data-rs-icon'), snap: collectSnapTargets(el) };
    e.target.setPointerCapture?.(e.pointerId);
    e.target.addEventListener('pointermove', onFloatDragMove);
    e.target.addEventListener('pointerup', endFloatDrag, { once: true });
    e.target.addEventListener('pointercancel', endFloatDrag, { once: true });
}
// 移動：至少保留 24px 在投影片內，避免拖出畫面找不回來
const FLOAT_KEEP = 24;
function clampFloatPos(x, y, w, h) {
    return [Math.min(Math.max(x, FLOAT_KEEP - w), SLIDE_W - FLOAT_KEEP), Math.min(Math.max(y, FLOAT_KEEP - h), SLIDE_H - FLOAT_KEEP)];
}
function onFloatDragMove(e) {
    const d = floatDrag;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.s, dy = (e.clientY - d.sy) / d.s;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    d.moved = true;
    const { x, y, w, h } = d.r;
    const MIN = 24;
    const snapOn = !e.altKey;                     // 按住 Alt 暫時關閉吸附
    const th = SNAP_PX / d.s;
    const guides = { x: [], y: [] };
    if (!d.handle) {
        let nx = x + dx, ny = y + dy;
        if (snapOn) {
            // 物件的左 / 中 / 右（上 / 中 / 下）任一條線靠近參考線時對齊過去
            const sx = snapAxis([nx, nx + w / 2, nx + w], d.snap.x, th);
            const sy = snapAxis([ny, ny + h / 2, ny + h], d.snap.y, th);
            nx += sx.delta; ny += sy.delta;
            guides.x = sx.lines; guides.y = sy.lines;
        }
        [nx, ny] = clampFloatPos(nx, ny, w, h);
        d.el.style.left = Math.round(nx) + 'px';
        d.el.style.top = Math.round(ny) + 'px';
    } else {
        const west = d.handle.includes('w'), north = d.handle.includes('n');
        let nw = Math.max(MIN, w + (west ? -dx : dx));
        let nh = Math.max(MIN, h + (north ? -dy : dy));
        const isText = d.el.hasAttribute('data-rs-text');                 // 文字方塊只調寬度，高度隨文字
        const autoH = isText || d.el.hasAttribute('data-rs-img');
        if (snapOn) {
            // 只吸附正在拖動的那一側邊線；等比縮放與文字方塊的高度由寬度決定，不另外吸附
            const sx = snapAxis([west ? x + w - nw : x + nw], d.snap.x, th);
            nw = Math.max(MIN, nw + (west ? -sx.delta : sx.delta));
            guides.x = sx.lines;
            if (!d.keepRatio && !autoH) {
                const sy = snapAxis([north ? y + h - nh : y + nh], d.snap.y, th);
                nh = Math.max(MIN, nh + (north ? -sy.delta : sy.delta));
                guides.y = sy.lines;
            }
        }
        if (d.keepRatio) nh = nw * h / w;
        if (isText) nh = h;
        // 從左 / 上方的控制點縮放時，對側固定不動
        setFloatRect(d.el, west ? x + w - nw : x, north ? y + h - nh : y, nw, autoH ? null : nh);
        if (d.el.hasAttribute('data-rs-icon')) d.el.style.fontSize = iconFontPx(nw);
        if (d.el.hasAttribute('data-rs-shape')) renderShape(d.el);       // 圖案依新尺寸重畫，外框粗細不變形
    }
    showSnapGuides(guides);
    positionToolbar();
}
function endFloatDrag(e) {
    e.target.removeEventListener('pointermove', onFloatDragMove);
    showSnapGuides(null);
    const d = floatDrag;
    floatDrag = null;
    if (!d || !d.moved) return;
    suppressNextClick = true;                 // 只吞掉緊接在放開滑鼠後的那次 click
    setTimeout(() => { suppressNextClick = false; }, 0);
    if (d.handle && d.el.hasAttribute('data-rs-chart')) rerenderChart(d.el);  // 依新尺寸重畫，文字不變形
    commitSlideEdit();
    refreshToolbar();
}
let suppressNextClick = false;
slideCanvasEl.addEventListener('pointerdown', e => {
    if (!editMode || editingEl) return;
    const obj = e.target.closest('[data-rs-float]');
    if (!obj || !getScaler()?.contains(obj) || !isFloat(obj)) return;
    if (selectedEl !== obj) selectElement(obj);
    startFloatDrag(e, null);
});
// 拖曳結束後的 click 不要重新觸發選取（避免工具列閃動）
slideCanvasEl.addEventListener('click', e => {
    if (suppressNextClick) { suppressNextClick = false; e.stopImmediatePropagation(); e.preventDefault(); }
}, true);

/* ----- 對齊參考線與吸附 ----- */
// 參考線：投影片的四邊與中線，以及其他元素（浮動物件、版面的前兩層區塊）的邊緣與中線；
// 拖曳開始時量一次，座標為投影片座標（1024×576）
const SNAP_PX = 6;                                // 吸附距離（螢幕像素）
function collectSnapTargets(el) {
    const xs = [0, SLIDE_W / 2, SLIDE_W], ys = [0, SLIDE_H / 2, SLIDE_H];
    const scaler = getScaler(), root = slideRoot();
    if (!scaler || !root) return { x: xs, y: ys };
    const sr = scaler.getBoundingClientRect(), s = slideScale();
    const scope = root === scaler ? ':scope > *, :scope > * > *' : ':scope > *, :scope > * > *, :scope > * > * > *';
    root.querySelectorAll(scope).forEach(n => {
        if (n === el || el.contains(n) || n.contains(el) || n.closest('svg')) return;
        const r = n.getBoundingClientRect();
        const x = (r.left - sr.left) / s, y = (r.top - sr.top) / s, w = r.width / s, h = r.height / s;
        if (w < 8 || h < 8 || (w >= SLIDE_W - 1 && h >= SLIDE_H - 1)) return;   // 太小或滿版的容器沒有參考價值
        xs.push(x, x + w / 2, x + w);
        ys.push(y, y + h / 2, y + h);
    });
    return { x: xs, y: ys };
}
// 回傳最接近的吸附位移，以及吸附後對齊到的參考線（可能同時對齊多條）
function snapAxis(cands, targets, th) {
    let delta = null;
    cands.forEach(c => targets.forEach(t => {
        const d = t - c;
        if (Math.abs(d) <= th && (delta === null || Math.abs(d) < Math.abs(delta))) delta = d;
    }));
    if (delta === null) return { delta: 0, lines: [] };
    const lines = [...new Set(targets.filter(t => cands.some(c => Math.abs(c + delta - t) < 0.5)).map(t => Math.round(t)))];
    return { delta, lines };
}
// 參考線畫在 body 層的固定定位容器（不在投影片內，不會被存進 html_content）
const snapGuidesEl = document.createElement('div');
snapGuidesEl.id = 'snapGuides';
document.body.appendChild(snapGuidesEl);
function showSnapGuides(g) {
    if (!g || (!g.x.length && !g.y.length)) { snapGuidesEl.replaceChildren(); return; }
    const r = slideCanvasEl.getBoundingClientRect(), s = slideScale();
    snapGuidesEl.innerHTML = g.x.map(x => `<span class="sg-v" style="left:${r.left + x * s}px;top:${r.top}px;height:${r.height}px"></span>`).join('')
        + g.y.map(y => `<span class="sg-h" style="top:${r.top + y * s}px;left:${r.left}px;width:${r.width}px"></span>`).join('');
}

/* ----- AI 版面元素：原地偏移（拖曳移動） ----- */
// AI 的版面以 flex / grid 排列，元素沒有座標；移動時不改變排版，只在元素加上 CSS translate 位移：
// 旁邊的元素不會補位，從外層繼承的字色、字級也不變。translate 與 Tailwind 的 transform class 各自獨立、可疊加。
// 只支援移動，不支援縮放；最外層的版面容器不能移動。
function getOffset(el) {
    const m = (el.style.translate || '').match(/^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/);
    return m ? [parseFloat(m[1]), parseFloat(m[2] || 0)] : [0, 0];
}
function setOffset(el, x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x || y) el.style.translate = `${x}px ${y}px`;
    else el.style.removeProperty('translate');
    if (!el.getAttribute('style')) el.removeAttribute('style');
}
function canOffset(el) {
    const scaler = getScaler();
    if (!editMode || !el || !el.isConnected || !scaler || !scaler.contains(el) || el === scaler || isRootBlock(el)) return false;
    if (el.closest('[data-rs-float]') || el.parentElement.closest('svg')) return false;   // 浮動物件有自己的拖曳；SVG 內部以整個圖形為單位
    return !el.style.translate || getOffset(el).some(Boolean);   // AI 自己寫了非 px 的 translate 就不動
}
// 元素目前在投影片座標（1024×576）中的外框（含已套用的位移）
function slideRectOf(el) {
    const sr = getScaler().getBoundingClientRect(), r = el.getBoundingClientRect(), s = slideScale();
    return { x: (r.left - sr.left) / s, y: (r.top - sr.top) / s, w: r.width / s, h: r.height / s };
}

let offsetDrag = null;
// 先單擊選取元素，再按住拖曳；按在已選取元素的子元素上也是拖曳整個已選取元素
slideCanvasEl.addEventListener('pointerdown', e => {
    const el = selectedEl;
    if (!editMode || editingEl || e.button !== 0 || !canOffset(el) || !el.contains(e.target)) return;
    e.preventDefault();                       // 避免拖曳時反白文字
    const [ox, oy] = getOffset(el);
    offsetDrag = { el, sx: e.clientX, sy: e.clientY, ox, oy, r: slideRectOf(el), s: slideScale(), moved: false, snap: collectSnapTargets(el) };
    window.addEventListener('pointermove', onOffsetDragMove);
    window.addEventListener('pointerup', endOffsetDrag, { once: true });
    window.addEventListener('pointercancel', endOffsetDrag, { once: true });
});
function onOffsetDragMove(e) {
    const d = offsetDrag;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.s, dy = (e.clientY - d.sy) / d.s;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;   // 沒有真的拖動時保留單擊選取子元素、雙擊編輯文字
    d.moved = true;
    const { x, y, w, h } = d.r;
    let nx = x + dx, ny = y + dy;
    const guides = { x: [], y: [] };
    if (!e.altKey) {
        const sx = snapAxis([nx, nx + w / 2, nx + w], d.snap.x, SNAP_PX / d.s);
        const sy = snapAxis([ny, ny + h / 2, ny + h], d.snap.y, SNAP_PX / d.s);
        nx += sx.delta; ny += sy.delta;
        guides.x = sx.lines; guides.y = sy.lines;
    }
    [nx, ny] = clampFloatPos(nx, ny, w, h);
    setOffset(d.el, d.ox + nx - x, d.oy + ny - y);
    showSnapGuides(guides);
    positionToolbar();
}
function endOffsetDrag() {
    window.removeEventListener('pointermove', onOffsetDragMove);
    window.removeEventListener('pointerup', endOffsetDrag);
    window.removeEventListener('pointercancel', endOffsetDrag);
    showSnapGuides(null);
    const d = offsetDrag;
    offsetDrag = null;
    if (!d || !d.moved) return;
    suppressNextClick = true;
    setTimeout(() => { suppressNextClick = false; }, 0);
    commitSlideEdit();
    refreshToolbar();
}

/* ----- 方向鍵微調位置 ----- */
// 每按一次移動 1px（Shift：10px）；連續按鍵（間隔 800ms 內、同一個物件）合併成一個撤銷步驟
let nudgeState = null;
function nudgeSelected(dx, dy) {
    const el = selectedEl;
    const float = isFloat(el);
    if (!editMode || !el || !el.isConnected || (!float && !canOffset(el))) return false;
    stopTextEdit();
    if (float) {
        const r = floatRect(el);
        const [nx, ny] = clampFloatPos(r.x + dx, r.y + dy, r.w, r.h);
        if (Math.round(nx) === r.x && Math.round(ny) === r.y) return true;   // 已到邊界
        el.style.left = Math.round(nx) + 'px';
        el.style.top = Math.round(ny) + 'px';
    } else {
        const r = slideRectOf(el);
        const [nx, ny] = clampFloatPos(r.x + dx, r.y + dy, r.w, r.h);
        const mx = Math.round(nx - r.x), my = Math.round(ny - r.y);
        if (!mx && !my) return true;
        const [ox, oy] = getOffset(el);
        setOffset(el, ox + mx, oy + my);
    }
    const merge = nudgeState && nudgeState.el === el && Date.now() - nudgeState.at < 800 && undoStack[undoStack.length - 1] === nudgeState.snap;
    commitSlideEdit(!merge);
    nudgeState = { el, at: Date.now(), snap: merge ? nudgeState.snap : undoStack[undoStack.length - 1] };
    positionToolbar();
    return true;
}

/* ----- 浮動物件：複製、剪下、貼上（Ctrl+C / Ctrl+X / Ctrl+V） ----- */
// 物件存在頁面內的變數（含圖表資料），系統剪貼簿只放物件的文字；貼上時剪貼簿文字仍相同才貼物件，
// 期間若從其他地方複製了文字或圖片，就以剪貼簿的新內容為準
let floatClip = null;
function clipTarget(e) {
    if (!editMode || editingEl || !isFloat(selectedEl) || !selectedEl.isConnected) return null;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return null;
    if (document.getElementById('sectionPlayer').classList.contains('hidden')) return null;
    return selectedEl;
}
function copyFloat(el, dt) {
    const c = el.cloneNode(true);
    [c, ...c.querySelectorAll(EDIT_ATTRS.map(a => `[${a}]`).join(','))].forEach(n => EDIT_ATTRS.forEach(a => n.removeAttribute(a)));
    const slide = currentPresentationData.slides[currentSlideIdx];
    const charts = {};
    [c, ...c.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
        const i = n.getAttribute('data-rs-chart');
        if (slide.charts?.[Number(i)]) charts[i] = JSON.parse(JSON.stringify(slide.charts[Number(i)]));
    });
    // 文字方塊與圖案放入其文字（可貼到其他程式）；圖片、圖示、圖表的文字沒有意義，改放標記
    const text = (el.matches('[data-rs-text],[data-rs-shape]') ? el.textContent.replace(/\s+/g, ' ').trim() : '') || '[R Slide 物件]';
    floatClip = { html: c.outerHTML, charts, text };
    dt?.setData('text/plain', text);
}
function pasteFloat() {
    const slide = currentPresentationData?.slides?.[currentSlideIdx];
    const root = slideRoot();
    if (!floatClip || !slide || !root) return;
    stopTextEdit();
    const tpl = document.createElement('template');
    tpl.innerHTML = floatClip.html;
    const el = tpl.content.firstElementChild;
    if (!el) return;
    // 同時修改 slide.charts 與 HTML：先記錄撤銷點，再以 commitSlideEdit(false) 寫回
    pushUndoSnapshot();
    slide.charts = Array.isArray(slide.charts) ? slide.charts : [];
    [el, ...el.querySelectorAll('[data-rs-chart]')].filter(n => n.hasAttribute('data-rs-chart')).forEach(n => {
        const spec = floatClip.charts[n.getAttribute('data-rs-chart')];
        if (!spec) return;
        slide.charts.push(JSON.parse(JSON.stringify(spec)));
        n.setAttribute('data-rs-chart', String(slide.charts.length - 1));
    });
    // 原位置已有同樣位置的物件（貼在同一頁、或連續貼上）時往右下錯開
    const x0 = parseFloat(el.style.left) || 0, y0 = parseFloat(el.style.top) || 0;
    const taken = new Set([...root.querySelectorAll(':scope > [data-rs-float]')].map(n => `${parseFloat(n.style.left) || 0},${parseFloat(n.style.top) || 0}`));
    let k = 0;
    while (k < 40 && taken.has(`${x0 + k * 24},${y0 + k * 24}`)) k++;
    const w = parseFloat(el.style.width) || 0, h = parseFloat(el.style.height) || 0;
    const [nx, ny] = clampFloatPos(x0 + k * 24, y0 + k * 24, w, h);
    el.style.left = Math.round(nx) + 'px';
    el.style.top = Math.round(ny) + 'px';
    root.appendChild(el);
    commitSlideEdit(false);
    selectElement(el);
}
document.addEventListener('copy', e => {
    const el = clipTarget(e);
    if (!el) return;
    e.preventDefault();
    copyFloat(el, e.clipboardData);
    showToast('已複製物件，可按 Ctrl+V 貼上（也可貼到其他頁）', 'info', 1800);
});
document.addEventListener('cut', e => {
    const el = clipTarget(e);
    if (!el) return;
    e.preventDefault();
    copyFloat(el, e.clipboardData);
    runFmt('remove');
});

/* ----- 圖表資料編輯 ----- */
let chartEditTarget = null;      // null = 插入新圖表；否則為 [data-rs-chart] 容器

// 表格上限：標題列 + 12 個類別、類別欄 + 4 個系列（與 charts.py 的 MAX_LABELS / MAX_DATASETS 一致）
const chartGrid = createChartGrid(document.getElementById('chartData'), {
    maxRows: 13, maxCols: 5,
    onChange: () => updateChartPreview(),
    onNotice: msg => showToast(msg, 'info', 3000)
});

function chartToRows(spec) {
    const rows = [['類別', ...spec.datasets.map((d, i) => d.label || `系列${i + 1}`)]];
    spec.labels.forEach((l, i) => rows.push([l, ...spec.datasets.map(d => String(d.values[i] ?? 0))]));
    return rows;
}

// 解析表格：略過整列空白的列、整欄空白的系列；數字可含千分位、空白與 %
function parseChartRows(grid) {
    const cells = grid.map(r => r.map(v => String(v ?? '').trim()));
    const head = cells[0] || [];
    const cols = [];
    for (let c = 1; c < head.length; c++) if (cells.some(r => r[c])) cols.push(c);
    if (!cols.length) cols.push(1);
    const body = cells.map((r, i) => ({ r, line: i + 1 })).slice(1).filter(({ r }) => r.some(Boolean));
    if (!body.length) throw new Error('請至少輸入一列數據');
    if (body.length > 12) throw new Error('類別最多 12 個');
    if (cols.length > 4) throw new Error('資料系列最多 4 個');
    const datasets = cols.map(c => ({ label: head[c] || '', values: [] }));
    const labels = body.map(({ r, line }, i) => {
        cols.forEach((c, k) => {
            const raw = (r[c] || '').replace(/[,，\s%]/g, '');
            const v = raw === '' ? 0 : Number(raw);
            if (!Number.isFinite(v)) throw new Error(`第 ${line - 1} 列「${head[c] || '系列 ' + c}」的「${r[c]}」不是數字`);
            datasets[k].values.push(v);
        });
        return r[0] || `項目 ${i + 1}`;
    });
    return { labels, datasets };
}

/* ----- 參考線：只有直條、橫條、折線圖適用（RS_REF_LINE_TYPES） ----- */
function addChartRefRow(line = {}, focus = true) {
    const list = document.getElementById('chartRefList');
    if (list.children.length >= RS_REF_LINE_MAX) return;
    const row = document.createElement('div');
    row.className = 'chart-ref-row flex items-center gap-1.5';
    const field = 'h-8 px-2 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm text-zinc-900 dark:text-zinc-100';
    row.innerHTML = `
        <input data-ref="label" maxlength="16" placeholder="名稱，例如：目標" aria-label="參考線名稱" class="${field} flex-1 min-w-0">
        <input data-ref="value" inputmode="decimal" placeholder="數值" aria-label="參考線數值" class="${field} w-24 text-right tabular-nums">
        <input data-ref="color" type="color" aria-label="參考線顏色" title="參考線顏色" class="h-8 w-9 p-0.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg cursor-pointer">
        <button type="button" data-ref="remove" aria-label="刪除參考線" title="刪除參考線" class="icon-btn w-7 h-7 shrink-0 rounded-full text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40">
            <i class="fa-solid fa-xmark text-xs"></i></button>`;
    row.querySelector('[data-ref="label"]').value = line.label || '';
    row.querySelector('[data-ref="value"]').value = line.value ?? '';
    row.querySelector('[data-ref="color"]').value = /^#[0-9a-f]{6}$/i.test(line.color || '') ? line.color : RS_REF_LINE_COLOR;
    row.addEventListener('input', updateChartPreview);
    row.querySelector('[data-ref="remove"]').addEventListener('click', () => { row.remove(); syncChartRefUi(); updateChartPreview(); });
    list.appendChild(row);
    syncChartRefUi();
    if (focus) { row.querySelector('[data-ref="value"]').focus(); updateChartPreview(); }
}

function syncChartRefUi() {
    const type = document.getElementById('chartType').value;
    const ok = RS_REF_LINE_TYPES.includes(type);
    const count = document.getElementById('chartRefList').children.length;
    document.getElementById('chartRefSection').classList.toggle('hidden', !ok);
    document.getElementById('chartRefAdd').disabled = count >= RS_REF_LINE_MAX;
}

function readChartRefLines(type) {
    if (!RS_REF_LINE_TYPES.includes(type)) return [];   // 圓餅 / 環圈：占比圖沒有數值軸，不存參考線
    const out = [];
    document.querySelectorAll('#chartRefList .chart-ref-row').forEach((row, i) => {
        const label = row.querySelector('[data-ref="label"]').value.trim().slice(0, 16);
        const rawText = row.querySelector('[data-ref="value"]').value.trim();
        const raw = rawText.replace(/[,，\s%]/g, '');
        if (raw === '') {
            if (label) throw new Error(`參考線「${label}」請填寫數值`);
            return;                                       // 名稱與數值都空白：略過
        }
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`參考線 ${i + 1} 的「${rawText}」不是數字`);
        out.push({ label, value, color: row.querySelector('[data-ref="color"]').value });
    });
    return out;
}

/* ----- 強調項目：勾選要凸顯的類別（spec.highlight 存類別名稱） ----- */
let chartHlSelected = new Set();
let chartHlKey = null;               // 目前勾選清單對應的類別（類別改變時才重建）

function syncChartHlUi(labels) {
    const uniq = [...new Set(labels)];
    const key = JSON.stringify(uniq);
    if (key === chartHlKey) return;
    chartHlKey = key;
    const list = document.getElementById('chartHlList');
    list.replaceChildren(...uniq.map(l => {
        const chip = document.createElement('label');
        chip.className = 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-xs cursor-pointer select-none hover:bg-zinc-100 dark:hover:bg-zinc-800 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 dark:has-[:checked]:bg-blue-950/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue-500';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'accent-blue-600';
        box.checked = chartHlSelected.has(l);
        box.addEventListener('change', () => {
            if (box.checked) chartHlSelected.add(l); else chartHlSelected.delete(l);
            updateChartPreview();
        });
        chip.append(box, document.createTextNode(l));
        return chip;
    }));
}

// 只保留目前還存在的類別；全部都勾等於沒有凸顯
function readChartHighlight(labels) {
    const uniq = [...new Set(labels)];
    const picked = uniq.filter(l => chartHlSelected.has(l));
    return picked.length < uniq.length ? picked : [];
}

function readChartForm() {
    const { labels, datasets } = parseChartRows(chartGrid.getRows());
    syncChartHlUi(labels);
    const type = document.getElementById('chartType').value;
    const colors = document.getElementById('chartColors').value.split(/[,，\s]+/).map(c => c.trim()).filter(Boolean);
    const bad = colors.find(c => !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c));
    if (bad) throw new Error(`「${bad}」不是有效的 HEX 色碼`);
    return {
        type,
        title: document.getElementById('chartTitle').value.trim().slice(0, 40),
        unit: document.getElementById('chartUnit').value.trim().slice(0, 12),
        labels,
        datasets: type === 'pie' || type === 'doughnut' ? datasets.slice(0, 1) : datasets,
        colors,
        ref_lines: readChartRefLines(type),
        highlight: readChartHighlight(labels)
    };
}

function updateChartPreview() {
    const box = document.getElementById('chartPreview');
    const err = document.getElementById('chartError');
    try {
        const spec = readChartForm();
        const target = chartEditTarget;
        const w = target ? target.offsetWidth : 480, h = target ? target.offsetHeight : 280;
        box.innerHTML = renderChartSvg(spec, w, h, target ? chartFontScale(target) : 1);
        err.classList.add('hidden');
        document.getElementById('chartApplyBtn').disabled = false;
    } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
        document.getElementById('chartApplyBtn').disabled = true;
    }
}
['chartType', 'chartTitle', 'chartUnit', 'chartColors'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateChartPreview));
document.getElementById('chartType').addEventListener('input', syncChartRefUi);

function openChartEditor(target) {
    if (!editMode || !currentPresentationData) return;
    stopTextEdit();
    const slide = currentPresentationData.slides[currentSlideIdx];
    const spec = target ? slide.charts?.[Number(target.getAttribute('data-rs-chart'))] : null;
    if (target && !spec) { showToast('找不到這張圖表的資料', 'error'); return; }
    chartEditTarget = target;
    const s = spec || {
        type: 'bar', title: '', unit: '', colors: [],
        labels: ['第一季', '第二季', '第三季', '第四季'],
        datasets: [{ label: '2024', values: [120, 150, 170, 210] }, { label: '2025', values: [140, 180, 205, 260] }]
    };
    document.getElementById('chartModalTitle').textContent = target ? '編輯圖表資料' : '插入圖表';
    document.getElementById('chartApplyLabel').textContent = target ? '套用' : '插入圖表';
    document.getElementById('chartType').value = s.type;
    document.getElementById('chartTitle').value = s.title || '';
    document.getElementById('chartUnit').value = s.unit || '';
    document.getElementById('chartColors').value = (s.colors || []).join(', ');
    chartGrid.setRows(chartToRows(s));
    document.getElementById('chartRefList').replaceChildren();
    (s.ref_lines || []).forEach(l => addChartRefRow(l, false));
    chartHlSelected = new Set(s.highlight || []);
    chartHlKey = null;
    syncChartRefUi();
    document.getElementById('chartModal').classList.remove('hidden');
    updateChartPreview();
    setTimeout(() => chartGrid.focus(), 0);
}

function closeChartEditor() {
    chartEditTarget = null;
    document.getElementById('chartModal').classList.add('hidden');
}

function rerenderChart(el) {
    const slide = currentPresentationData.slides[currentSlideIdx];
    const spec = slide.charts?.[Number(el.getAttribute('data-rs-chart'))];
    if (spec) el.innerHTML = renderChartSvg(spec, el.offsetWidth, el.offsetHeight, chartFontScale(el));
}

function applyChartEditor() {
    let spec;
    try { spec = readChartForm(); } catch (e) { updateChartPreview(); return; }
    const slide = currentPresentationData?.slides?.[currentSlideIdx];
    if (!editMode || !slide) { closeChartEditor(); return; }
    const target = chartEditTarget;
    if (target && !target.isConnected) { closeChartEditor(); return; }
    // 同時修改 slide.charts 與 HTML：先記錄撤銷點，再以 commitSlideEdit(false) 寫回
    pushUndoSnapshot();
    slide.charts = Array.isArray(slide.charts) ? slide.charts : [];
    let el = target;
    if (el) {
        slide.charts[Number(el.getAttribute('data-rs-chart'))] = spec;
    } else {
        const root = slideRoot();
        if (!root) { closeChartEditor(); return; }
        slide.charts.push(spec);
        el = document.createElement('div');
        el.setAttribute('data-rs-chart', String(slide.charts.length - 1));
        el.setAttribute('data-rs-float', '');
        const w = 480, h = 280;
        setFloatRect(el, (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h);
        el.style.zIndex = '10';
        root.appendChild(el);
    }
    rerenderChart(el);
    commitSlideEdit(false);
    closeChartEditor();
    selectElement(el);
    showToast(target ? '已更新圖表' : '已插入圖表，可拖曳移動、拉角落調整大小', 'success', 2200);
}
