/* 插入圖案（矩形、三角形、箭頭等）；載入時只建立圖案選單，須在 editor.js 之前載入（格式工具列會用到這裡的常數）
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 圖案 ===================== */
// 圖案為浮動物件（data-rs-shape + data-rs-float），外框與填色存在容器的 data-* 屬性：
//   data-fill（HEX 或 none）、data-stroke（HEX 或 none）、data-stroke-w（px）、data-dash（solid / dash / dot）
// 容器內是依實際尺寸畫出的靜態 SVG（縮放後重畫，外框粗細不隨尺寸變形，匯出時也不需要腳本），
// 以及可雙擊輸入文字的 [data-rs-shape-text]；文字格式（字級、粗細、對齊、文字顏色）沿用格式工具列。
const RS_SHAPES = [
    { id: 'rect', name: '矩形', w: 240, h: 140 },
    { id: 'round-rect', name: '圓角矩形', w: 240, h: 140 },
    { id: 'ellipse', name: '橢圓', w: 160, h: 160 },
    { id: 'triangle', name: '三角形', w: 160, h: 140 },
    { id: 'right-triangle', name: '直角三角形', w: 160, h: 140 },
    { id: 'diamond', name: '菱形', w: 160, h: 160 },
    { id: 'parallelogram', name: '平行四邊形', w: 220, h: 120 },
    { id: 'trapezoid', name: '梯形', w: 220, h: 120 },
    { id: 'pentagon', name: '五邊形', w: 160, h: 160 },
    { id: 'hexagon', name: '六邊形', w: 180, h: 160 },
    { id: 'star', name: '星形', w: 160, h: 160 },
    { id: 'arrow', name: '箭頭', w: 220, h: 110 },
    { id: 'chevron', name: '流程箭頭', w: 200, h: 100 },
    { id: 'callout', name: '對話框', w: 240, h: 160 },
    { id: 'line', name: '直線', w: 240, h: 24, line: true },
    { id: 'arrow-line', name: '箭頭線', w: 240, h: 24, line: true }
];
const SHAPE_BY_ID = Object.fromEntries(RS_SHAPES.map(s => [s.id, s]));
const SHAPE_STROKE_WIDTHS = [0, 1, 2, 3, 4, 6, 8, 12, 16];
const SHAPE_DASHES = [['solid', '實線'], ['dash', '虛線'], ['dot', '點線']];
const SHAPE_DEFAULT = { fill: '#3b82f6', stroke: '#1e40af', strokeW: 2 };
const SHAPE_LINE_DEFAULT = { stroke: '#3f3f46', strokeW: 3 };
const SHAPE_COLOR_RE = /^#[0-9a-f]{6}$/i;

function isLineShape(el) { return !!SHAPE_BY_ID[el?.getAttribute('data-rs-shape')]?.line; }
// 選取的元素若在圖案內（例如正在編輯圖案文字），回傳圖案容器
function shapeOf(el) {
    const s = el?.closest?.('[data-rs-shape]');
    return s && getScaler()?.contains(s) ? s : null;
}

function readShapeStyle(el) {
    const color = v => (SHAPE_COLOR_RE.test(v || '') ? v : 'none');
    const line = isLineShape(el);
    const stroke = color(el.getAttribute('data-stroke'));
    let sw = Math.min(64, Math.max(0, Number(el.getAttribute('data-stroke-w')) || 0));
    if (stroke === 'none') sw = 0;
    if (line && !sw) sw = 1;                                  // 線條一定要有粗細
    return {
        fill: line ? 'none' : color(el.getAttribute('data-fill')),
        stroke: line && stroke === 'none' ? SHAPE_LINE_DEFAULT.stroke : stroke,
        sw,
        dash: SHAPE_DASHES.some(d => d[0] === el.getAttribute('data-dash')) ? el.getAttribute('data-dash') : 'solid'
    };
}

// 依實際像素尺寸產生 SVG 內容；外框畫在圖形內側（往內縮半個線寬），不會超出容器
function shapeSvgInner(type, w, h, st) {
    const sw = st.stroke === 'none' ? 0 : st.sw;
    const dash = !sw || st.dash === 'solid' ? '' : st.dash === 'dash' ? ` stroke-dasharray="${sw * 3} ${sw * 2}"` : ` stroke-dasharray="0 ${sw * 2}" stroke-linecap="round"`;
    const paint = `fill="${st.fill}" stroke="${sw ? st.stroke : 'none'}" stroke-width="${sw}" stroke-linejoin="miter"${dash}`;
    const r = n => Math.round(n * 100) / 100;
    const inset = sw / 2;
    const x0 = inset, y0 = inset, W = Math.max(1, w - sw), H = Math.max(1, h - sw);
    const poly = pts => `<polygon points="${pts.map(([x, y]) => `${r(x0 + x * W)},${r(y0 + y * H)}`).join(' ')}" ${paint}/>`;
    // 以像素指定的頂點（箭頭等：箭頭頭部長度不隨寬度拉長變形）
    const polyPx = pts => `<polygon points="${pts.map(([x, y]) => `${r(x0 + x)},${r(y0 + y)}`).join(' ')}" ${paint}/>`;
    // 正多邊形 / 星形：頂點正規化到外框，填滿整個容器
    const regular = (n, inner) => {
        const pts = [];
        const k = inner ? n * 2 : n;
        for (let i = 0; i < k; i++) {
            const a = -Math.PI / 2 + i * Math.PI * 2 / k;
            const rad = inner && i % 2 ? inner : 1;
            pts.push([Math.cos(a) * rad, Math.sin(a) * rad]);
        }
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const minX = Math.min(...xs), minY = Math.min(...ys), spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
        return poly(pts.map(([x, y]) => [(x - minX) / spanX, (y - minY) / spanY]));
    };

    switch (type) {
        case 'rect': return `<rect x="${r(x0)}" y="${r(y0)}" width="${r(W)}" height="${r(H)}" ${paint}/>`;
        case 'round-rect': {
            const rx = r(Math.min(W, H) * 0.18);
            return `<rect x="${r(x0)}" y="${r(y0)}" width="${r(W)}" height="${r(H)}" rx="${rx}" ry="${rx}" ${paint}/>`;
        }
        case 'ellipse': return `<ellipse cx="${r(w / 2)}" cy="${r(h / 2)}" rx="${r(W / 2)}" ry="${r(H / 2)}" ${paint}/>`;
        case 'triangle': return poly([[0.5, 0], [1, 1], [0, 1]]);
        case 'right-triangle': return poly([[0, 0], [1, 1], [0, 1]]);
        case 'diamond': return poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
        case 'parallelogram': return poly([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]);
        case 'trapezoid': return poly([[0.2, 0], [0.8, 0], [1, 1], [0, 1]]);
        case 'pentagon': return regular(5);
        case 'hexagon': return poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
        case 'star': return regular(5, 0.4);
        case 'arrow': {
            const head = Math.min(W * 0.45, H);
            return polyPx([[0, H * 0.25], [W - head, H * 0.25], [W - head, 0], [W, H / 2], [W - head, H], [W - head, H * 0.75], [0, H * 0.75]]);
        }
        case 'chevron': {
            const k = Math.min(W * 0.4, H * 0.5);
            return polyPx([[0, 0], [W - k, 0], [W, H / 2], [W - k, H], [0, H], [k, H / 2]]);
        }
        case 'callout': {
            const x1 = x0 + W, yb = y0 + H * 0.78, ye = y0 + H;
            const c = r(Math.min(W, yb - y0) * 0.15);
            const tl = x0 + W * 0.2, tr = x0 + W * 0.38, tip = x0 + W * 0.14;
            return `<path d="M${r(x0 + c)} ${r(y0)}H${r(x1 - c)}A${c} ${c} 0 0 1 ${r(x1)} ${r(y0 + c)}V${r(yb - c)}A${c} ${c} 0 0 1 ${r(x1 - c)} ${r(yb)}H${r(tr)}L${r(tip)} ${r(ye)}L${r(tl)} ${r(yb)}H${r(x0 + c)}A${c} ${c} 0 0 1 ${r(x0)} ${r(yb - c)}V${r(y0 + c)}A${c} ${c} 0 0 1 ${r(x0 + c)} ${r(y0)}Z" ${paint}/>`;
        }
        case 'line':
        case 'arrow-line': {
            // 沿容器較長的方向畫：寬 ≥ 高為水平線，否則為垂直線
            const horiz = w >= h;
            const len = horiz ? w : h, mid = (horiz ? h : w) / 2;
            const pt = (a, b) => horiz ? [a, b] : [b, a];
            const lineDash = st.dash === 'solid' ? '' : st.dash === 'dash' ? ` stroke-dasharray="${sw * 3} ${sw * 2}"` : ` stroke-dasharray="0 ${sw * 2}" stroke-linecap="round"`;
            const seg = (a, b) => {
                const [xa, ya] = pt(a, mid), [xb, yb2] = pt(b, mid);
                return `<line x1="${r(xa)}" y1="${r(ya)}" x2="${r(xb)}" y2="${r(yb2)}" stroke="${st.stroke}" stroke-width="${sw}"${lineDash}/>`;
            };
            if (type === 'line') return seg(0, len);
            const hl = Math.min(len * 0.5, Math.max(10, sw * 3.5)), hw = hl * 0.45;
            const head = [pt(len, mid), pt(len - hl, mid - hw), pt(len - hl, mid + hw)];
            return seg(0, len - hl + 1) + `<polygon points="${head.map(([x, y]) => `${r(x)},${r(y)}`).join(' ')}" fill="${st.stroke}"/>`;
        }
    }
    return '';
}

function shapeSvgMarkup(type, w, h, st, extra = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"${extra}>${shapeSvgInner(type, w, h, st)}</svg>`;
}

// 依容器目前的尺寸與 data-* 重畫 SVG（插入、縮放、改外框 / 填色後呼叫）
function renderShape(el) {
    const type = el.getAttribute('data-rs-shape');
    if (!SHAPE_BY_ID[type]) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    if (!w || !h) return;
    const markup = shapeSvgMarkup(type, w, h, readShapeStyle(el), ' style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none"');
    const old = el.querySelector(':scope > svg');
    if (old) old.outerHTML = markup; else el.insertAdjacentHTML('afterbegin', markup);
}

// 格式工具列：改填色 / 外框顏色 / 外框粗細 / 線條樣式
function setShapeStyle(el, prop, v) {
    if (prop === 'fill') el.setAttribute('data-fill', SHAPE_COLOR_RE.test(v) ? v.toLowerCase() : 'none');
    else if (prop === 'stroke') {
        const c = SHAPE_COLOR_RE.test(v) ? v.toLowerCase() : 'none';
        if (c === 'none' && isLineShape(el)) return;          // 線條不能沒有顏色
        el.setAttribute('data-stroke', c);
        // 原本沒有外框時選了顏色：給一個預設粗細，選了才看得到
        if (c !== 'none' && !(Number(el.getAttribute('data-stroke-w')) > 0)) el.setAttribute('data-stroke-w', String(SHAPE_DEFAULT.strokeW));
    } else if (prop === 'strokeW') {
        const n = Number(v) || 0;
        el.setAttribute('data-stroke-w', String(isLineShape(el) ? Math.max(1, n) : n));
        // 原本沒有外框時調了粗細：給一個預設顏色
        if (n > 0 && !SHAPE_COLOR_RE.test(el.getAttribute('data-stroke') || '')) el.setAttribute('data-stroke', SHAPE_DEFAULT.stroke);
    } else if (prop === 'dash') el.setAttribute('data-dash', v);
    renderShape(el);
}

function insertSlideShape(type) {
    const def = SHAPE_BY_ID[type];
    if (!def || !editMode || !currentPresentationData) return;
    const root = slideRoot();
    if (!root) return;
    stopTextEdit();
    const el = document.createElement('div');
    el.setAttribute('data-rs-shape', type);
    el.setAttribute('data-rs-float', '');
    if (def.line) {
        el.setAttribute('data-stroke', SHAPE_LINE_DEFAULT.stroke);
        el.setAttribute('data-stroke-w', String(SHAPE_LINE_DEFAULT.strokeW));
    } else {
        el.setAttribute('data-fill', SHAPE_DEFAULT.fill);
        el.setAttribute('data-stroke', SHAPE_DEFAULT.stroke);
        el.setAttribute('data-stroke-w', String(SHAPE_DEFAULT.strokeW));
        // 圖案內文字：預設白色、置中；雙擊圖案即可輸入
        el.className = 'text-xl font-semibold text-center text-white leading-snug';
        const t = document.createElement('div');
        t.setAttribute('data-rs-shape-text', '');
        Object.assign(t.style, { position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' });
        el.appendChild(t);
    }
    el.setAttribute('data-dash', 'solid');
    // 連續插入時錯開位置，避免疊在一起
    const n = root.querySelectorAll(':scope > [data-rs-shape]').length % 6;
    setFloatRect(el, (SLIDE_W - def.w) / 2 + n * 24, (SLIDE_H - def.h) / 2 + n * 24, def.w, def.h);
    el.style.zIndex = '10';
    root.appendChild(el);
    renderShape(el);
    commitSlideEdit();
    selectElement(el);
    showToast(def.line ? '已插入線條，可拖曳移動、拉角落調整長度' : '已插入圖案，雙擊可輸入文字；外框與填滿顏色可在工具列調整', 'success', 2600);
}

/* ----- 圖案選單 ----- */
(function buildShapePicker() {
    const panel = document.getElementById('shapePicker');
    const preview = { fill: '#dbeafe', stroke: '#3b82f6', sw: 2, dash: 'solid' };
    panel.innerHTML = `<div class="shape-grid">${RS_SHAPES.map(s => `
        <button type="button" class="shape-cell" data-shape="${s.id}" title="${s.name}" aria-label="插入${s.name}">
            ${shapeSvgMarkup(s.id, 48, s.line ? 20 : 36, preview)}<span>${s.name}</span>
        </button>`).join('')}</div>`;
    const cells = [...panel.querySelectorAll('.shape-cell')];
    panel.addEventListener('click', e => {
        const c = e.target.closest('.shape-cell');
        if (!c) return;
        closeShapePicker();
        insertSlideShape(c.dataset.shape);
    });
    // 方向鍵在圖案間移動（一列 4 個）
    panel.addEventListener('keydown', e => {
        const i = cells.indexOf(document.activeElement);
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
        if (i < 0 || !step) return;
        e.preventDefault();
        e.stopPropagation();
        cells[Math.min(cells.length - 1, Math.max(0, i + step))].focus();
    });
    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#shapePicker') && !e.target.closest('#shapePickerBtn')) closeShapePicker();
    });
})();

function isShapePickerOpen() { return !document.getElementById('shapePicker').classList.contains('hidden'); }
function toggleShapePicker() {
    if (isShapePickerOpen()) { closeShapePicker(); return; }
    if (!editMode || !currentPresentationData) return;
    stopTextEdit();
    closeIconPicker();
    document.getElementById('shapePicker').classList.remove('hidden');
    document.getElementById('shapePickerBtn').setAttribute('aria-expanded', 'true');
    positionShapePicker();
    document.querySelector('#shapePicker .shape-cell')?.focus();
}
function closeShapePicker() {
    const panel = document.getElementById('shapePicker');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    document.getElementById('shapePickerBtn').setAttribute('aria-expanded', 'false');
}
// 與圖示面板相同：空間夠就往上開，否則往下開
function positionShapePicker() {
    if (!isShapePickerOpen()) return;
    const panel = document.getElementById('shapePicker');
    const r = document.getElementById('shapePickerBtn').getBoundingClientRect();
    const w = Math.min(340, window.innerWidth - 16);
    panel.style.width = w + 'px';
    const h = panel.offsetHeight;
    const up = r.top - 16 >= h || r.top > window.innerHeight - r.bottom;
    panel.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
    panel.style.top = (up ? Math.max(8, r.top - 8 - h) : r.bottom + 8) + 'px';
}
