/* ===================== 圖表數據表格（類似 Handsontable 的輕量試算表） =====================
 * 不引入外部套件（Handsontable 商用需授權、體積也大），以 <input> 組成的表格實作常用操作：
 *   - 點選儲存格即選取；直接打字會取代內容，雙擊 / F2 / Enter 以外的編輯鍵進入編輯（游標可移動）
 *   - 方向鍵、Tab、Enter 移動；Shift + 方向鍵或滑鼠拖曳選取範圍；Ctrl+A 全選
 *   - Delete / Backspace 清除範圍；Ctrl+C / Ctrl+X 複製 / 剪下為 Tab 分隔文字
 *   - 貼上 Excel / Google 試算表的多格資料會自動展開列與欄（受 maxRows / maxCols 限制）
 *   - 第一列為系列名稱、第一欄為類別標籤；可新增 / 刪除列與欄
 *
 *   const grid = createChartGrid(container, { maxRows, maxCols, onChange, onNotice })
 *   grid.setRows(rows)  rows 為字串二維陣列（含標題列）
 *   grid.getRows()      回傳目前內容（複本）
 *   grid.focus()        聚焦到第一個數據儲存格
 */

function createChartGrid(container, opts = {}) {
    const maxRows = opts.maxRows || 13, maxCols = opts.maxCols || 5;
    const minRows = 2, minCols = 2;
    const onChange = opts.onChange || (() => { });
    const onNotice = opts.onNotice || (() => { });

    let rows = [['', ''], ['', '']];
    let anchor = { r: 1, c: 0 }, head = { r: 1, c: 0 };
    let editing = false, editOrig = '';
    let dragging = false;
    let inputs = [];                 // inputs[r][c]

    container.classList.add('rs-grid');
    const scroller = document.createElement('div');
    scroller.className = 'rs-grid-scroll';
    const table = document.createElement('table');
    scroller.appendChild(table);
    const tools = document.createElement('div');
    tools.className = 'rs-grid-tools';
    tools.innerHTML =
        '<button type="button" data-act="add-row"><i class="fa-solid fa-plus"></i>新增類別</button>' +
        '<button type="button" data-act="add-col"><i class="fa-solid fa-plus"></i>新增系列</button>' +
        '<button type="button" data-act="clear"><i class="fa-solid fa-eraser"></i>清空</button>';
    container.replaceChildren(scroller, tools);

    const width = () => rows[0].length;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const range = () => ({
        r0: Math.min(anchor.r, head.r), r1: Math.max(anchor.r, head.r),
        c0: Math.min(anchor.c, head.c), c1: Math.max(anchor.c, head.c)
    });
    const changed = () => onChange(getRows());

    function normalize(src) {
        let out = (Array.isArray(src) ? src : []).slice(0, maxRows).map(r => (Array.isArray(r) ? r : []).slice(0, maxCols).map(v => String(v ?? '')));
        const w = clamp(Math.max(0, ...out.map(r => r.length)), minCols, maxCols);
        while (out.length < minRows) out.push([]);
        return out.map(r => { r = r.slice(); while (r.length < w) r.push(''); return r; });
    }

    /* ---------- 繪製 ---------- */
    function build() {
        const w = width();
        let html = '<thead><tr><th class="rs-corner"></th>';
        for (let c = 0; c < w; c++) {
            const del = c > 0 && w > minCols ? `<button type="button" class="rs-del" data-del-col="${c}" title="刪除此系列" aria-label="刪除系列 ${c}">×</button>` : '';
            html += `<th class="rs-colhead">${c === 0 ? '類別' : '系列 ' + c}${del}</th>`;
        }
        html += '</tr></thead><tbody>';
        rows.forEach((row, r) => {
            const del = r > 0 && rows.length > minRows ? `<button type="button" class="rs-del" data-del-row="${r}" title="刪除此列" aria-label="刪除第 ${r} 列">×</button>` : '';
            html += `<tr class="${r === 0 ? 'rs-namerow' : ''}"><th class="rs-rowhead">${r === 0 ? '名稱' : r}${del}</th>`;
            for (let c = 0; c < w; c++) {
                const ph = r === 0 ? (c === 0 ? '類別' : '系列名稱') : (c === 0 ? '標籤' : '0');
                const label = r === 0 ? (c === 0 ? '類別欄標題' : `系列 ${c} 名稱`) : (c === 0 ? `第 ${r} 列標籤` : `第 ${r} 列系列 ${c} 數值`);
                html += `<td data-r="${r}" data-c="${c}"><input data-r="${r}" data-c="${c}" spellcheck="false" autocomplete="off" placeholder="${ph}" aria-label="${label}" class="${r > 0 && c > 0 ? 'rs-num' : ''}"></td>`;
            }
            html += '</tr>';
        });
        table.innerHTML = html + '</tbody>';
        inputs = rows.map((_, r) => Array.from({ length: w }, (_, c) => table.querySelector(`input[data-r="${r}"][data-c="${c}"]`)));
        rows.forEach((row, r) => row.forEach((v, c) => { inputs[r][c].value = v; }));
        tools.querySelector('[data-act="add-row"]').disabled = rows.length >= maxRows;
        tools.querySelector('[data-act="add-col"]').disabled = w >= maxCols;
        anchor = { r: clamp(anchor.r, 0, rows.length - 1), c: clamp(anchor.c, 0, w - 1) };
        head = { r: clamp(head.r, 0, rows.length - 1), c: clamp(head.c, 0, w - 1) };
        paintSelection();
    }

    function paintSelection() {
        const { r0, r1, c0, c1 } = range();
        const multi = r0 !== r1 || c0 !== c1;
        table.querySelectorAll('td').forEach(td => {
            const r = +td.dataset.r, c = +td.dataset.c;
            td.classList.toggle('rs-sel', multi && r >= r0 && r <= r1 && c >= c0 && c <= c1);
            td.classList.toggle('rs-cur', r === head.r && c === head.c);
            td.classList.toggle('rs-editing', editing && r === head.r && c === head.c);
        });
        table.querySelectorAll('.rs-colhead').forEach((th, c) => th.classList.toggle('rs-hl', c >= c0 && c <= c1));
        table.querySelectorAll('.rs-rowhead').forEach((th, r) => th.classList.toggle('rs-hl', r >= r0 && r <= r1));
    }

    /* ---------- 選取與移動 ---------- */
    function select(r, c, extend = false) {
        r = clamp(r, 0, rows.length - 1); c = clamp(c, 0, width() - 1);
        if (editing) commitEdit();
        head = { r, c };
        if (!extend) anchor = { r, c };
        const inp = inputs[r][c];
        if (document.activeElement !== inp) inp.focus({ preventScroll: true });
        inp.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        inp.select();
        paintSelection();
    }

    function startEdit(caretEnd = true) {
        const inp = inputs[head.r][head.c];
        anchor = { ...head };
        editing = true;
        editOrig = rows[head.r][head.c];
        if (caretEnd) { const n = inp.value.length; inp.setSelectionRange(n, n); }
        paintSelection();
    }

    function commitEdit() {
        editing = false;
        paintSelection();
    }

    function cancelEdit() {
        const inp = inputs[head.r][head.c];
        inp.value = editOrig;
        rows[head.r][head.c] = editOrig;
        editing = false;
        inp.select();
        paintSelection();
        changed();
    }

    // Enter 在最後一列往下時自動新增一列
    function moveDown(back) {
        if (!back && head.r === rows.length - 1 && rows.length < maxRows && rows[head.r].some(v => v.trim())) {
            addRow();
        }
        select(head.r + (back ? -1 : 1), head.c);
    }

    /* ---------- 編輯操作 ---------- */
    function setCell(r, c, v) {
        rows[r][c] = v;
        if (inputs[r]?.[c]) inputs[r][c].value = v;
    }

    function clearRange() {
        const { r0, r1, c0, c1 } = range();
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) setCell(r, c, '');
        changed();
    }

    function rangeText() {
        const { r0, r1, c0, c1 } = range();
        return rows.slice(r0, r1 + 1).map(row => row.slice(c0, c1 + 1).join('\t')).join('\n');
    }

    function parseClipboard(text) {
        const lines = String(text).replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
        const tab = lines.some(l => l.includes('\t'));
        // 沒有 Tab 的多列文字視為逗號分隔（相容舊版的文字輸入格式）
        const comma = !tab && lines.length > 1 && lines.every(l => /[,，]/.test(l) || !l.trim());
        return lines.map(l => (tab ? l.split('\t') : comma ? l.split(/[,，]/) : [l]).map(v => v.trim()));
    }

    function paste(text) {
        const data = parseClipboard(text);
        if (!data.length) return;
        const { r0, r1, c0, c1 } = range();
        // 單一值貼到多格範圍：填滿範圍
        if (data.length === 1 && data[0].length === 1 && (r0 !== r1 || c0 !== c1)) {
            for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) rows[r][c] = data[0][0];
            build(); changed();
            return;
        }
        const needRows = r0 + data.length, needCols = c0 + Math.max(...data.map(d => d.length));
        const truncated = needRows > maxRows || needCols > maxCols;
        while (rows.length < Math.min(needRows, maxRows)) rows.push(Array(width()).fill(''));
        const w = Math.min(Math.max(width(), needCols), maxCols);
        rows.forEach(row => { while (row.length < w) row.push(''); });
        data.forEach((line, i) => line.forEach((v, j) => {
            const r = r0 + i, c = c0 + j;
            if (r < maxRows && c < w) rows[r][c] = v;
        }));
        anchor = { r: r0, c: c0 };
        head = { r: Math.min(needRows, maxRows) - 1, c: Math.min(needCols, w) - 1 };
        editing = false;
        build();
        inputs[head.r][head.c].focus({ preventScroll: true });
        changed();
        if (truncated) onNotice(`已貼上，但超出上限的部分已略過（最多 ${maxRows - 1} 個類別、${maxCols - 1} 個系列）`);
    }

    function addRow(at = rows.length) {
        if (rows.length >= maxRows) return;
        rows.splice(at, 0, Array(width()).fill(''));
        build(); changed();
    }
    function addCol(at = width()) {
        if (width() >= maxCols) return;
        rows.forEach(row => row.splice(at, 0, ''));
        build(); changed();
    }
    function delRow(r) {
        if (rows.length <= minRows || r < 1) return;
        rows.splice(r, 1);
        build(); changed();
    }
    function delCol(c) {
        if (width() <= minCols || c < 1) return;
        rows.forEach(row => row.splice(c, 1));
        build(); changed();
    }

    /* ---------- 事件 ---------- */
    const cellOf = el => {
        const inp = el?.closest?.('input[data-r]');
        return inp && table.contains(inp) ? { r: +inp.dataset.r, c: +inp.dataset.c, inp } : null;
    };

    table.addEventListener('mousedown', e => {
        const del = e.target.closest('.rs-del');
        if (del) {
            e.preventDefault();
            if (del.dataset.delRow) delRow(+del.dataset.delRow);
            else delCol(+del.dataset.delCol);
            return;
        }
        const cell = cellOf(e.target);
        if (!cell || e.button !== 0) return;
        if (editing && cell.r === head.r && cell.c === head.c) return;  // 編輯中點同一格：移動游標
        e.preventDefault();
        select(cell.r, cell.c, e.shiftKey);
        dragging = true;
    });
    table.addEventListener('mouseover', e => {
        if (!dragging) return;
        const cell = cellOf(e.target);
        if (cell && (cell.r !== head.r || cell.c !== head.c)) {
            head = { r: cell.r, c: cell.c };
            paintSelection();
        }
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    table.addEventListener('dblclick', e => {
        const cell = cellOf(e.target);
        if (!cell) return;
        select(cell.r, cell.c);
        startEdit();
    });

    table.addEventListener('focusin', e => {
        const cell = cellOf(e.target);
        if (!cell || (cell.r === head.r && cell.c === head.c)) return;
        // 以 Tab 等方式從外部聚焦進來
        editing = false;
        head = anchor = { r: cell.r, c: cell.c };
        cell.inp.select();
        paintSelection();
    });
    table.addEventListener('focusout', e => {
        if (!container.contains(e.relatedTarget)) { if (editing) commitEdit(); }
    });

    table.addEventListener('input', e => {
        const cell = cellOf(e.target);
        if (!cell) return;
        if (!editing) {               // 直接打字（含輸入法組字）：進入編輯並收合選取範圍
            editing = true;
            editOrig = rows[cell.r][cell.c];
            anchor = head = { r: cell.r, c: cell.c };
            paintSelection();
        }
        rows[cell.r][cell.c] = cell.inp.value;
        changed();
    });

    table.addEventListener('keydown', e => {
        const cell = cellOf(e.target);
        if (!cell || e.isComposing || e.keyCode === 229) return;
        const mod = e.ctrlKey || e.metaKey;
        const { r, c } = head;
        const shift = e.shiftKey;

        if (editing) {
            if (e.key === 'Enter') { e.preventDefault(); commitEdit(); moveDown(shift); }
            else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); select(r, c + (shift ? -1 : 1)); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
            else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !shift) {
                e.preventDefault(); commitEdit(); select(r + (e.key === 'ArrowUp' ? -1 : 1), c);
            }
            return;
        }

        const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (moves[e.key]) {
            e.preventDefault();
            const [dr, dc] = moves[e.key];
            if (mod) {
                const nr = dr ? (dr < 0 ? 0 : rows.length - 1) : head.r;
                const nc = dc ? (dc < 0 ? 0 : width() - 1) : head.c;
                select(nr, nc, shift);
            } else select(head.r + dr, head.c + dc, shift);
            return;
        }
        switch (e.key) {
            case 'Tab':
                if (shift ? c > 0 : c < width() - 1) { e.preventDefault(); select(r, c + (shift ? -1 : 1)); }
                return;
            case 'Enter':
                e.preventDefault(); moveDown(shift); return;
            case 'F2':
                e.preventDefault(); startEdit(); return;
            case 'Delete':
            case 'Backspace':
                e.preventDefault(); clearRange(); return;
            case 'Home':
                e.preventDefault(); select(mod ? 0 : r, 0, shift); return;
            case 'End':
                e.preventDefault(); select(mod ? rows.length - 1 : r, width() - 1, shift); return;
        }
        if (mod && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            anchor = { r: 0, c: 0 };
            head = { r: rows.length - 1, c: width() - 1 };
            paintSelection();
            return;
        }
        // 多格選取時開始打字：只取代目前儲存格
        if (!mod && e.key.length === 1) {
            anchor = { ...head };
            paintSelection();
        }
    });

    table.addEventListener('copy', e => {
        if (editing || !cellOf(e.target)) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', rangeText());
    });
    table.addEventListener('cut', e => {
        if (editing || !cellOf(e.target)) return;
        e.preventDefault();
        e.clipboardData.setData('text/plain', rangeText());
        clearRange();
    });
    table.addEventListener('paste', e => {
        if (!cellOf(e.target)) return;
        const text = e.clipboardData?.getData('text/plain') ?? '';
        // 編輯中貼上單一值：交給瀏覽器插入游標位置
        if (editing && !/[\t\n]/.test(text.replace(/\n+$/, ''))) return;
        e.preventDefault();
        paste(text);
    });

    tools.addEventListener('click', e => {
        const act = e.target.closest('button')?.dataset.act;
        if (act === 'add-row') { addRow(); select(rows.length - 1, 0); }
        else if (act === 'add-col') { addCol(); select(0, width() - 1); }
        else if (act === 'clear') {
            rows = normalize([rows[0].map(() => ''), rows[0].map(() => '')]);
            anchor = head = { r: 0, c: 0 };
            build(); changed(); select(0, 0);
        }
    });

    function getRows() { return rows.map(r => r.slice()); }
    function setRows(src) {
        rows = normalize(src);
        editing = false;
        anchor = head = { r: Math.min(1, rows.length - 1), c: 0 };
        build();
    }
    function focus() { select(Math.min(1, rows.length - 1), width() > 1 ? 1 : 0); }

    build();
    return { getRows, setRows, focus };
}
