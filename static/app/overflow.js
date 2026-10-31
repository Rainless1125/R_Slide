/* 版面檢查：找出超出畫布（1024×576 投影片範圍）的內容，這些內容在播放與匯出時會被裁掉
 * 只檢查畫布邊界：卡片內的圖表或文字超出卡片、但仍在畫布內時，視為使用者想要的佈局，不標示。
 * 編輯模式中以紅色虛線標示並在編輯列顯示提示；匯出前檢查每一頁，有問題時先詢問。
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 editor.js、media.js 之後）。 */
const OVERFLOW_TOLERANCE = 6;      // 容許的誤差（投影片座標 px）：大字級的字形、行高四捨五入會多出幾 px

// 元素「內容」實際佔用的範圍（含直接寫在元素內的文字與超出元素外框的部分）
function contentRect(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
}

// 元素或它的內容是否超出畫布
function crossesCanvas(el, canvas, tol) {
    const rects = [el.getBoundingClientRect(), contentRect(el)].filter(r => r.width || r.height);
    return rects.some(r => r.left < canvas.left - tol || r.top < canvas.top - tol
        || r.right > canvas.right + tol || r.bottom > canvas.bottom + tol);
}

// 純裝飾的色塊（沒有文字、圖片、圖示或圖表，例如 AI 刻意放在角落、只露出一半的光暈圓形）不算
function hasContent(el) {
    return !!el.textContent.trim() || !!el.querySelector('img, svg, i, [data-rs-chart]') || /^(IMG|SVG|I)$/i.test(el.tagName);
}

// 由外而內找出超出畫布的元素：看得到外框的區塊（整張卡片）或最內層的元素就停下來，
// 只是排版用的容器（grid / flex 外框）則往內找出實際超出的那一個，不會把同一列的每張卡片都標出來
function canvasCulprits(node, canvas, tol) {
    const out = [];
    for (const c of node.children) {
        if (c.hasAttribute('data-rs-float')) continue;
        if (!hasContent(c) || !crossesCanvas(c, canvas, tol)) continue;
        // 圖表、SVG 與圖片以整個物件為單位，不往內找
        if (isVisualBox(c) || !c.children.length || c.matches('svg, img, [data-rs-chart]')) { out.push(c); continue; }
        const deeper = canvasCulprits(c, canvas, tol);
        out.push(...(deeper.length ? deeper : [c]));
    }
    return out;
}

// 一頁（.slide-scaler）中超出畫布的元素。自行插入的浮動物件（圖片、Logo 等）可能刻意貼齊或超出頁面邊緣，不檢查
function findOverflows(scaler) {
    const root = scaler.children.length === 1 ? scaler.firstElementChild : scaler;
    if (!root) return [];
    const canvas = scaler.getBoundingClientRect();
    const tol = OVERFLOW_TOLERANCE * canvas.width / SLIDE_W;   // 縮圖以 transform 縮小
    return canvasCulprits(root, canvas, tol);
}

/* ----- 編輯模式：標示目前頁面 ----- */
let overflowTimer = null;
// 修改後稍等再檢查：Tailwind（瀏覽器版）要等下一個畫面才會產生新 class 的樣式
function scheduleOverflowCheck() {
    clearTimeout(overflowTimer);
    overflowTimer = setTimeout(markOverflows, 150);
}

function markOverflows() {
    const scaler = getScaler();
    const badge = document.getElementById('overflowBadge');
    document.querySelectorAll('#slideCanvas [data-rs-overflow]').forEach(el => el.removeAttribute('data-rs-overflow'));
    if (!editMode || !scaler) { badge.classList.add('hidden'); return; }
    const found = findOverflows(scaler);
    found.forEach(el => el.setAttribute('data-rs-overflow', '1'));
    badge.classList.toggle('hidden', !found.length);
    badge.classList.toggle('flex', !!found.length);
    document.getElementById('overflowBadgeLabel').textContent = `${found.length} 處內容超出畫面`;
}

// 點提示：依序選取超出的元素，方便修改（縮小字級、精簡文字或用 AI 修改）
function selectNextOverflow() {
    const found = [...document.querySelectorAll('#slideCanvas [data-rs-overflow]')];
    if (!found.length) return;
    const next = found[(found.indexOf(selectedEl) + 1) % found.length];
    stopTextEdit();
    selectElement(next);
    // 只捲動頁面讓投影片可見；不可對投影片內的元素 scrollIntoView，否則會捲動 overflow-hidden 的容器（整頁內容偏移）
    slideCanvasEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ----- 匯出前檢查整份簡報 ----- */
// 目前頁面量畫面上的投影片，其他頁量播放器的縮圖（縮圖以 transform 縮小，版面仍是 1024×576）
function deckOverflowPages() {
    const pages = [];
    (currentPresentationData?.slides || []).forEach((_, i) => {
        const scaler = i === currentSlideIdx ? getScaler()
            : document.querySelector(`#thumbnailContainer .thumb[data-idx="${i}"] .slide-scaler`);
        const n = scaler ? findOverflows(scaler).length : 0;
        if (n) pages.push({ idx: i, count: n });
    });
    return pages;
}

let overflowExportRun = null;
// 匯出前呼叫：沒有問題直接匯出；有問題時列出頁面，讓使用者選擇前往修改或仍要匯出
function guardExportOverflow(run) {
    const pages = deckOverflowPages();
    if (!pages.length) { run(); return; }
    overflowExportRun = run;
    document.getElementById('overflowPages').innerHTML = pages.map(p => `
        <li class="flex items-center justify-between gap-3 py-2">
            <span><b>第 ${p.idx + 1} 頁</b><span class="text-zinc-500 dark:text-zinc-400">：${p.count} 處內容超出畫面</span></span>
            <button type="button" data-goto="${p.idx}" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">前往修改</button>
        </li>`).join('');
    document.getElementById('overflowModal').classList.remove('hidden');
    document.getElementById('overflowExportBtn').focus();
}

function closeOverflowModal() {
    document.getElementById('overflowModal').classList.add('hidden');
    overflowExportRun = null;
}

(function initOverflowModal() {
    document.getElementById('overflowPages').addEventListener('click', e => {
        const b = e.target.closest('[data-goto]');
        if (!b) return;
        closeOverflowModal();
        renderSlide(Number(b.dataset.goto));
        toggleEditMode(true);            // 編輯模式才會標示超出的元素
        setTimeout(selectNextOverflow, 400);
    });
    document.getElementById('overflowExportBtn').addEventListener('click', () => {
        const run = overflowExportRun;
        closeOverflowModal();
        run?.();
    });
})();

function isOverflowModalOpen() { return !document.getElementById('overflowModal').classList.contains('hidden'); }
