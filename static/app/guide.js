/* 使用教學 Modal：右上角「?」按鈕開啟，左側章節分頁 + 底部上一步 / 下一步
 * 一般 <script>，在 main.js 之前載入；Esc 關閉由 main.js 的全域快捷鍵處理。 */
let guideIdx = 0;
let guideReturnFocus = null;

function guideTabs() { return [...document.querySelectorAll('#guideNav [data-guide]')]; }
function isGuideOpen() { return !document.getElementById('guideModal').classList.contains('hidden'); }

function showGuideTab(idx, focusTab = false) {
    const tabs = guideTabs();
    guideIdx = Math.max(0, Math.min(tabs.length - 1, idx));
    tabs.forEach((t, i) => {
        const on = i === guideIdx;
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.tabIndex = on ? 0 : -1;
        document.querySelector(`[data-guide-panel="${t.dataset.guide}"]`).hidden = !on;
    });
    const cur = tabs[guideIdx];
    cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focusTab) cur.focus();
    document.getElementById('guideBody').scrollTop = 0;
    document.getElementById('guidePrev').disabled = guideIdx === 0;
    const last = guideIdx === tabs.length - 1;
    document.getElementById('guideNextLabel').textContent = last ? '開始使用' : '下一步';
    document.getElementById('guideNextIcon').className = last ? 'fa-solid fa-check text-[11px]' : 'fa-solid fa-arrow-right text-[11px]';
    document.getElementById('guideProgress').textContent = `${String(guideIdx + 1).padStart(2, '0')} / ${String(tabs.length).padStart(2, '0')}`;
}

function openGuide() {
    guideReturnFocus = document.activeElement;
    document.getElementById('guideModal').classList.remove('hidden');
    showGuideTab(guideIdx, true);
}

// 直接開啟某個章節（例如編輯列的「編輯說明與快捷鍵」）
function openGuideSection(key) {
    const idx = guideTabs().findIndex(t => t.dataset.guide === key);
    if (idx >= 0) guideIdx = idx;
    openGuide();
}

function closeGuide() {
    document.getElementById('guideModal').classList.add('hidden');
    guideReturnFocus?.focus?.();
    guideReturnFocus = null;
}

function stepGuide(delta) {
    if (delta > 0 && guideIdx === guideTabs().length - 1) { guideIdx = 0; closeGuide(); return; }
    showGuideTab(guideIdx + delta);
}

(function () {
    const nav = document.getElementById('guideNav');
    guideTabs().forEach((t, i) => {
        t.id = 'guideTab-' + t.dataset.guide;
        t.setAttribute('aria-controls', 'guidePanel-' + t.dataset.guide);
        const panel = document.querySelector(`[data-guide-panel="${t.dataset.guide}"]`);
        panel.id = 'guidePanel-' + t.dataset.guide;
        panel.setAttribute('aria-labelledby', t.id);
        t.addEventListener('click', () => showGuideTab(i));
    });
    // 分頁列：方向鍵切換章節（WAI-ARIA tabs）
    nav.addEventListener('keydown', (e) => {
        const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (d) { e.preventDefault(); showGuideTab(guideIdx + d, true); }
        else if (e.key === 'Home') { e.preventDefault(); showGuideTab(0, true); }
        else if (e.key === 'End') { e.preventDefault(); showGuideTab(guideTabs().length - 1, true); }
    });
    showGuideTab(0);
})();
