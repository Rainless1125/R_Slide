/* 企業 / 品牌識別圖示：伺服器 brand_icon 資料夾中的圖片（見 brand_icons.py），插入方式與一般圖片相同
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 media.js 之後）。 */
let brandIcons = [];

const brandIconUrl = icon => '/api/brand-icons/' + encodeURIComponent(icon.file);

// 登入後讀取清單；沒有任何品牌圖示時不顯示「品牌」按鈕
async function loadBrandIcons() {
    brandIcons = [];
    try {
        const res = await fetch('/api/brand-icons');
        if (res.ok) brandIcons = await res.json();
    } catch (e) { }
    const btn = document.getElementById('brandPickerBtn');
    const has = brandIcons.length > 0;
    btn.toggleAttribute('data-edit-only', has);           // 編輯模式的按鈕由 toggleEditMode 依 data-edit-only 顯示
    btn.classList.toggle('hidden', !(has && editMode));
    btn.classList.toggle('flex', has && editMode);
    renderBrandPicker();
}

function renderBrandPicker() {
    document.getElementById('brandPicker').innerHTML = `
        <div class="px-1 pb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">企業 / 品牌識別圖示</div>
        <div class="brand-grid">${brandIcons.map((icon, i) => `
            <button type="button" class="brand-cell" data-i="${i}" title="插入「${esc(icon.name)}」" aria-label="插入${esc(icon.name)}">
                <span class="brand-thumb"><img src="${brandIconUrl(icon)}" alt="" loading="lazy" draggable="false"></span>
                <span class="brand-name">${esc(icon.name)}</span>
            </button>`).join('')}</div>`;
}

async function insertBrandIcon(icon) {
    try {
        const res = await fetch(brandIconUrl(icon));
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const blob = await res.blob();
        await insertSlideImage(new File([blob], icon.file, { type: blob.type }));
    } catch (err) {
        if (!err.handled) showToast('無法插入品牌圖示：' + friendlyError(err), 'error', 5000);
    }
}

(function initBrandPicker() {
    const panel = document.getElementById('brandPicker');
    panel.addEventListener('click', e => {
        const c = e.target.closest('.brand-cell');
        if (!c) return;
        closeBrandPicker();
        insertBrandIcon(brandIcons[Number(c.dataset.i)]);
    });
    // 方向鍵在圖示間移動（一列 3 個）
    panel.addEventListener('keydown', e => {
        const cells = [...panel.querySelectorAll('.brand-cell')];
        const i = cells.indexOf(document.activeElement);
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key];
        if (i < 0 || !step) return;
        e.preventDefault();
        e.stopPropagation();
        cells[Math.min(cells.length - 1, Math.max(0, i + step))].focus();
    });
    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#brandPicker') && !e.target.closest('#brandPickerBtn')) closeBrandPicker();
    });
})();

function isBrandPickerOpen() { return !document.getElementById('brandPicker').classList.contains('hidden'); }
function toggleBrandPicker() {
    if (isBrandPickerOpen()) { closeBrandPicker(); return; }
    if (!editMode || !currentPresentationData || !brandIcons.length) return;
    stopTextEdit();
    closeIconPicker();
    closeShapePicker();
    document.getElementById('brandPicker').classList.remove('hidden');
    document.getElementById('brandPickerBtn').setAttribute('aria-expanded', 'true');
    positionBrandPicker();
    document.querySelector('#brandPicker .brand-cell')?.focus();
}
function closeBrandPicker() {
    const panel = document.getElementById('brandPicker');
    if (!panel || panel.classList.contains('hidden')) return;
    panel.classList.add('hidden');
    document.getElementById('brandPickerBtn').setAttribute('aria-expanded', 'false');
}
// 與圖案面板相同：空間夠就往上開，否則往下開
function positionBrandPicker() {
    if (!isBrandPickerOpen()) return;
    const panel = document.getElementById('brandPicker');
    const r = document.getElementById('brandPickerBtn').getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    panel.style.width = w + 'px';
    const h = panel.offsetHeight;
    const up = r.top - 16 >= h || r.top > window.innerHeight - r.bottom;
    panel.style.left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8) + 'px';
    panel.style.top = (up ? Math.max(8, r.top - 8 - h) : r.bottom + 8) + 'px';
}
window.addEventListener('resize', positionBrandPicker);
