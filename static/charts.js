/* ===================== 圖表（靜態 inline SVG） =====================
 * LLM 只輸出結構化資料（charts.py 的 ChartSpec），投影片 HTML 裡放 <div data-rs-chart="索引"> 佔位容器，
 * 這裡把資料畫成純 SVG 寫回 html_content。成品不需要任何 script，因此：
 *   - 編輯、縮圖、撤銷都沿用既有流程（圖表就是 HTML 的一部分）
 *   - 匯出 HTML 時 sanitizeSlideHtml 不必放行 Chart.js；PDF / PPTX 由 html-to-image 直接截圖
 *
 *   renderChartSvg(spec, w, h)   以 w×h（投影片座標 px）畫出 SVG 字串
 *   fillChartPlaceholders(root, charts, measure)  把容器內容換成對應的 SVG
 *   bakeSlideCharts(slides)      新投影片進入應用時呼叫：量測容器尺寸後畫入圖表
 */

/* 預設類別色（依序使用、不循環打亂；LLM 可用 colors 依視覺風格覆寫） */
const RS_CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const RS_CHART_TYPES = ['bar', 'horizontal_bar', 'line', 'pie', 'doughnut'];
const RS_CHART_DEFAULT_W = 560, RS_CHART_DEFAULT_H = 300;
/* 參考線（目標、規格上下限、門檻）：只畫在有數值軸的圖；圓餅 / 環圈是占比，沒有可對照的軸 */
const RS_REF_LINE_TYPES = ['bar', 'horizontal_bar', 'line'];
const RS_REF_LINE_COLOR = '#dc2626';
const RS_REF_LINE_MAX = 3;

function _cRefLines(spec) {
    if (!RS_REF_LINE_TYPES.includes(spec?.type)) return [];
    return (spec.ref_lines || [])
        .filter(l => l && l.value !== '' && l.value != null && Number.isFinite(Number(l.value)))
        .slice(0, RS_REF_LINE_MAX)
        .map(l => ({
            label: String(l.label || ''),
            value: Number(l.value),
            color: /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(l.color || '').trim()) ? String(l.color).trim() : RS_REF_LINE_COLOR
        }));
}

function _cEsc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function _cNum(n) { return Math.round(n * 100) / 100; }

/* 數字格式：千分位、最多兩位小數；短單位（%、元）直接接在數字後 */
function _cFmt(v, unit) {
    const s = Number(v).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
    return unit && unit.length <= 2 ? s + unit : s;
}

/* 粗估文字寬度：中日韓全形字約 1em，其餘約 0.58em */
function _cTextW(s, size) {
    let w = 0;
    for (const ch of String(s)) w += /[⺀-￿]/.test(ch) ? 1 : 0.58;
    return w * size;
}
function _cFit(s, maxW, size) {
    s = String(s);
    if (_cTextW(s, size) <= maxW) return s;
    const chars = [...s];
    while (chars.length > 1 && _cTextW(chars.join('') + '…', size) > maxW) chars.pop();
    return chars.join('') + '…';
}

/* 座標軸刻度：取 1 / 2 / 2.5 / 5 × 10^n 的整齊間距 */
function _cNiceScale(lo, hi, ticks = 5) {
    if (lo === hi) { if (hi === 0) hi = 1; else if (hi > 0) lo = 0; else hi = 0; }
    const raw = (hi - lo) / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step };
}

function _cColors(spec, n) {
    const custom = (spec.colors || []).filter(c => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c).trim()));
    return Array.from({ length: n }, (_, i) => custom[i] || RS_CHART_COLORS[i % RS_CHART_COLORS.length]);
}

/* 單邊圓角的長條：資料端 4px 圓角、基準線端為直角 */
function _cBarPath(x, y, w, h, dir) {
    const r = Math.max(0, Math.min(4, w / 2, h));
    const R = v => _cNum(v);
    if (h <= 0 || w <= 0) return '';
    if (dir === 'up') return `M${R(x)},${R(y + h)}V${R(y + r)}Q${R(x)},${R(y)} ${R(x + r)},${R(y)}H${R(x + w - r)}Q${R(x + w)},${R(y)} ${R(x + w)},${R(y + r)}V${R(y + h)}Z`;
    if (dir === 'down') return `M${R(x)},${R(y)}V${R(y + h - r)}Q${R(x)},${R(y + h)} ${R(x + r)},${R(y + h)}H${R(x + w - r)}Q${R(x + w)},${R(y + h)} ${R(x + w)},${R(y + h - r)}V${R(y)}Z`;
    // 橫條：w 為長度方向
    const rr = Math.max(0, Math.min(4, h / 2, w));
    if (dir === 'right') return `M${R(x)},${R(y)}H${R(x + w - rr)}Q${R(x + w)},${R(y)} ${R(x + w)},${R(y + rr)}V${R(y + h - rr)}Q${R(x + w)},${R(y + h)} ${R(x + w - rr)},${R(y + h)}H${R(x)}Z`;
    return `M${R(x + w)},${R(y)}H${R(x + rr)}Q${R(x)},${R(y)} ${R(x)},${R(y + rr)}V${R(y + h - rr)}Q${R(x)},${R(y + h)} ${R(x + rr)},${R(y + h)}H${R(x + w)}Z`;
}

/* 圖例：色塊 + 文字（文字用 currentColor，不用系列色） */
function _cLegend(items, x, y, maxW, size) {
    let cx = x, cy = y, out = '';
    for (const it of items) {
        const label = _cFit(it.label, maxW - 18, size);
        const w = 14 + _cTextW(label, size) + 14;
        if (cx > x && cx + w > x + maxW) { cx = x; cy += size + 8; }
        out += `<rect x="${_cNum(cx)}" y="${_cNum(cy + size * 0.1)}" width="10" height="10" rx="2" fill="${it.color}"/>` +
            `<text x="${_cNum(cx + 14)}" y="${_cNum(cy + size * 0.85)}" font-size="${size}" fill="currentColor" fill-opacity=".8">${_cEsc(label)}</text>`;
        cx += w;
    }
    return { svg: out, height: cy - y + size + 8 };
}

function renderChartSvg(spec, width, height) {
    const W = Math.max(160, Math.round(width || RS_CHART_DEFAULT_W));
    const H = Math.max(120, Math.round(height || RS_CHART_DEFAULT_H));
    const type = RS_CHART_TYPES.includes(spec?.type) ? spec.type : 'bar';
    const labels = (spec?.labels || []).map(String);
    const datasets = (spec?.datasets || []).filter(d => d && Array.isArray(d.values));
    const unit = String(spec?.unit || '');
    const title = String(spec?.title || '');
    const fs = W < 360 ? 11 : 12;
    let body = '';
    let top = 4;

    if (title) {
        body += `<text x="0" y="${top + 15}" font-size="15" font-weight="600" fill="currentColor">${_cEsc(_cFit(title, W * 0.75, 15))}</text>`;
    }
    if (unit.length > 2) {
        body += `<text x="${W}" y="${top + (title ? 15 : 11)}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".6">單位：${_cEsc(_cFit(unit, W * 0.25, 11))}</text>`;
    }
    if (title || unit.length > 2) top += title ? 26 : 18;

    const empty = msg => `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-size="13" fill="currentColor" fill-opacity=".5">${msg}</text>`;
    if (!labels.length || !datasets.length) body += empty('無圖表資料');
    else if (type === 'pie' || type === 'doughnut') body += _cPie(type, labels, datasets[0], unit, spec, W, H, top, fs) || empty('無可顯示的數值');
    else body += _cCartesian(type, labels, datasets, unit, spec, W, H, top, fs);

    const aria = [title || '圖表', ...labels.map((l, i) => `${l} ${datasets.map(d => _cFmt(d.values[i] ?? 0, unit)).join(' / ')}`),
        ..._cRefLines({ ...spec, type }).map(l => `${l.label || '參考線'} ${_cFmt(l.value, unit)}`)].join('；');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${_cEsc(aria)}" style="display:block;overflow:visible;font-family:inherit">${body}</svg>`;
}

function _cCartesian(type, labels, datasets, unit, spec, W, H, top, fs) {
    const colors = _cColors(spec, datasets.length);
    const multi = datasets.length > 1;
    let out = '';
    if (multi) {
        const lg = _cLegend(datasets.map((d, i) => ({ label: d.label || `系列 ${i + 1}`, color: colors[i] })), 0, top, W, fs);
        out += lg.svg;
        top += lg.height;
    }
    const refs = _cRefLines({ ...spec, type });
    // 參考線的數值也納入刻度範圍，門檻高於所有資料時仍看得到
    const all = [...datasets.flatMap(d => d.values.slice(0, labels.length).map(v => Number(v) || 0)), ...refs.map(l => l.value)];
    const sc = _cNiceScale(Math.min(0, ...all), Math.max(0, ...all));
    const ticks = [];
    for (let v = sc.lo; v <= sc.hi + sc.step / 2; v += sc.step) ticks.push(_cNum(v));
    const n = labels.length;
    const tip = (i, d) => `${labels[i]}${multi ? ' · ' + (d.label || '') : ''}：${_cFmt(d.values[i] ?? 0, unit)}${unit.length > 2 ? ' ' + unit : ''}`;
    const showValues = n * datasets.length <= 16;
    const refText = l => `${l.label ? l.label + ' ' : ''}${_cFmt(l.value, unit)}`;
    const refTip = l => `${l.label || '參考線'}：${_cFmt(l.value, unit)}${unit.length > 2 ? ' ' + unit : ''}`;

    if (type === 'horizontal_bar') {
        const labelW = Math.min(W * 0.32, Math.max(...labels.map(l => _cTextW(l, fs))) + 8);
        if (refs.length) top += fs + 6;            // 參考線名稱寫在線的上端
        const left = labelW, right = W - 8 - (showValues ? 44 : 0), bottom = H - 20;
        const px = v => left + (v - sc.lo) / (sc.hi - sc.lo) * (right - left);
        ticks.forEach(t => {
            out += `<line x1="${_cNum(px(t))}" x2="${_cNum(px(t))}" y1="${top}" y2="${bottom}" stroke="currentColor" stroke-opacity="${t === 0 ? .35 : .12}"/>` +
                `<text x="${_cNum(px(t))}" y="${bottom + 15}" text-anchor="middle" font-size="${fs - 1}" fill="currentColor" fill-opacity=".6">${_cFmt(t, unit)}</text>`;
        });
        const band = (bottom - top) / n;
        const groupH = Math.min(band * 0.72, 36 * datasets.length);
        const barH = Math.max(2, (groupH - 2 * (datasets.length - 1)) / datasets.length);
        labels.forEach((l, i) => {
            const gy = top + band * i + (band - groupH) / 2;
            out += `<text x="${_cNum(left - 8)}" y="${_cNum(top + band * (i + .5) + fs * .35)}" text-anchor="end" font-size="${fs}" fill="currentColor" fill-opacity=".85">${_cEsc(_cFit(l, labelW - 8, fs))}</text>`;
            datasets.forEach((d, k) => {
                const v = Number(d.values[i]) || 0;
                const y = gy + k * (barH + 2);
                const x0 = px(Math.min(0, v)), x1 = px(Math.max(0, v));
                out += `<path d="${_cBarPath(x0, y, x1 - x0, barH, v >= 0 ? 'right' : 'left')}" fill="${colors[k]}"><title>${_cEsc(tip(i, d))}</title></path>`;
                if (showValues) out += `<text x="${_cNum(v >= 0 ? x1 + 4 : x0 - 4)}" y="${_cNum(y + barH / 2 + fs * .35)}" text-anchor="${v >= 0 ? 'start' : 'end'}" font-size="${fs - 1}" fill="currentColor" fill-opacity=".85">${_cFmt(v, unit)}</text>`;
            });
        });
        refs.forEach(l => {
            const x = _cNum(px(l.value));
            const text = _cFit(refText(l), Math.max(60, (right - left) * 0.45), fs - 1);
            const tw = _cTextW(text, fs - 1);
            const anchor = x - tw / 2 < 0 ? 'start' : x + tw / 2 > W ? 'end' : 'middle';
            out += `<g><title>${_cEsc(refTip(l))}</title>` +
                `<line x1="${x}" x2="${x}" y1="${top - 2}" y2="${bottom}" stroke="${l.color}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
                `<text x="${x}" y="${top - 6}" text-anchor="${anchor}" font-size="${fs - 1}" font-weight="600" fill="${l.color}">${_cEsc(text)}</text></g>`;
        });
        return out;
    }

    const axisW = Math.max(...ticks.map(t => _cTextW(_cFmt(t, unit), fs - 1))) + 8;
    // 參考線名稱寫在繪圖區右側外面，避免和長條、數值標籤重疊
    const refLabels = refs.map(l => _cFit(refText(l), W * 0.22, fs - 1));
    const refGutter = refs.length ? Math.max(...refLabels.map(t => _cTextW(t, fs - 1))) + 10 : 0;
    const left = axisW, right = W - (type === 'line' ? 12 : 4) - refGutter, bottom = H - 22;
    const plotTop = top + (showValues ? 14 : 4);
    const py = v => bottom - (v - sc.lo) / (sc.hi - sc.lo) * (bottom - plotTop);
    ticks.forEach(t => {
        out += `<line x1="${left}" x2="${right}" y1="${_cNum(py(t))}" y2="${_cNum(py(t))}" stroke="currentColor" stroke-opacity="${t === 0 ? .35 : .12}"/>` +
            `<text x="${left - 6}" y="${_cNum(py(t) + 4)}" text-anchor="end" font-size="${fs - 1}" fill="currentColor" fill-opacity=".6">${_cFmt(t, unit)}</text>`;
    });
    const band = (right - left) / n;
    const xLabelSize = fs;
    // 水平參考虛線；名稱在右側欄與線同高，數值相近時往上下推開避免重疊
    const refSvg = () => {
        const items = refs.map((l, i) => ({ l, text: refLabels[i], y: py(l.value), ty: py(l.value) }))
            .sort((a, b) => a.y - b.y);
        const gapY = fs + 2;
        for (let i = 1; i < items.length; i++) items[i].ty = Math.max(items[i].ty, items[i - 1].ty + gapY);
        for (let i = items.length - 1; i >= 0; i--) {
            items[i].ty = Math.min(items[i].ty, i === items.length - 1 ? bottom : items[i + 1].ty - gapY);
        }
        const lineEnd = type === 'line' ? right + 8 : right;
        return items.map(({ l, text, y, ty }) => `<g><title>${_cEsc(refTip(l))}</title>` +
            `<line x1="${left}" x2="${_cNum(lineEnd)}" y1="${_cNum(y)}" y2="${_cNum(y)}" stroke="${l.color}" stroke-width="1.5" stroke-dasharray="6 4"/>` +
            `<text x="${_cNum(lineEnd + 6)}" y="${_cNum(ty + (fs - 1) * .35)}" font-size="${fs - 1}" font-weight="600" fill="${l.color}">${_cEsc(text)}</text></g>`).join('');
    };
    const labelEvery = Math.max(1, Math.ceil(Math.max(...labels.map(l => _cTextW(l, xLabelSize))) / Math.max(band, 1) * 0.6));

    if (type === 'line') {
        const cx = i => n === 1 ? (left + right) / 2 : left + 8 + i * (right - left - 16) / (n - 1);
        labels.forEach((l, i) => {
            if (i % labelEvery) return;
            out += `<text x="${_cNum(cx(i))}" y="${bottom + 16}" text-anchor="middle" font-size="${xLabelSize}" fill="currentColor" fill-opacity=".8">${_cEsc(_cFit(l, Math.max(band * labelEvery - 4, 24), xLabelSize))}</text>`;
        });
        datasets.forEach((d, k) => {
            const pts = labels.map((_, i) => [cx(i), py(Number(d.values[i]) || 0)]);
            const line = pts.map(p => `${_cNum(p[0])},${_cNum(p[1])}`).join(' ');
            if (!multi && n > 1) {
                out += `<polygon points="${_cNum(pts[0][0])},${_cNum(py(Math.max(sc.lo, 0)))} ${line} ${_cNum(pts[n - 1][0])},${_cNum(py(Math.max(sc.lo, 0)))}" fill="${colors[k]}" fill-opacity=".12"/>`;
            }
            out += `<polyline points="${line}" fill="none" stroke="${colors[k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
            pts.forEach((p, i) => {
                out += `<circle cx="${_cNum(p[0])}" cy="${_cNum(p[1])}" r="4" fill="${colors[k]}"><title>${_cEsc(tip(i, d))}</title></circle>`;
            });
            // 直接標註：單一系列標每個點（點數不多時），多系列只標最後一點
            const labelIdx = !multi && showValues ? labels.map((_, i) => i) : [n - 1];
            labelIdx.forEach(i => {
                out += `<text x="${_cNum(pts[i][0])}" y="${_cNum(pts[i][1] - 9)}" text-anchor="middle" font-size="${fs - 1}" fill="currentColor" fill-opacity=".85">${_cFmt(d.values[i] ?? 0, unit)}</text>`;
            });
        });
        return out + refSvg();
    }

    // 直條圖（分組）
    const groupW = Math.min(band * 0.72, 44 * datasets.length);
    const barW = Math.max(2, (groupW - 2 * (datasets.length - 1)) / datasets.length);
    labels.forEach((l, i) => {
        const gx = left + band * i + (band - groupW) / 2;
        if (!(i % labelEvery)) {
            out += `<text x="${_cNum(left + band * (i + .5))}" y="${bottom + 16}" text-anchor="middle" font-size="${xLabelSize}" fill="currentColor" fill-opacity=".8">${_cEsc(_cFit(l, Math.max(band * labelEvery - 4, 24), xLabelSize))}</text>`;
        }
        datasets.forEach((d, k) => {
            const v = Number(d.values[i]) || 0;
            const x = gx + k * (barW + 2);
            const y0 = py(Math.max(0, v)), y1 = py(Math.min(0, v));
            out += `<path d="${_cBarPath(x, y0, barW, y1 - y0, v >= 0 ? 'up' : 'down')}" fill="${colors[k]}"><title>${_cEsc(tip(i, d))}</title></path>`;
            if (showValues) out += `<text x="${_cNum(x + barW / 2)}" y="${_cNum(v >= 0 ? y0 - 5 : y1 + fs)}" text-anchor="middle" font-size="${fs - 1}" fill="currentColor" fill-opacity=".85">${_cFmt(v, unit)}</text>`;
        });
    });
    return out + refSvg();
}

function _cPie(type, labels, ds, unit, spec, W, H, top, fs) {
    const values = labels.map((_, i) => Math.max(0, Number(ds.values[i]) || 0));
    const total = values.reduce((a, b) => a + b, 0);
    if (!total) return '';
    const colors = _cColors(spec, labels.length);
    const side = W >= H * 1.3;                       // 寬的容器圖例放右邊，否則放下方
    const legendItems = labels.map((l, i) => ({ label: `${l}  ${Math.round(values[i] / total * 1000) / 10}%`, color: colors[i] }));
    let legendSvg = '', cx, cy, r;
    if (side) {
        const legendW = Math.min(W * 0.42, Math.max(...legendItems.map(it => _cTextW(it.label, fs))) + 22);
        r = Math.max(10, Math.min((W - legendW - 24) / 2, (H - top - 8) / 2));
        cx = r + 4; cy = top + (H - top) / 2;
        const lx = cx + r + 24;
        const rowH = fs + 10;
        const ly = cy - legendItems.length * rowH / 2;
        legendItems.forEach((it, i) => {
            legendSvg += `<rect x="${_cNum(lx)}" y="${_cNum(ly + i * rowH + 1)}" width="10" height="10" rx="2" fill="${it.color}"/>` +
                `<text x="${_cNum(lx + 16)}" y="${_cNum(ly + i * rowH + fs * .85)}" font-size="${fs}" fill="currentColor" fill-opacity=".85">${_cEsc(_cFit(it.label, W - lx - 16, fs))}</text>`;
        });
    } else {
        const lg = _cLegend(legendItems, 0, 0, W, fs);
        r = Math.max(10, Math.min(W / 2 - 4, (H - top - lg.height - 8) / 2));
        cx = W / 2; cy = top + r + 2;
        legendSvg = `<g transform="translate(0 ${_cNum(cy + r + 10)})">${lg.svg}</g>`;
    }
    const inner = type === 'doughnut' ? r * 0.6 : 0;
    const gap = labels.length > 1 ? Math.min(0.02, 1 / r) : 0; // 扇形之間留約 2px 間隙（弧度）
    let a = -Math.PI / 2, out = '';
    const P = (ang, rad) => `${_cNum(cx + rad * Math.cos(ang))},${_cNum(cy + rad * Math.sin(ang))}`;
    values.forEach((v, i) => {
        if (!v) return;
        const sweep = v / total * Math.PI * 2;
        const tip = `${labels[i]}：${_cFmt(v, unit)}${unit.length > 2 ? ' ' + unit : ''}（${Math.round(v / total * 1000) / 10}%）`;
        if (sweep >= Math.PI * 2 - 1e-6) {
            out += `<circle cx="${_cNum(cx)}" cy="${_cNum(cy)}" r="${_cNum((r + inner) / 2)}" fill="none" stroke="${colors[i]}" stroke-width="${_cNum(r - inner || r)}"><title>${_cEsc(tip)}</title></circle>`;
        } else {
            const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const d = inner
                ? `M${P(a0, r)}A${_cNum(r)},${_cNum(r)} 0 ${large} 1 ${P(a1, r)}L${P(a1, inner)}A${_cNum(inner)},${_cNum(inner)} 0 ${large} 0 ${P(a0, inner)}Z`
                : `M${_cNum(cx)},${_cNum(cy)}L${P(a0, r)}A${_cNum(r)},${_cNum(r)} 0 ${large} 1 ${P(a1, r)}Z`;
            out += `<path d="${d}" fill="${colors[i]}"><title>${_cEsc(tip)}</title></path>`;
            if (v / total >= 0.06 && r >= 50) {
                const mid = a + sweep / 2, lr = inner ? (r + inner) / 2 : r * 0.62;
                out += `<text x="${_cNum(cx + lr * Math.cos(mid))}" y="${_cNum(cy + lr * Math.sin(mid) + 4)}" text-anchor="middle" font-size="${fs - 1}" font-weight="600" fill="#fff">${Math.round(v / total * 100)}%</text>`;
            }
        }
        a += sweep;
    });
    if (inner && inner >= 30 && unit !== '%') {   // 百分比加總恆為 100%，中央不顯示合計
        out += `<text x="${_cNum(cx)}" y="${_cNum(cy - 2)}" text-anchor="middle" font-size="${Math.min(20, inner / 2.4)}" font-weight="700" fill="currentColor">${_cFmt(total, unit)}</text>` +
            `<text x="${_cNum(cx)}" y="${_cNum(cy + 16)}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity=".6">${_cEsc(_cFit(ds.label || '合計', inner * 1.5, 11))}</text>`;
    }
    return out + legendSvg;
}

/* ---------- 與投影片 HTML 的銜接 ---------- */

/* 把 root 內的 [data-rs-chart] 容器換成對應圖表；measure(el) 回傳 {w,h}（投影片座標），沒有就用預設尺寸 */
function fillChartPlaceholders(root, charts, measure) {
    root.querySelectorAll('[data-rs-chart]').forEach(el => {
        const spec = (charts || [])[Number(el.getAttribute('data-rs-chart'))];
        if (!spec) { el.remove(); return; }             // 索引無對應資料：移除空容器，避免留下空白
        const size = (measure && measure(el)) || {};
        const w = size.w >= 80 ? size.w : RS_CHART_DEFAULT_W;
        const h = size.h >= 60 ? size.h : RS_CHART_DEFAULT_H;
        if (!(size.h >= 60)) el.style.height = h + 'px'; // 容器沒有高度（LLM 漏寫）時給固定高度
        el.innerHTML = renderChartSvg(spec, w, h);
    });
}

/* 在畫面外以 1024×576 渲染投影片，量測每個圖表容器的實際尺寸後畫入 SVG（async：需等 Tailwind CDN 產生 class 樣式） */
async function bakeSlideCharts(slides) {
    const targets = (slides || []).filter(s => s && typeof s.html_content === 'string' && /data-rs-chart/.test(s.html_content));
    if (!targets.length) return;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-5000px;top:0;width:1024px;height:576px;overflow:hidden;pointer-events:none;visibility:hidden';
    document.body.appendChild(host);
    try {
        for (const slide of targets) {
            const frame = document.createElement('div');
            frame.className = 'slide-scaler';
            frame.innerHTML = slide.html_content;
            // 先清空容器內容，量到的是版面給的空間而不是舊圖表撐出來的大小
            frame.querySelectorAll('[data-rs-chart]').forEach(el => { el.innerHTML = ''; });
            host.replaceChildren(frame);
            await new Promise(r => setTimeout(r, 60));
            fillChartPlaceholders(frame, slide.charts, el => ({ w: el.offsetWidth, h: el.offsetHeight }));
            slide.html_content = frame.innerHTML;
        }
    } finally {
        host.remove();
    }
}
