/* 全域快捷鍵與啟動
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 全域事件 ===================== */
// 捲動 / 縮放時重新定位格式工具列與浮動物件框。放在最後載入的 main.js：這些事件在頁面載入途中就可能觸發，
// 而 positionToolbar 會呼叫 media.js 的 positionFloatBox，必須等所有 app/*.js 都載入後才註冊
window.addEventListener('scroll', () => { positionToolbar(); hidePalette(); positionIconPicker(); }, { passive: true });
window.addEventListener('resize', () => { positionToolbar(); hidePalette(); positionIconPicker(); });
new ResizeObserver(() => positionToolbar()).observe(document.getElementById('slideCanvas'));

document.addEventListener('keydown', (e) => {
    if (isAuthOpen()) return;                     // 登入畫面開啟時不觸發任何快捷鍵
    if (!document.getElementById('chartModal').classList.contains('hidden')) {
        if (e.key === 'Escape') { e.preventDefault(); closeChartEditor(); }
        return;                                   // 圖表視窗開啟時不觸發換頁 / 刪除等快捷鍵
    }
    if (isIconPickerOpen()) {
        if (e.key === 'Escape') { e.preventDefault(); closeIconPicker(); document.getElementById('iconPickerBtn').focus(); return; }
        if (e.target.closest?.('#iconPicker')) return;   // 面板內的輸入 / 方向鍵不觸發換頁等快捷鍵
    }
    if (e.key === 'Escape' && !document.getElementById('regenModal').classList.contains('hidden')) {
        e.preventDefault();
        closeRegenerateModal();
        return;
    }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !!e.target.isContentEditable;
    if (e.key === 'Escape' && e.target.isContentEditable && e.target.closest('#slideCanvas')) { e.target.blur(); return; }
    if (e.key === 'Escape' && editMode && selectedEl && !typing) { clearSelection(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && editMode && selectedEl && !typing) { e.preventDefault(); runFmt('remove'); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && currentPresentationData) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
    }
    if (document.getElementById('sectionPlayer').classList.contains('hidden')) return;
    if (typing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prevSlide(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); nextSlide(); }
    else if (e.key === 'Home') renderSlide(0);
    else if (e.key === 'End') renderSlide(currentPresentationData.slides.length - 1);
    else if (e.key.toLowerCase() === 'f') toggleFullscreen();
    else if (e.key.toLowerCase() === 'n') toggleNotesPanel();
    else if (e.key.toLowerCase() === 'p') openPresenterView();
    else if (e.key === ' ') { e.preventDefault(); toggleAutoplay(); }
});

// 觸控滑動
(function () {
    const canvas = document.getElementById('slideCanvas');
    let sx = 0, sy = 0;
    canvas.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    canvas.addEventListener('touchend', e => {
        const dx = e.changedTouches[0].clientX - sx;
        const dy = e.changedTouches[0].clientY - sy;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) dx < 0 ? nextSlide() : prevSlide();
    }, { passive: true });
})();

// 捲動：進度條 + header 陰影
window.addEventListener('scroll', () => {
    const h = document.documentElement;
    const max = h.scrollHeight - h.clientHeight;
    document.getElementById('scrollProgress').style.width = (max > 0 ? h.scrollTop / max * 100 : 0) + '%';
    document.getElementById('topHeader').classList.toggle('shadow-md', h.scrollTop > 8);
}, { passive: true });

// 視窗大小變化時同步側邊欄圖示
window.addEventListener('resize', () => {
    const open = document.body.classList.contains('sb-open');
    document.getElementById('sbIcon').className = open && window.innerWidth < 1024 ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
});

// 光斑跟隨滑鼠
document.addEventListener('pointermove', e => {
    const el = e.target.closest && e.target.closest('.spot');
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top) + 'px');
});

// 按鈕漣漪
document.addEventListener('click', e => {
    const btn = e.target.closest('.ripple-btn');
    if (!btn || btn.disabled) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    btn.appendChild(s);
    setTimeout(() => s.remove(), 600);
});

// 生成按鈕粒子爆發
document.body.insertAdjacentHTML('beforeend', '<canvas id="fxCanvas" aria-hidden="true"></canvas>');
const fxCv = document.getElementById('fxCanvas');
const fxCtx = fxCv.getContext('2d');
const FX_COLORS = ['#7c5cff', '#22d3ee', '#ff5ca8', '#ffb23e', '#ffffff'];
let fxParts = [], fxRaf = 0, lastGenClick = null;
const fxReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function fxResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fxCv.width = innerWidth * dpr; fxCv.height = innerHeight * dpr;
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
fxResize(); addEventListener('resize', fxResize);
function fxStar(x, y, r, rot) {
    fxCtx.beginPath();
    for (let i = 0; i < 8; i++) {
        const a = rot + i * Math.PI / 4, d = i % 2 ? r * .38 : r;
        fxCtx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * d, y + Math.sin(a) * d);
    }
    fxCtx.closePath(); fxCtx.fill();
}
function fxBurst(x, y) {
    if (fxReduce) return;
    for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 6;
        fxParts.push({
            x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.5, r: 3 + Math.random() * 6,
            rot: Math.random() * 6, vr: (Math.random() - .5) * .3, life: 1, decay: .014 + Math.random() * .014,
            c: FX_COLORS[(Math.random() * FX_COLORS.length) | 0], star: Math.random() < .55
        });
    }
    if (!fxRaf) fxRaf = requestAnimationFrame(fxTick);
}
function fxTick() {
    fxCtx.clearRect(0, 0, innerWidth, innerHeight);
    fxParts = fxParts.filter(p => p.life > 0);
    for (const p of fxParts) {
        p.vy += .16; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
        fxCtx.globalAlpha = Math.max(p.life, 0); fxCtx.fillStyle = p.c;
        if (p.star) fxStar(p.x, p.y, p.r, p.rot);
        else { fxCtx.beginPath(); fxCtx.arc(p.x, p.y, p.r * .45, 0, 6.3); fxCtx.fill(); }
    }
    fxCtx.globalAlpha = 1;
    fxRaf = fxParts.length ? requestAnimationFrame(fxTick) : 0;
    if (!fxRaf) fxCtx.clearRect(0, 0, innerWidth, innerHeight);
}
function burstFromButton(useClick) {
    const r = document.getElementById('btnGenerate').getBoundingClientRect();
    if (useClick && lastGenClick) fxBurst(lastGenClick.x, lastGenClick.y);
    else fxBurst(r.left + r.width / 2, r.top + r.height / 2);
    lastGenClick = null;
}
document.getElementById('btnGenerate').addEventListener('pointerdown', e => {
    lastGenClick = { x: e.clientX, y: e.clientY };
});

setStep(1);
renderHistory(true);
restoreDraft();
initAuth();
