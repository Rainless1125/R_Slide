/* 先確認大綱：產生每頁標題與重點，讓使用者修改、調整頁序、增刪頁面後再生成完整版面
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 generate.js 之後）。 */
const OUTLINE_FIRST_KEY = 'rslide_outline_first';
const OUTLINE_MAX_PAGES = 20;          // 與 app.py 的 MAX_PAGES 一致
const OUTLINE_MAX_POINTS = 8;          // 與 app.py 的 MAX_OUTLINE_POINTS 一致
const OUTLINE_MAX_POINT_CHARS = 300;   // 與 app.py 的 MAX_OUTLINE_POINT_CHARS 一致

// { presentation_title, slides: [{ slide_title, key_points: [], layout_concept }], input }
// input 為產生大綱時的輸入設定；依大綱生成時改用輸入區當下的設定（可在確認大綱期間換風格）
let currentOutline = null;

/* ---------- 開關：先確認大綱 / 直接生成 ---------- */
function isOutlineFirst() { return document.getElementById('outlineFirst').checked; }

function updateGenerateLabel() {
    if (isGenerating()) return;
    const on = isOutlineFirst();
    document.getElementById('btnLabel').textContent = on ? '生成大綱' : '生成排版';
    document.getElementById('btnIcon').className = on ? 'fa-solid fa-list-check' : 'fa-solid fa-wand-magic-sparkles';
}

(function initOutlineToggle() {
    const box = document.getElementById('outlineFirst');
    try { box.checked = localStorage.getItem(OUTLINE_FIRST_KEY) === '1'; } catch (e) { }
    box.addEventListener('change', () => {
        try { localStorage.setItem(OUTLINE_FIRST_KEY, box.checked ? '1' : '0'); } catch (e) { }
        updateGenerateLabel();
    });
    updateGenerateLabel();
})();

/* ---------- 產生大綱 ---------- */
async function requestOutline(input) {
    if (isGenerating()) return;
    setLoading(true, 'outline');
    try {
        const res = await fetch('/api/outline', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, ...getLlmChoice() })
        });
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();
        currentOutline = {
            presentation_title: data.presentation_title || '',
            slides: (data.slides || []).map(s => ({
                slide_title: s.slide_title || '',
                key_points: s.key_points || [],
                layout_concept: s.layout_concept || ''
            })),
            input
        };
        if (!currentOutline.slides.length) currentOutline.slides.push(blankOutlineSlide());
        setLoading(false);
        renderOutline();
        showOutlineSection();
        showToast('大綱完成，確認或修改後即可生成簡報', 'success', 2600);
    } catch (err) {
        setLoading(false);
        if (currentOutline) showOutlineSection();
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, retryAction(err, () => requestOutline(input)));
    }
    refreshQuota();
}

function regenerateOutline() {
    if (isGenerating()) return;
    const input = readGenerationInput();
    if (input) requestOutline(input);
}

/* ---------- 顯示 / 隱藏 ---------- */
function showOutlineSection() {
    if (!currentOutline) return;
    const sec = document.getElementById('sectionOutline');
    document.getElementById('sectionReview').classList.add('hidden');
    document.getElementById('sectionPlayer').classList.add('hidden');
    sec.classList.remove('hidden');
    sec.querySelectorAll('.outline-points').forEach(autosizeOutline);   // 隱藏時量不到高度，顯示後再算一次
    animateIn(sec);
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function clearOutline() {
    currentOutline = null;
    document.getElementById('sectionOutline').classList.add('hidden');
    document.getElementById('outlineList').innerHTML = '';
}

// 放棄大綱：回到輸入區；若之前有開啟的簡報則重新顯示它的審查頁
function discardOutline() {
    clearOutline();
    if (currentPresentationData) renderReviewSection(true);
    document.getElementById('sectionInput').scrollIntoView({ behavior: 'smooth' });
}

function setOutlineBusy(on) {
    document.querySelectorAll('#sectionOutline [data-outline-busy]').forEach(b => { b.disabled = on; });
}

/* ---------- 渲染 ---------- */
function blankOutlineSlide() { return { slide_title: '', key_points: [], layout_concept: '' }; }

function renderOutline(focusIdx = null) {
    const o = currentOutline;
    if (!o) return;
    const last = o.slides.length - 1;
    document.getElementById('outlineTitle').value = o.presentation_title;
    document.getElementById('outlineCount').textContent = `共 ${o.slides.length} 頁`;
    document.getElementById('outlineAddBtn').disabled = o.slides.length >= OUTLINE_MAX_PAGES;
    document.getElementById('outlineList').innerHTML = o.slides.map((s, i) => `
  <li class="outline-item" data-idx="${i}">
    <span class="outline-num" aria-hidden="true">${pad(i + 1)}</span>
    <div class="min-w-0 flex-1 space-y-2">
      <input data-field="slide_title" value="${esc(s.slide_title)}" maxlength="500" placeholder="此頁標題"
        aria-label="第 ${i + 1} 頁標題" class="outline-title">
      <textarea data-field="key_points" rows="${Math.max(2, s.key_points.length)}" placeholder="重點，一行一點（最多 ${OUTLINE_MAX_POINTS} 點）"
        aria-label="第 ${i + 1} 頁重點，一行一點" class="outline-points">${esc(s.key_points.join('\n'))}</textarea>
      <label class="outline-layout"><i class="fa-solid fa-table-cells-large" aria-hidden="true"></i><span class="shrink-0">建議版型</span>
        <input data-field="layout_concept" value="${esc(s.layout_concept)}" maxlength="500" placeholder="由 AI 決定"
          aria-label="第 ${i + 1} 頁建議版型"></label>
    </div>
    <div class="outline-actions">
      <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} title="上移" aria-label="第 ${i + 1} 頁上移"><i class="fa-solid fa-arrow-up"></i></button>
      <button type="button" data-act="down" ${i === last ? 'disabled' : ''} title="下移" aria-label="第 ${i + 1} 頁下移"><i class="fa-solid fa-arrow-down"></i></button>
      <button type="button" data-act="insert" ${o.slides.length >= OUTLINE_MAX_PAGES ? 'disabled' : ''} title="在此頁後新增一頁" aria-label="在第 ${i + 1} 頁後新增一頁"><i class="fa-solid fa-plus"></i></button>
      <button type="button" data-act="delete" ${o.slides.length <= 1 ? 'disabled' : ''} title="刪除此頁" aria-label="刪除第 ${i + 1} 頁" class="danger"><i class="fa-regular fa-trash-can"></i></button>
    </div>
  </li>`).join('');
    document.querySelectorAll('#outlineList .outline-points').forEach(autosizeOutline);
    if (focusIdx != null) document.querySelector(`#outlineList [data-idx="${focusIdx}"] .outline-title`)?.focus();
}

function autosizeOutline(ta) {
    if (!ta.offsetParent) return;           // 區塊隱藏時 scrollHeight 為 0，會把欄位壓扁
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
}

function parsePoints(text) {
    return text.split('\n').map(p => p.replace(/^\s*(?:[-*•‧·]|\d+[.、)])\s*/, '').trim()).filter(Boolean);
}

/* ---------- 編輯 ---------- */
(function initOutlineEditor() {
    const list = document.getElementById('outlineList');
    list.addEventListener('input', e => {
        const field = e.target.dataset.field;
        const idx = +e.target.closest('[data-idx]')?.dataset.idx;
        if (!field || !currentOutline?.slides[idx]) return;
        const slide = currentOutline.slides[idx];
        if (field === 'key_points') {
            slide.key_points = parsePoints(e.target.value);
            autosizeOutline(e.target);
        } else {
            slide[field] = e.target.value;
        }
        e.target.classList.remove('invalid');
    });
    list.addEventListener('click', e => {
        const btn = e.target.closest('button[data-act]');
        if (!btn || btn.disabled || !currentOutline) return;
        const idx = +btn.closest('[data-idx]').dataset.idx;
        const slides = currentOutline.slides;
        const act = btn.dataset.act;
        if (act === 'up' || act === 'down') {
            const to = act === 'up' ? idx - 1 : idx + 1;
            [slides[idx], slides[to]] = [slides[to], slides[idx]];
            renderOutline();
            document.querySelector(`#outlineList [data-idx="${to}"] [data-act="${act}"]:not(:disabled)`)?.focus();
        } else if (act === 'insert') {
            slides.splice(idx + 1, 0, blankOutlineSlide());
            renderOutline(idx + 1);
        } else if (act === 'delete') {
            const removed = slides.splice(idx, 1)[0];
            renderOutline();
            showToast(`已刪除第 ${idx + 1} 頁`, 'info', 4000, {
                label: '復原', onClick: () => {
                    if (!currentOutline || currentOutline.slides !== slides) return;
                    slides.splice(idx, 0, removed);
                    renderOutline(idx);
                }
            });
        }
    });
    list.addEventListener('keydown', e => {
        // 標題按 Enter 跳到重點欄；任何欄位按 Ctrl / ⌘ + Enter 直接依大綱生成
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); generateFromOutline(); return; }
        if (e.key === 'Enter' && e.target.dataset.field === 'slide_title' && !e.isComposing) {
            e.preventDefault();
            e.target.closest('[data-idx]').querySelector('.outline-points').focus();
        }
    });
    document.getElementById('outlineTitle').addEventListener('input', e => {
        if (currentOutline) currentOutline.presentation_title = e.target.value;
    });
})();

function addOutlineSlide() {
    if (!currentOutline || currentOutline.slides.length >= OUTLINE_MAX_PAGES) return;
    currentOutline.slides.push(blankOutlineSlide());
    renderOutline(currentOutline.slides.length - 1);
}

/* ---------- 依大綱生成 ---------- */
function generateFromOutline() {
    if (!currentOutline || isGenerating()) return;
    const slides = currentOutline.slides;
    const missing = slides.findIndex(s => !s.slide_title.trim());
    if (missing >= 0) {
        const el = document.querySelector(`#outlineList [data-idx="${missing}"] .outline-title`);
        el?.classList.add('invalid');
        el?.focus();
        showToast(`第 ${missing + 1} 頁還沒有標題`, 'error');
        return;
    }
    const tooMany = slides.findIndex(s => s.key_points.length > OUTLINE_MAX_POINTS);
    if (tooMany >= 0) {
        document.querySelector(`#outlineList [data-idx="${tooMany}"] .outline-points`)?.focus();
        showToast(`第 ${tooMany + 1} 頁的重點超過 ${OUTLINE_MAX_POINTS} 點，請精簡或拆成兩頁`, 'error', 5000);
        return;
    }
    const tooLong = slides.findIndex(s => s.key_points.some(p => p.length > OUTLINE_MAX_POINT_CHARS));
    if (tooLong >= 0) {
        document.querySelector(`#outlineList [data-idx="${tooLong}"] .outline-points`)?.focus();
        showToast(`第 ${tooLong + 1} 頁有重點超過 ${OUTLINE_MAX_POINT_CHARS} 字，請精簡`, 'error', 5000);
        return;
    }
    if (importing) { showToast('檔案匯入中，請稍候', 'info'); return; }
    // 輸入區的素材被清空時，沿用產生大綱時的素材
    const input = readGenerationInputQuiet() || currentOutline.input;
    const outline = {
        presentation_title: currentOutline.presentation_title.trim() || slides[0].slide_title.trim(),
        slides: slides.map(s => ({ slide_title: s.slide_title.trim(), key_points: s.key_points, layout_concept: s.layout_concept.trim() }))
    };
    generateDeck(input, outline);
}

function readGenerationInputQuiet() {
    if (!document.getElementById('inputContent').value.trim()) return null;
    return readGenerationInput();
}
