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
    // 「插入」選單中的「品牌」項目
    document.getElementById('brandPickerBtn').classList.toggle('hidden', !brandIcons.length);
    renderBrandPicker();
}

// 插入位置：Logo 通常放在固定的角落，預設右上；選擇記在瀏覽器
const BRAND_POSITIONS = [['tr', '右上'], ['tl', '左上'], ['br', '右下'], ['bl', '左下'], ['center', '置中']];
const BRAND_POS_KEY = 'rslide_brand_pos';
let brandPos = 'tr';
try { brandPos = BRAND_POSITIONS.some(p => p[0] === localStorage.getItem(BRAND_POS_KEY)) ? localStorage.getItem(BRAND_POS_KEY) : 'tr'; } catch (e) { }
// 品牌 Logo 的預設大小（投影片座標）：放在角落時不會太搶眼，插入後仍可縮放
const BRAND_MAX_W = 180, BRAND_MAX_H = 90;

function renderBrandPicker() {
    document.getElementById('brandPicker').innerHTML = `
        <div class="px-1 pb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">企業 / 品牌識別圖示</div>
        <div class="brand-pos" role="radiogroup" aria-label="插入位置">
            <span>插入位置</span>${BRAND_POSITIONS.map(([v, l]) => `<button type="button" role="radio" data-pos="${v}" aria-checked="${v === brandPos}">${l}</button>`).join('')}
        </div>
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
        const img = await insertSlideImage(new File([blob], icon.file, { type: blob.type }), null,
            { corner: brandPos === 'center' ? null : brandPos, maxW: BRAND_MAX_W, maxH: BRAND_MAX_H, quiet: true });
        if (!img) return;
        const multi = currentPresentationData.slides.length > 1;
        showToast(`已插入「${icon.name}」` + (multi ? '，要放在每一頁的相同位置嗎？' : ''), 'success', multi ? 8000 : 2600,
            multi ? { label: '複製到所有頁面', onClick: () => { if (img.isConnected) copyToAllSlides(img); } } : undefined);
    } catch (err) {
        if (!err.handled) showToast('無法插入品牌圖示：' + friendlyError(err), 'error', 5000);
    }
}

(function initBrandPicker() {
    const panel = document.getElementById('brandPicker');
    panel.addEventListener('click', e => {
        const pos = e.target.closest('[data-pos]');
        if (pos) {
            brandPos = pos.dataset.pos;
            try { localStorage.setItem(BRAND_POS_KEY, brandPos); } catch (err) { }
            panel.querySelectorAll('[data-pos]').forEach(b => b.setAttribute('aria-checked', String(b === pos)));
            return;
        }
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
        if (!e.target.closest('#brandPicker') && !e.target.closest('#insertMenu')) closeBrandPicker();
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
    const r = document.getElementById('insertBtn').getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    panel.style.width = w + 'px';
    const h = panel.offsetHeight;
    const up = r.top - 16 >= h || r.top > window.innerHeight - r.bottom;
    panel.style.left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8) + 'px';
    panel.style.top = (up ? Math.max(8, r.top - 8 - h) : r.bottom + 8) + 'px';
}
window.addEventListener('resize', positionBrandPicker);
