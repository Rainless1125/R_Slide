/* ===================== 講者備註與講者檢視 ===================== */
// 講者備註存在每頁的 speaker_notes（純文字），不會畫在投影片上；
// 播放器下方的備註區可直接修改，講者檢視另開視窗顯示目前頁、下一頁、備註與計時器。
// 講者檢視是同源的空白視窗，由主視窗直接操作其 DOM，因此不需要額外的通訊機制。
// 依賴 index.html 的全域：currentPresentationData、currentSlideIdx、renderSlide、prevSlide、nextSlide、
// pushUndoSnapshot、syncCurrentPresentationToHistory、showToast、pad。

const NOTES_PANEL_KEY = 'rslide_notes';
const PRESENTER_FONT_KEY = 'rslide_presenter_fs';
let notesSlide = null;      // 備註區目前對應的投影片物件（換頁後仍能把修改寫回正確的頁）
let presenterWin = null;

function slideNotes(slide) {
    return typeof slide?.speaker_notes === 'string' ? slide.speaker_notes : '';
}

/* ----- 播放器下方的備註區 ----- */
function setNotesPanel(open) {
    document.getElementById('notesPanel').classList.toggle('hidden', !open);
    const btn = document.getElementById('notesBtn');
    btn.setAttribute('aria-pressed', String(open));
    btn.classList.toggle('bg-zinc-100', open);
    btn.classList.toggle('dark:bg-zinc-800', open);
    try { localStorage.setItem(NOTES_PANEL_KEY, open ? '1' : '0'); } catch (e) { }
}
function toggleNotesPanel() {
    setNotesPanel(document.getElementById('notesPanel').classList.contains('hidden'));
}

function renderNotes() {
    const input = document.getElementById('notesInput');
    if (!input || !currentPresentationData) return;
    commitNotes(); // 換頁前先把尚未寫回的修改存起來
    notesSlide = currentPresentationData.slides[currentSlideIdx] || null;
    input.value = slideNotes(notesSlide);
    document.getElementById('notesPage').textContent = notesSlide ? `第 ${currentSlideIdx + 1} 頁` : '';
}

function commitNotes() {
    const input = document.getElementById('notesInput');
    const slide = notesSlide;
    if (!input || !slide || !currentPresentationData?.slides.includes(slide)) return;
    const value = input.value.replace(/\r\n?/g, '\n').trim();
    if (value === slideNotes(slide).trim()) return;
    pushUndoSnapshot();
    slide.speaker_notes = value;
    syncCurrentPresentationToHistory();
}

(function initNotesPanel() {
    const input = document.getElementById('notesInput');
    input.addEventListener('change', commitNotes);
    input.addEventListener('input', () => updatePresenter(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); input.blur(); } });
    let saved = null;
    try { saved = localStorage.getItem(NOTES_PANEL_KEY); } catch (e) { }
    setNotesPanel(saved === '1');
})();

/* ----- 講者檢視視窗 ----- */
const PRESENTER_HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>講者檢視 - R Slide</title>
<link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" crossorigin="anonymous">
<script src="https://cdn.tailwindcss.com/3.4.17"><\/script>
<script>
if (window.tailwind) tailwind.config = { theme: { extend: { fontFamily: { sans: ['"PingFang TC"', '"Microsoft JhengHei"', '"Noto Sans TC"', 'sans-serif'] } } } };
<\/script>
<style>
html,body{margin:0;height:100%}
#rsPresenter{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:12px;padding:14px 16px;background:#09090b;color:#f4f4f5;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif}
#rsPresenter *{box-sizing:border-box}
.p-top{flex:none;display:flex;align-items:center;gap:16px;font-size:13px;color:#a1a1aa}
.p-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:700;color:#f4f4f5;font-size:15px}
.p-mono{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;color:#f4f4f5;font-variant-numeric:tabular-nums}
.p-timer{font-size:22px}
.p-btn{border:1px solid #3f3f46;background:#18181b;color:#e4e4e7;font-weight:600;font-size:12px;font-family:inherit;height:30px;min-width:30px;padding:0 10px;border-radius:999px;cursor:pointer}
.p-btn:hover:not(:disabled){background:#27272a}
.p-btn:disabled{opacity:.35;cursor:not-allowed}
.p-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}
.p-col{min-width:0;min-height:0;display:flex;flex-direction:column;gap:8px}
.p-label{flex:none;font-size:11px;font-weight:700;letter-spacing:.08em;color:#71717a}
.p-frame{position:relative;flex:none;width:100%;aspect-ratio:16/9;overflow:hidden;background:#fff;color:#18181b;border-radius:8px}
.p-frame.end{display:flex;align-items:center;justify-content:center;background:#18181b;color:#71717a;font-size:14px}
.slide-scaler{position:relative;width:1024px;height:576px;transform-origin:top left}
.p-nav{flex:none;display:flex;align-items:center;justify-content:center;gap:8px}
.p-notes{flex:1;min-height:0;overflow:auto;white-space:pre-wrap;line-height:1.7;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:14px 16px}
.p-notes.empty{color:#71717a;font-style:italic}
@media (max-width:760px){.p-main{grid-template-columns:minmax(0,1fr);overflow:auto}}
</style>
</head>
<body>
<div id="rsPresenter">
  <div class="p-top">
    <div class="p-title" id="pTitle"></div>
    <span class="p-mono" id="pCounter"></span>
    <span class="p-mono p-timer" id="pTimer" title="已進行時間">00:00</span>
    <button class="p-btn" id="pTimerToggle" aria-label="暫停計時"><i class="fa-solid fa-pause"></i></button>
    <button class="p-btn" id="pTimerReset" aria-label="重設計時" title="重設計時"><i class="fa-solid fa-rotate-left"></i></button>
    <span class="p-mono" id="pClock" title="目前時間"></span>
  </div>
  <div class="p-main">
    <div class="p-col">
      <div class="p-label">目前頁面</div>
      <div class="p-frame" id="pCurrent"></div>
      <div class="p-nav">
        <button class="p-btn" id="pPrev" aria-label="上一頁"><i class="fa-solid fa-chevron-left"></i> 上一頁</button>
        <button class="p-btn" id="pNext" aria-label="下一頁">下一頁 <i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="p-col">
      <div class="p-label">下一頁</div>
      <div class="p-frame" id="pNextSlide"></div>
      <div class="p-label" style="display:flex;align-items:center;gap:6px">講者備註
        <span style="flex:1"></span>
        <button class="p-btn" id="pFontDown" aria-label="縮小備註字級" title="縮小字級">A-</button>
        <button class="p-btn" id="pFontUp" aria-label="放大備註字級" title="放大字級">A+</button>
      </div>
      <div class="p-notes" id="pNotes"></div>
    </div>
  </div>
</div>
</body>
</html>`;

function openPresenterView() {
    if (!currentPresentationData) return;
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); updatePresenter(); return; }
    const win = window.open('', 'rslide_presenter', 'width=1200,height=760');
    if (!win) { showToast('瀏覽器封鎖了彈出視窗，請允許此網站開啟彈出視窗後再試一次', 'error', 6000); return; }
    presenterWin = win;
    // 同名視窗若仍開著（例如重新整理主頁面後），沿用它但重新初始化
    win.document.open();
    win.document.write(PRESENTER_HTML);
    win.document.close();
    // Tailwind 是同步載入的 script，寫入後文件可能仍在解析，需等 DOM 完成再初始化
    const ready = () => { initPresenter(win); updatePresenter(); };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
    win.focus();
}

function initPresenter(win) {
    const doc = win.document;
    const $ = id => doc.getElementById(id);

    // 計時器：從開啟講者檢視開始計算，可暫停 / 重設
    let elapsed = 0, startedAt = Date.now(), running = true;
    const fmt = ms => {
        const s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
        return (h ? h + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
    };
    const tick = () => {
        $('pTimer').textContent = fmt(elapsed + (running ? Date.now() - startedAt : 0));
        $('pClock').textContent = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    };
    $('pTimerToggle').onclick = () => {
        if (running) elapsed += Date.now() - startedAt; else startedAt = Date.now();
        running = !running;
        $('pTimerToggle').innerHTML = `<i class="fa-solid ${running ? 'fa-pause' : 'fa-play'}"></i>`;
        $('pTimerToggle').setAttribute('aria-label', running ? '暫停計時' : '繼續計時');
        tick();
    };
    $('pTimerReset').onclick = () => { elapsed = 0; startedAt = Date.now(); tick(); };
    win.setInterval(tick, 500);
    tick();

    // 備註字級
    let fontSize = 20;
    try { fontSize = Number(localStorage.getItem(PRESENTER_FONT_KEY)) || 20; } catch (e) { }
    const setFont = size => {
        fontSize = Math.max(12, Math.min(48, size));
        $('pNotes').style.fontSize = fontSize + 'px';
        try { localStorage.setItem(PRESENTER_FONT_KEY, String(fontSize)); } catch (e) { }
    };
    $('pFontDown').onclick = () => setFont(fontSize - 2);
    $('pFontUp').onclick = () => setFont(fontSize + 2);
    setFont(fontSize);

    // 主視窗按「新增簡報」或刪除目前紀錄後，講者檢視可能仍開著，此時沒有可切換的投影片
    $('pPrev').onclick = () => { if (currentPresentationData) prevSlide(); };
    $('pNext').onclick = () => { if (currentPresentationData) nextSlide(); };
    doc.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || !currentPresentationData) return;
        const last = currentPresentationData.slides.length - 1;
        if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); prevSlide(); }
        else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); nextSlide(); }
        else if (e.key === 'Home') renderSlide(0);
        else if (e.key === 'End') renderSlide(last);
    });

    const fit = () => doc.querySelectorAll('.p-frame').forEach(f => {
        const s = f.querySelector('.slide-scaler');
        if (s && f.clientWidth) s.style.transform = `scale(${f.clientWidth / 1024})`;
    });
    win.addEventListener('resize', fit);
    win.__rsFit = fit;
    win.__rsReady = true;
}

// 主視窗換頁或修改投影片後呼叫；liveNotes 為備註區輸入中、尚未寫回的文字
function updatePresenter(liveNotes) {
    const win = presenterWin;
    if (!win || win.closed || !currentPresentationData) return;
    if (!win.__rsReady) return;
    const doc = win.document;
    const $ = id => doc.getElementById(id);
    const slides = currentPresentationData.slides;
    const idx = Math.min(currentSlideIdx, slides.length - 1);
    const cur = slides[idx], next = slides[idx + 1];

    if (liveNotes === undefined) {
        $('pTitle').textContent = currentPresentationData.presentation_title || '未命名簡報';
        $('pCounter').textContent = `${pad(idx + 1)} / ${pad(slides.length)}`;
        $('pCurrent').innerHTML = `<div class="slide-scaler">${cur.html_content}</div>`;
        const nextEl = $('pNextSlide');
        nextEl.classList.toggle('end', !next);
        if (next) nextEl.innerHTML = `<div class="slide-scaler">${next.html_content}</div>`;
        else nextEl.textContent = '簡報結束';
        $('pPrev').disabled = idx === 0;
        $('pNext').disabled = idx === slides.length - 1;
        win.__rsFit?.();
    }
    const notes = (liveNotes ?? slideNotes(cur)).trim();
    $('pNotes').classList.toggle('empty', !notes);
    $('pNotes').textContent = notes || '此頁沒有講者備註';
}

window.addEventListener('pagehide', () => { if (presenterWin && !presenterWin.closed) presenterWin.close(); });
