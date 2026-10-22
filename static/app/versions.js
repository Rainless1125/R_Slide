/* 單頁版本記錄：重產前把舊版存進 slide.versions（最新在前），可並排比較並改用舊版
 * 版本跟著簡報存入歷史記錄，重新整理或換電腦也能還原；送給 LLM 與複製頁面時會移除（見 withoutVersions）。
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
const MAX_SLIDE_VERSIONS = 3;
const VERSION_FIELDS = ['slide_title', 'layout_concept', 'html_content', 'charts', 'speaker_notes', 'version_note'];

let versionModalIdx = null;
let versionModalSel = 0;
let versionModalOpener = null;       // 關閉後把焦點還給開啟視窗的按鈕

function slideVersions(slide) { return Array.isArray(slide?.versions) ? slide.versions : []; }

function withoutVersions(slide) {
    const { versions, version_note, ...rest } = slide;
    return rest;
}

function slideSnapshot(slide) {
    const v = { savedAt: Date.now() };
    VERSION_FIELDS.forEach(k => { if (slide[k] !== undefined) v[k] = JSON.parse(JSON.stringify(slide[k])); });
    return v;
}

// 重產成功後組出新的頁面：舊版放進版本記錄，超過上限時捨棄最舊的
function slideWithNewVersion(oldSlide, newSlide, note) {
    return {
        ...oldSlide,
        ...newSlide,
        version_note: note,
        versions: [slideSnapshot(oldSlide), ...slideVersions(oldSlide)].slice(0, MAX_SLIDE_VERSIONS)
    };
}

function versionLabel(v, i) {
    return i === 0 ? '上一版' : `前 ${i + 1} 版`;
}
function versionNote(v) {
    return v?.version_note || '最初的版本';
}

/* ---------- 比較視窗 ---------- */
function openVersionModal(idx) {
    const slide = currentPresentationData?.slides?.[idx];
    if (!slideVersions(slide).length) return;
    if (!slideOpsAllowed()) return;
    versionModalIdx = idx;
    versionModalSel = 0;
    versionModalOpener = document.activeElement;
    document.getElementById('versionModal').classList.remove('hidden');
    renderVersionModal();
    setTimeout(() => document.getElementById('versionUseBtn').focus(), 0);
}

function closeVersionModal() {
    versionModalIdx = null;
    document.getElementById('versionModal').classList.add('hidden');
    document.getElementById('versionCurrent').innerHTML = '';
    document.getElementById('versionOld').innerHTML = '';
    if (versionModalOpener?.isConnected) versionModalOpener.focus({ preventScroll: true });
    versionModalOpener = null;
}
function isVersionModalOpen() { return !document.getElementById('versionModal').classList.contains('hidden'); }

function versionThumb(slide) {
    return `<div class="slide-scaler">${slide.html_content || ''}</div>`;
}

function renderVersionModal() {
    const slide = currentPresentationData?.slides?.[versionModalIdx];
    const versions = slideVersions(slide);
    if (!versions.length) { closeVersionModal(); return; }
    versionModalSel = Math.min(versionModalSel, versions.length - 1);
    const v = versions[versionModalSel];
    document.getElementById('versionModalTitle').textContent = `第 ${versionModalIdx + 1} 頁的版本`;
    document.getElementById('versionCurrent').innerHTML = versionThumb(slide);
    document.getElementById('versionOld').innerHTML = versionThumb(v);
    document.getElementById('versionCurrentMeta').innerHTML =
        `<b>${esc(slide.slide_title)}</b><span>${esc(versionNote(slide))}</span>`;
    document.getElementById('versionOldMeta').innerHTML =
        `<b>${esc(v.slide_title)}</b><span>${esc(versionNote(v))} · 保存於 ${esc(fmtTime(v.savedAt))}</span>`;
    document.getElementById('versionTabs').innerHTML = versions.map((x, i) => `
      <button type="button" role="tab" aria-selected="${i === versionModalSel}" data-ver="${i}" class="version-tab">${versionLabel(x, i)}</button>`).join('');
    document.querySelectorAll('#versionModal .version-thumb').forEach(box => thumbFitRO.observe(box));
}

(function initVersionModal() {
    document.getElementById('versionTabs').addEventListener('click', e => {
        const b = e.target.closest('[data-ver]');
        if (!b) return;
        versionModalSel = +b.dataset.ver;
        renderVersionModal();
    });
    document.getElementById('versionModal').addEventListener('click', e => { if (e.target.id === 'versionModal') closeVersionModal(); });
})();

// 左右鍵切換舊版（由 main.js 的全域快捷鍵呼叫，焦點不在視窗內也有效）
function stepVersionModal(dir) {
    const n = slideVersions(currentPresentationData?.slides?.[versionModalIdx]).length;
    if (n < 2) return;
    versionModalSel = (versionModalSel + dir + n) % n;
    renderVersionModal();
    document.querySelector(`#versionTabs [data-ver="${versionModalSel}"]`)?.focus();
}

// 改用選取的舊版：目前的版本放回版本記錄（不會遺失，可以再切換回來），可撤銷
function useSelectedVersion() {
    const idx = versionModalIdx;
    const slides = currentPresentationData?.slides;
    const slide = slides?.[idx];
    const versions = slideVersions(slide);
    const chosen = versions[versionModalSel];
    if (!chosen || !slideOpsAllowed()) return;
    if (editMode) toggleEditMode(false);           // 先寫回播放器中尚未存入的修改
    const current = slides[idx];                  // 寫回後可能換成新物件
    pushUndoSnapshot();
    const restored = { ...current };
    VERSION_FIELDS.forEach(k => { delete restored[k]; });
    VERSION_FIELDS.forEach(k => { if (chosen[k] !== undefined) restored[k] = JSON.parse(JSON.stringify(chosen[k])); });
    restored.versions = [slideSnapshot(current), ...slideVersions(current).filter(x => x !== chosen)].slice(0, MAX_SLIDE_VERSIONS);
    slides[idx] = restored;
    closeVersionModal();
    applySlides(slides);
    showToast(`第 ${idx + 1} 頁已改用${versionLabel(chosen, versionModalSel)}，原本的版本仍保留在版本記錄`, 'success', 5000,
        { label: '撤銷', onClick: () => undo() });
}

/* ---------- 播放器的「版本」按鈕：目前頁面有舊版時才顯示 ---------- */
function updateVersionButton() {
    const btn = document.getElementById('versionCurrentBtn');
    if (!btn) return;
    const n = slideVersions(currentPresentationData?.slides?.[currentSlideIdx]).length;
    btn.classList.toggle('hidden', !n);
    btn.classList.toggle('flex', !!n);
    btn.title = n ? `比較或還原此頁的舊版本（${n} 個）` : '';
}
