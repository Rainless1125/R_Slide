/* 圖片、文字方塊、浮動物件拖曳縮放、圖表資料編輯
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
        return { ...s, html_content: doc.body.innerHTML, charts: s.charts || [] };
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
document.addEventListener('paste', e => {
    if (!editMode || editingEl || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (document.getElementById('sectionPlayer').classList.contains('hidden')) return;
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); insertSlideImage(f); }
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
    floatDrag = { el, handle, sx: e.clientX, sy: e.clientY, r: floatRect(el), s: slideScale(), moved: false, keepRatio: el.hasAttribute('data-rs-img') };
    e.target.setPointerCapture?.(e.pointerId);
    e.target.addEventListener('pointermove', onFloatDragMove);
    e.target.addEventListener('pointerup', endFloatDrag, { once: true });
    e.target.addEventListener('pointercancel', endFloatDrag, { once: true });
}
function onFloatDragMove(e) {
    const d = floatDrag;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.s, dy = (e.clientY - d.sy) / d.s;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    d.moved = true;
    const { x, y, w, h } = d.r;
    const MIN = 24;
    if (!d.handle) {
        // 移動：至少保留 24px 在投影片內，避免拖出畫面找不回來
        const nx = Math.min(Math.max(x + dx, MIN - w), SLIDE_W - MIN);
        const ny = Math.min(Math.max(y + dy, MIN - h), SLIDE_H - MIN);
        d.el.style.left = Math.round(nx) + 'px';
        d.el.style.top = Math.round(ny) + 'px';
    } else {
        const west = d.handle.includes('w'), north = d.handle.includes('n');
        let nw = Math.max(MIN, w + (west ? -dx : dx));
        let nh = Math.max(MIN, h + (north ? -dy : dy));
        if (d.keepRatio) nh = nw * h / w;
        const autoH = d.keepRatio || d.el.hasAttribute('data-rs-text');   // 文字方塊只調寬度，高度隨文字
        if (autoH && !d.keepRatio) nh = h;
        // 從左 / 上方的控制點縮放時，對側固定不動
        setFloatRect(d.el, west ? x + w - nw : x, north ? y + h - nh : y, nw, autoH ? null : nh);
    }
    positionToolbar();
}
function endFloatDrag(e) {
    e.target.removeEventListener('pointermove', onFloatDragMove);
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

function readChartForm() {
    const { labels, datasets } = parseChartRows(chartGrid.getRows());
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
        ref_lines: readChartRefLines(type)
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
