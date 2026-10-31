/* 版面檢查：找出內容超出外框（或整頁超出 1024×576 畫面）的元素
 * 編輯模式中以紅色虛線標示並在編輯列顯示提示；匯出前檢查每一頁，有問題時先詢問。
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 editor.js、media.js 之後）。 */
const OVERFLOW_TOLERANCE = 6;      // 容許的誤差（px）：大字級的字形、行高四捨五入會多出幾 px

// 元素的內容是否超出自己的外框（含 overflow-hidden 被裁掉的內容）
function isOverflowing(el) {
    if (el.closest('svg') || el.tagName === 'IMG' || el.tagName === 'I' || el.hasAttribute('data-rs-chart')) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || cs.display === 'contents' || cs.display === 'none') return false;
    if (!el.clientWidth && !el.clientHeight) return false;
    return el.scrollHeight > el.clientHeight + OVERFLOW_TOLERANCE || el.scrollWidth > el.clientWidth + OVERFLOW_TOLERANCE;
}

// 元素「內容」實際佔用的範圍（含直接寫在元素內的文字），不受 grid / flex 把元素拉高的影響
function contentRect(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
}

// 排版容器（或整頁）超出時，真正要修改的是把它撐出去的區塊：往內找出「內容」超出容器範圍的子元素，
// 遇到看得到外框的區塊（卡片）就停下來。例如三張並排的卡片被拉成一樣高時，只標出內容太多的那一張
function overflowCulprits(node, bound, tol) {
    const out = [];
    for (const c of node.children) {
        if (c.closest('svg') || c.hasAttribute('data-rs-float')) continue;
        const r = contentRect(c);
        if (!(r.width || r.height)) continue;
        if (r.bottom <= bound.bottom + tol && r.right <= bound.right + tol) continue;
        const deeper = isVisualBox(c) ? [] : overflowCulprits(c, bound, tol);
        out.push(...(deeper.length ? deeper : [c]));
    }
    return out;
}

// 一頁（.slide-scaler）中超出外框的元素。先找出內容超出的最內層元素（子孫也超出時，外層通常只是被撐出去的連帶結果）；
// 它是排版容器或整頁時，改標出把它撐出去的區塊（見 overflowCulprits）。
// 自行插入的浮動物件（圖片、Logo 等）可能刻意放在頁面邊緣，量測時暫時隱藏，不算整頁超出
function findOverflows(scaler) {
    const root = scaler.children.length === 1 ? scaler.firstElementChild : scaler;
    if (!root) return [];
    const floats = [...root.querySelectorAll('[data-rs-float]')];
    const prev = floats.map(f => f.style.display);
    floats.forEach(f => { f.style.display = 'none'; });
    try {
        const flagged = [root, ...root.querySelectorAll('*')].filter(el => !el.closest('[data-rs-float]') && isOverflowing(el));
        const innermost = flagged.filter(el => !flagged.some(o => o !== el && el.contains(o)));
        const result = new Set();
        for (const el of innermost) {
            if (isVisualBox(el) && el !== root) { result.add(el); continue; }
            const box = el.getBoundingClientRect();
            const tol = OVERFLOW_TOLERANCE * (box.height / (el.offsetHeight || box.height || 1));   // 縮圖以 transform 縮小
            const culprits = overflowCulprits(el, box, tol);
            (culprits.length ? culprits : [el]).forEach(c => result.add(c));
        }
        return [...result];
    } finally {
        floats.forEach((f, i) => { f.style.display = prev[i]; });
    }
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
    document.getElementById('overflowBadgeLabel').textContent = `${found.length} 處內容超出外框`;
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
            <span><b>第 ${p.idx + 1} 頁</b><span class="text-zinc-500 dark:text-zinc-400">：${p.count} 處內容超出外框或畫面</span></span>
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
