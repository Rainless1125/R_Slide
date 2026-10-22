/* 單頁版本記錄：重產前把舊版存進 slide.versions（最新在前），在版本視窗點擊預覽圖即可切換
 * 版本跟著簡報存入歷史記錄，重新整理或換電腦也能還原；送給 LLM 與複製頁面時會移除（見 withoutVersions）。
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
const MAX_SLIDE_VERSIONS = 3;
// version_id 讓比較視窗在切換版本時維持卡片順序（同一個版本切換前後是不同物件）
const VERSION_FIELDS = ['slide_title', 'layout_concept', 'html_content', 'charts', 'speaker_notes', 'version_note', 'version_id'];

let versionModalIdx = null;
let versionModalOrder = [];          // 開啟視窗時的版本順序（version_id），切換版本時卡片位置不變
let versionModalStart = null;        // 開啟時使用中的版本，關閉時用來判斷是否換過
let versionModalUndoPushed = false;  // 同一次開啟只記一個撤銷步驟，撤銷即回到開啟前
let versionModalOpener = null;       // 關閉後把焦點還給開啟視窗的按鈕

function slideVersions(slide) { return Array.isArray(slide?.versions) ? slide.versions : []; }

function withoutVersions(slide) {
    const { versions, version_note, version_id, ...rest } = slide;
    return rest;
}

function newVersionId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function slideSnapshot(slide) {
    const v = { savedAt: Date.now() };
    VERSION_FIELDS.forEach(k => { if (slide[k] !== undefined) v[k] = JSON.parse(JSON.stringify(slide[k])); });
    v.version_id ||= newVersionId();
    return v;
}

// 重產成功後組出新的頁面：舊版放進版本記錄，超過上限時捨棄最舊的
function slideWithNewVersion(oldSlide, newSlide, note) {
    return {
        ...oldSlide,
        ...newSlide,
        version_note: note,
        version_id: newVersionId(),
        versions: [slideSnapshot(oldSlide), ...slideVersions(oldSlide)].slice(0, MAX_SLIDE_VERSIONS)
    };
}

function versionNote(v) {
    return v?.version_note || '最初的版本';
}

// 舊紀錄沒有 version_id：開啟視窗時補上（隨下次存檔寫入歷史記錄）
function ensureVersionIds(slide) {
    slide.version_id ||= newVersionId();
    slideVersions(slide).forEach(v => { v.version_id ||= newVersionId(); });
}

/* ---------- 版本視窗：所有版本排成預覽卡片，點擊即切換 ---------- */
function openVersionModal(idx) {
    const slide = currentPresentationData?.slides?.[idx];
    if (!slideVersions(slide).length) return;
    if (!slideOpsAllowed()) return;
    if (editMode) toggleEditMode(false);           // 先寫回播放器中尚未存入的修改
    const current = currentPresentationData.slides[idx];
    ensureVersionIds(current);
    versionModalIdx = idx;
    versionModalOrder = [current.version_id, ...slideVersions(current).map(v => v.version_id)];
    versionModalStart = current.version_id;
    versionModalUndoPushed = false;
    versionModalOpener = document.activeElement;
    document.getElementById('versionModal').classList.remove('hidden');
    renderVersionModal();
    setTimeout(() => document.querySelector('#versionGrid .version-card[aria-pressed="true"]')?.focus(), 0);
}

function closeVersionModal() {
    const idx = versionModalIdx;
    const slide = currentPresentationData?.slides?.[idx];
    const changed = slide && versionModalStart && slide.version_id !== versionModalStart;
    versionModalIdx = null;
    document.getElementById('versionModal').classList.add('hidden');
    document.getElementById('versionGrid').innerHTML = '';
    if (versionModalOpener?.isConnected) versionModalOpener.focus({ preventScroll: true });
    versionModalOpener = null;
    if (changed) showToast(`第 ${idx + 1} 頁已改用「${versionNote(slide)}」的版本`, 'success', 5000, { label: '撤銷', onClick: () => undo() });
}
function isVersionModalOpen() { return !document.getElementById('versionModal').classList.contains('hidden'); }

// 縮圖依框的寬度等比縮放 1024px 的投影片；插入後立即計算，框寬之後改變時由 thumbFitRO 重算
function fitVersionThumbs() {
    document.querySelectorAll('#versionGrid .version-thumb').forEach(box => {
        const scaler = box.querySelector('.slide-scaler');
        if (scaler && box.clientWidth) scaler.style.transform = `scale(${box.clientWidth / 1024})`;
        thumbFitRO.observe(box);
    });
}

function renderVersionModal() {
    const slide = currentPresentationData?.slides?.[versionModalIdx];
    if (!slide || !slideVersions(slide).length) { closeVersionModal(); return; }
    const byId = new Map([slide, ...slideVersions(slide)].map(v => [v.version_id, v]));
    const items = versionModalOrder.map(id => byId.get(id)).filter(Boolean);
    document.getElementById('versionModalTitle').textContent = `第 ${versionModalIdx + 1} 頁的版本`;
    document.getElementById('versionGrid').innerHTML = items.map(v => {
        const active = v.version_id === slide.version_id;
        const time = v.savedAt && !active ? ` · 保存於 ${fmtTime(v.savedAt)}` : '';
        return `
  <div role="button" tabindex="0" class="version-card" data-vid="${esc(v.version_id)}" aria-pressed="${active}"
    aria-label="${active ? '使用中' : '改用此版本'}：${esc(v.slide_title)}，${esc(versionNote(v))}">
    <span class="version-thumb"><span class="slide-scaler">${v.html_content || ''}</span></span>
    <span class="version-meta">
      <span class="version-state">${active ? '<i class="fa-solid fa-circle-check"></i>使用中' : '<i class="fa-solid fa-arrow-pointer"></i>點擊改用'}</span>
      <b>${esc(v.slide_title)}</b>
      <span>${esc(versionNote(v))}${esc(time)}</span>
    </span>
  </div>`;
    }).join('');
    fitVersionThumbs();
}

(function initVersionModal() {
    document.getElementById('versionGrid').addEventListener('click', e => {
        const card = e.target.closest('.version-card');
        if (card) switchToVersion(card.dataset.vid);
    });
    document.getElementById('versionGrid').addEventListener('keydown', e => {
        const card = e.target.closest('.version-card');
        if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        switchToVersion(card.dataset.vid);
    });
    document.getElementById('versionModal').addEventListener('click', e => { if (e.target.id === 'versionModal') closeVersionModal(); });
})();

// 方向鍵在卡片間移動焦點（由 main.js 的全域快捷鍵呼叫，焦點不在視窗內也有效）
function stepVersionModal(dir) {
    const cards = [...document.querySelectorAll('#versionGrid .version-card')];
    if (!cards.length) return;
    const at = cards.indexOf(document.activeElement);
    const from = at >= 0 ? at : cards.findIndex(c => c.getAttribute('aria-pressed') === 'true');
    cards[(from + dir + cards.length) % cards.length].focus();
}

// 改用指定版本：目前的版本放回版本記錄（不會遺失，可以再點回來）；視窗保持開啟方便來回比較
function switchToVersion(vid) {
    const idx = versionModalIdx;
    const slides = currentPresentationData?.slides;
    const current = slides?.[idx];
    if (!current || current.version_id === vid) return;
    const chosen = slideVersions(current).find(v => v.version_id === vid);
    if (!chosen || !slideOpsAllowed()) return;
    if (!versionModalUndoPushed) { pushUndoSnapshot(); versionModalUndoPushed = true; }
    const restored = { ...current };
    VERSION_FIELDS.forEach(k => { delete restored[k]; });
    VERSION_FIELDS.forEach(k => { if (chosen[k] !== undefined) restored[k] = JSON.parse(JSON.stringify(chosen[k])); });
    restored.versions = [slideSnapshot(current), ...slideVersions(current).filter(x => x !== chosen)].slice(0, MAX_SLIDE_VERSIONS);
    slides[idx] = restored;
    applySlides(slides);
    renderVersionModal();
    document.querySelector(`#versionGrid [data-vid="${CSS.escape(vid)}"]`)?.focus();
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
