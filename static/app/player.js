/* 頁面管理、播放器、自動播放、全螢幕、匯出選單
 * 由 index.html 拆出；所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
/* ===================== 頁面管理：標題、排序、複製、刪除 ===================== */
let dragSlideIdx = null;

function slideOpsAllowed() {
    if (!currentPresentationData) return false;
    if (regeneratingSlideIdx !== null || isGenerating()) {
        showToast('請等待目前的生成完成後再調整頁面', 'info', 2200);
        return false;
    }
    return true;
}

// 修改頁面順序／數量後：重新編號、同步歷史記錄、重畫審查頁
function finishSlideOps(keepSlide) {
    const slides = currentPresentationData.slides;
    slides.forEach((s, i) => { s.page_number = i + 1; });
    const at = keepSlide ? slides.indexOf(keepSlide) : -1;
    currentSlideIdx = at >= 0 ? at : Math.min(currentSlideIdx, slides.length - 1);
    syncCurrentPresentationToHistory();
    renderReviewSection(true);
    updateUndoButtons();
}

function moveSlide(from, to) {
    if (!slideOpsAllowed()) return;
    const slides = currentPresentationData.slides;
    if (from === to || from < 0 || to < 0 || from >= slides.length || to >= slides.length) return;
    pushUndoSnapshot();
    const keep = slides[currentSlideIdx];
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    finishSlideOps(keep);
}

function duplicateSlide(idx) {
    if (!slideOpsAllowed()) return;
    const slides = currentPresentationData.slides;
    if (idx < 0 || idx >= slides.length) return;
    pushUndoSnapshot();
    const keep = slides[currentSlideIdx];
    slides.splice(idx + 1, 0, JSON.parse(JSON.stringify(withoutVersions(slides[idx]))));
    finishSlideOps(keep);
    showToast(`已複製第 ${idx + 1} 頁`, 'success', 1800);
}

function deleteSlide(idx) {
    if (!slideOpsAllowed()) return;
    const slides = currentPresentationData.slides;
    if (slides.length <= 1) { showToast('至少要保留一頁', 'info', 2000); return; }
    if (idx < 0 || idx >= slides.length) return;
    pushUndoSnapshot();
    const keep = slides[currentSlideIdx] === slides[idx] ? null : slides[currentSlideIdx];
    slides.splice(idx, 1);
    if (!keep) currentSlideIdx = Math.min(idx, slides.length - 1);
    finishSlideOps(keep);
    showToast(`已刪除第 ${idx + 1} 頁`, 'info', 5000, { label: '復原', onClick: undo });
}

// 空白頁沿用參考頁最外層容器的 class / style（背景、文字顏色、內距），內容留空，再以編輯模式插入文字、圖片等
const BLANK_ROOT_CLASS = 'w-full h-full overflow-hidden flex flex-col p-10 bg-white text-zinc-900';
function blankSlideFrom(ref) {
    const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${ref?.html_content || ''}</body></html>`, 'text/html');
    const src = doc.body.children.length === 1 ? doc.body.firstElementChild : null;
    const root = doc.createElement('div');
    root.className = src?.getAttribute('class') || BLANK_ROOT_CLASS;
    const style = src?.getAttribute('style');
    if (style) root.setAttribute('style', style);
    return { page_number: 0, layout_concept: '空白頁', slide_title: '空白頁', html_content: root.outerHTML, charts: [], speaker_notes: '' };
}

// 在第 afterIdx 頁之後新增空白頁；open = true 時（播放器）切換到新頁面
function addBlankSlide(afterIdx, open = false) {
    if (!slideOpsAllowed()) return;
    const slides = currentPresentationData.slides;
    const ref = slides[Math.min(Math.max(afterIdx, 0), slides.length - 1)];
    const at = Math.min(Math.max(afterIdx + 1, 0), slides.length);
    if (open) { stopTextEdit(); commitSlideEdit(); }         // 先寫回目前頁面尚未存入的修改
    pushUndoSnapshot();
    const keep = slides[currentSlideIdx];
    slides.splice(at, 0, blankSlideFrom(ref));
    slides.forEach((s, i) => { s.page_number = i + 1; });
    if (open) {
        syncCurrentPresentationToHistory();
        buildThumbnails();
        renderSlide(at, 'fade');
        updateUndoButtons();
    } else {
        finishSlideOps(keep);
    }
    showToast(`已新增空白頁（第 ${at + 1} 頁）`, 'success', 1800);
}

function commitSlideTitle(idx, el) {
    const slide = currentPresentationData?.slides?.[idx];
    if (!slide) return;
    const title = el.textContent.replace(/\s+/g, ' ').trim();
    if (!title) { el.textContent = slide.slide_title; return; }
    el.textContent = title;
    if (title === slide.slide_title) return;
    pushUndoSnapshot();
    slide.slide_title = title;
    el.title = title;
    syncCurrentPresentationToHistory();
}

function onSlideDragStart(e, idx) {
    if (!slideOpsAllowed()) { e.preventDefault(); return; }
    dragSlideIdx = idx;
    const card = e.target.closest('.rv-card');
    if (card) { e.dataTransfer.setDragImage(card, 24, 24); card.classList.add('dragging'); }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
}
function onSlideDragEnd() {
    dragSlideIdx = null;
    document.querySelectorAll('.rv-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
}

/* ===================== 播放器 ===================== */
function fitSlide() {
    const canvas = document.getElementById('slideCanvas');
    const scaler = canvas.querySelector('.slide-scaler');
    if (!scaler) return;
    scaler.style.transform = `scale(${canvas.clientWidth / 1024})`;
}
new ResizeObserver(fitSlide).observe(document.getElementById('slideCanvas'));

function renderSlide(index, mode) {
    const total = currentPresentationData.slides.length;
    if (index < 0 || index >= total) return;
    const dir = mode || (index > currentSlideIdx ? 'right' : index < currentSlideIdx ? 'left' : 'fade');
    currentSlideIdx = index;
    const slide = currentPresentationData.slides[index];
    const canvas = document.getElementById('slideCanvas');

    const cls = dir === 'right' ? 'slide-in-right' : dir === 'left' ? 'slide-in-left' : 'slide-in-fade';
    canvas.innerHTML = `<div class="slide-anim ${cls}"><div class="slide-scaler">${slide.html_content}</div></div>`;
    fitSlide();
    document.getElementById('currentLayoutBadge').innerText = slide.layout_concept;
    if (editMode) { editingEl = null; clearSelection(); prepareEditing(); }

    document.getElementById('slideCounter').textContent = `${pad(index + 1)} / ${pad(total)}`;
    document.getElementById('slideProgress').style.width = ((index + 1) / total * 100) + '%';
    ['prevBtn', 'prevOverlay'].forEach(id => document.getElementById(id).disabled = index === 0);
    ['nextBtn', 'nextOverlay'].forEach(id => document.getElementById(id).disabled = index === total - 1 && !autoplayTimer);

    updateThumbnails();
    renderNotes();
    updatePresenter();
    updateVersionButton();
}

function prevSlide() { if (currentSlideIdx > 0) renderSlide(currentSlideIdx - 1); }
function nextSlide() {
    if (currentSlideIdx < currentPresentationData.slides.length - 1) renderSlide(currentSlideIdx + 1);
}

function buildThumbnails() {
    const container = document.getElementById('thumbnailContainer');
    container.innerHTML = '';
    currentPresentationData.slides.forEach((slide, idx) => {
        const thumb = document.createElement('div');
        thumb.className = THUMB_BASE;
        thumb.dataset.idx = idx;
        thumb.title = slide.slide_title;
        thumb.setAttribute('role', 'button');
        thumb.tabIndex = 0;
        thumb.setAttribute('aria-label', `第 ${idx + 1} 頁：${slide.slide_title}`);
        thumb.onclick = () => renderSlide(idx);
        thumb.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderSlide(idx); } };
        thumb.innerHTML = `
  <span class="absolute left-1.5 top-1.5 z-10 text-[10px] font-mono px-1.5 py-px rounded bg-black/65 text-white">${pad(idx + 1)}</span>
  <div class="rv-thumb !border-0 !rounded-none !cursor-pointer"><div class="slide-scaler">${slide.html_content}</div></div>
`;
        container.appendChild(thumb);
    });
    fitPlayerThumbs();
    animateIn(container, 'reveal');
}
const THUMB_BASE = 'thumb relative flex-shrink-0 w-44 rounded-lg border overflow-hidden cursor-pointer transition-all duration-300 select-none ';
function fitPlayerThumbs() {
    document.querySelectorAll('#thumbnailContainer .rv-thumb').forEach(box => thumbFitRO.observe(box));
}

function updateThumbnails() {
    const container = document.getElementById('thumbnailContainer');
    container.querySelectorAll('.thumb').forEach(thumb => {
        const idx = Number(thumb.dataset.idx);
        const isCurrent = idx === currentSlideIdx;
        thumb.className = THUMB_BASE + (isCurrent
            ? 'border-black dark:border-white ring-2 ring-black dark:ring-white shadow-md scale-105'
            : 'border-zinc-200 dark:border-zinc-800 opacity-60 hover:opacity-100');
        if (isCurrent) thumb.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
}

/* ----- 自動播放 ----- */
function toggleAutoplay() { autoplayTimer ? stopAutoplay() : startAutoplay(); }
function startAutoplay() {
    toggleEditMode(false);
    if (!currentPresentationData) return;
    autoplayTimer = setInterval(() => {
        const last = currentPresentationData.slides.length - 1;
        renderSlide(currentSlideIdx >= last ? 0 : currentSlideIdx + 1);
    }, 4500);
    document.getElementById('autoIcon').className = 'fa-solid fa-pause text-[10px] text-green-500';
    document.getElementById('autoLabel').textContent = '播放中';
    document.getElementById('nextBtn').disabled = false;
    document.getElementById('nextOverlay').disabled = false;
    showToast('自動播放已開啟', 'info', 1500);
}
function stopAutoplay() {
    if (!autoplayTimer) return;
    clearInterval(autoplayTimer);
    autoplayTimer = null;
    document.getElementById('autoIcon').className = 'fa-solid fa-play text-[10px]';
    document.getElementById('autoLabel').textContent = '自動播放';
    // 播放中「下一頁」一律可按（最後一頁會繞回第一頁）；停止後恢復為一般的停用規則
    const atEnd = !!currentPresentationData && currentSlideIdx >= currentPresentationData.slides.length - 1;
    ['nextBtn', 'nextOverlay'].forEach(id => document.getElementById(id).disabled = atEnd);
}

/* ----- 全螢幕 ----- */
function toggleFullscreen() {
    const stage = document.getElementById('slideStage');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => showToast('瀏覽器不支援全螢幕', 'error'));
    else showToast('瀏覽器不支援全螢幕', 'error');
}
let idleTimer;
function wakeStage() {
    const stage = document.getElementById('slideStage');
    stage.classList.remove('idle');
    clearTimeout(idleTimer);
    if (document.fullscreenElement) idleTimer = setTimeout(() => stage.classList.add('idle'), 2000);
}
document.getElementById('slideStage').addEventListener('mousemove', wakeStage);
document.addEventListener('fullscreenchange', () => {
    const fs = !!document.fullscreenElement;
    document.getElementById('fsIcon').className = 'fa-solid text-[11px] ' + (fs ? 'fa-compress' : 'fa-expand');
    document.getElementById('fsLabel').textContent = fs ? '離開全螢幕' : '全螢幕';
    if (fs) toggleEditMode(false);
    wakeStage();
    setTimeout(fitSlide, 50);
});

/* ===================== 插入選單（編輯模式） ===================== */
// 圖示、圖案、品牌的面板以「插入」按鈕為定位基準（選單項目在選單關閉後看不到）
function setInsertMenuOpen(open, focusFirst = false) {
    const list = document.getElementById('insertList');
    if (!list) return;
    list.classList.toggle('hidden', !open);
    document.getElementById('insertBtn').setAttribute('aria-expanded', String(open));
    if (open && focusFirst) list.querySelector('[role=menuitem]:not(.hidden)')?.focus();
}
(function initInsertMenu() {
    const wrap = document.getElementById('insertMenu');
    const btn = document.getElementById('insertBtn');
    const list = document.getElementById('insertList');
    const actions = {
        text: insertTextBox, image: pickSlideImage, chart: () => openChartEditor(null),
        icon: toggleIconPicker, shape: toggleShapePicker, brand: toggleBrandPicker,
        blank: () => addBlankSlide(currentSlideIdx, true)
    };
    btn.onclick = () => {
        const open = list.classList.contains('hidden');
        if (open) { closeIconPicker(); closeShapePicker(); closeBrandPicker(); }
        setInsertMenuOpen(open);
    };
    list.addEventListener('click', e => {
        const item = e.target.closest('[data-insert]');
        if (!item) return;
        setInsertMenuOpen(false);
        actions[item.dataset.insert]();
    });
    document.addEventListener('click', e => { if (!e.target.closest('#insertMenu')) setInsertMenuOpen(false); });
    wrap.addEventListener('keydown', e => {
        const open = !list.classList.contains('hidden');
        if (e.key === 'Escape' && open) { e.stopPropagation(); setInsertMenuOpen(false); btn.focus(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        e.stopPropagation(); // 避免觸發全域的換頁與微調位置快捷鍵
        if (!open) { setInsertMenuOpen(true, true); return; }
        const items = [...list.querySelectorAll('[role=menuitem]:not(.hidden)')];
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
})();

/* ===================== 匯出選單 ===================== */
(function initExportMenu() {
    const wrap = document.getElementById('exportMenu');
    const btn = document.getElementById('exportBtn');
    const list = document.getElementById('exportList');
    const items = [...list.querySelectorAll('[role=menuitem]')];
    const actions = { pdf: exportPresentationPdf, pptx: exportPresentationPptx, html: exportPresentationHtml };
    const setOpen = (open, focusFirst = false) => {
        list.classList.toggle('hidden', !open);
        btn.setAttribute('aria-expanded', String(open));
        if (open && focusFirst) items[0].focus();
    };
    btn.onclick = () => setOpen(list.classList.contains('hidden'));
    items.forEach(item => item.onclick = () => { setOpen(false); btn.focus(); actions[item.dataset.export](); });
    document.addEventListener('click', e => { if (!e.target.closest('#exportMenu')) setOpen(false); });
    wrap.addEventListener('keydown', e => {
        const open = !list.classList.contains('hidden');
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); btn.focus(); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        e.stopPropagation(); // 避免觸發全域的換頁快捷鍵
        if (!open) { setOpen(true, true); return; }
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    });
})();
