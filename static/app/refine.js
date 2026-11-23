/* AI 精修此頁：把這一頁轉成截圖（與匯出 PDF 相同的畫面），連同程式量測到的問題交給 AI，
 * 請 AI 找出版面問題（超出、留白、對齊、對比、層次）並只修正版面。
 * - 文字與數字是否被改動由程式比對，有改動時不套用（可選擇仍要套用）
 * - 圖表數值一律沿用原資料；修正結果存成新版本（版本註記「AI 精修」），可比較或切換回原版本
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入（需在 versions.js 之後）。 */
const REFINE_MAX_HINTS = 20;
let refiningSlide = false;

function setRefineState(idx, on) {
    const pairs = [[`refineSlideBtn-${idx}`, `refineSlideIcon-${idx}`, 10], ['refineCurrentBtn', 'refineCurrentIcon', 11]];
    pairs.forEach(([btnId, iconId, size]) => {
        const btn = document.getElementById(btnId), icon = document.getElementById(iconId);
        if (!btn || !icon) return;
        btn.disabled = on;
        icon.className = `fa-solid ${on ? 'fa-circle-notch fa-spin' : 'fa-wand-sparkles'} text-[${size}px]`;
    });
    const label = document.getElementById('refineCurrentLabel');
    if (label) label.textContent = on ? '精修中...' : 'AI 精修';
}

/* ----- 程式量測：在截圖用的同一個畫面上找出確定的問題，提示 AI 一定要修正 ----- */
// 以區塊的標題（沒有標題時用開頭的文字）指出是哪一個區塊
function describeEl(el) {
    const head = el.querySelector('h1, h2, h3, h4, h5, h6, strong, b');
    const t = ((head?.textContent.trim() ? head : el).textContent).replace(/\s+/g, ' ').trim();
    return t ? `「${t.slice(0, 16)}${t.length > 16 ? '…' : ''}」` : '一個區塊';
}
function measureLayoutIssues(frame) {
    const scaler = frame.querySelector('.slide-scaler');
    if (!scaler) return [];
    const hints = findOverflows(scaler).map(el => `${describeEl(el)}超出投影片畫面，播放與匯出時會被裁掉`);
    const root = scaler.children.length === 1 ? scaler.firstElementChild : scaler;
    root.querySelectorAll('*').forEach(el => {
        if (el.closest('[data-rs-chart]') || el.parentElement.closest('svg')) return;
        if (el.hasAttribute('data-rs-float') || !isVisualBox(el)) return;
        const down = el.scrollHeight - el.clientHeight, right = el.scrollWidth - el.clientWidth;
        if (down > 4) hints.push(`${describeEl(el)}區塊的內容超出區塊下緣約 ${Math.round(down)}px，可能被裁切或蓋到其他區塊`);
        else if (right > 4) hints.push(`${describeEl(el)}區塊的內容超出區塊右緣約 ${Math.round(right)}px`);
    });
    return [...new Set(hints)].slice(0, REFINE_MAX_HINTS);
}

/* ----- 內容把關：精修只能改版面，文字、數字、圖片與圖表的數量都不能變 ----- */
function contentFingerprint(html) {
    const body = parseSlideHtml(html);
    body.querySelectorAll('[data-rs-chart]').forEach(n => { n.innerHTML = ''; });   // 圖表文字由資料產生，另外比對
    const text = body.textContent.replace(/\s+/g, '');
    return {
        text,
        nums: (text.match(/\d+(?:[.,]\d+)*/g) || []).sort().join('|'),
        imgs: body.querySelectorAll('img').length,
        charts: body.querySelectorAll('[data-rs-chart]').length,
    };
}
// 回傳被改動的項目名稱；沒有改動時回傳 null。文字逐字比對，缺少或多出的字超過 5% 視為改寫（容許標點與換行調整）
function contentChange(before, after) {
    if (before.nums !== after.nums) return '數字';
    if (before.imgs !== after.imgs || before.charts !== after.charts) return '圖片或圖表';
    const count = s => { const m = new Map(); for (const c of s) m.set(c, (m.get(c) || 0) + 1); return m; };
    const a = count(before.text), b = count(after.text);
    let diff = 0;
    for (const [c, n] of a) diff += Math.max(0, n - (b.get(c) || 0));
    for (const [c, n] of b) diff += Math.max(0, n - (a.get(c) || 0));
    return diff > Math.max(4, before.text.length * 0.05) ? '文字' : null;
}

function issuesSummary(issues, max = 2) {
    if (!issues?.length) return '';
    return issues.slice(0, max).join('；') + (issues.length > max ? `…等 ${issues.length} 項` : '');
}

async function refineSlide(idx) {
    if (!currentPresentationData || !Array.isArray(currentPresentationData.slides)) return;
    if (isGenerating()) { showToast('正在生成整份簡報中，請稍候', 'info', 2200); return; }
    if (regeneratingSlideIdx !== null) { showToast('已有頁面正在處理中，請稍候', 'info', 2200); return; }
    if (idx < 0 || idx >= currentPresentationData.slides.length) return;
    if (editMode) toggleEditMode(false);                       // 先寫回編輯中的修改

    const deck = currentPresentationData;
    const target = deck.slides[idx];
    regeneratingSlideIdx = idx;                                // 與重產共用：鎖定這一頁，期間不能編輯、重產或調整頁面
    regeneratingDeck = deck;
    refiningSlide = true;
    slideBusyLabel = '精修中...';
    updateUndoButtons();
    setReviewRegenerateState(idx, true);
    setCurrentRegenerateState(true);
    setRefineState(idx, true);
    try {
        let hints = [];
        const [image] = await _exportRenderSlides([target], () => { }, {
            pixelRatio: 1, inspect: frame => { hints = measureLayoutIssues(frame); }
        });
        const slim = slimSlidesForLlm([target]);
        const input = getCurrentGenerationInput();
        const res = await fetch('/api/refine-slide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                num_pages: deck.slides.length,
                style_preference: input.style_preference || '',
                presentation_title: deck.presentation_title || '未命名簡報',
                deck_mode: normDeckMode(input.deck_mode),
                theme: deck.theme || null,
                slide_title: slim.slides[0].slide_title || '',
                slide_html: slim.slides[0].html_content,
                image,
                hints,
                ...getLlmChoice()
            })
        });
        throwIfSessionExpired(res);
        if (!res.ok) throw await readApiError(res);
        const data = await res.json();

        const findTarget = () => currentPresentationData === deck ? deck.slides.indexOf(target) : -1;
        if (findTarget() < 0) { showToast('簡報已切換或此頁已變更，已捨棄這次的精修結果', 'info', 3200); return; }
        if (!data.needs_fix) {
            const note = issuesSummary(data.issues);
            showToast(note ? `AI 檢查後認為不需要修改此頁（${note}）` : 'AI 檢查後認為此頁沒有需要修正的地方', 'success', 6000);
            return;
        }
        const html = restoreSlideImages(sanitizeSlideHtml(data.html_content), slim.images);
        const apply = async () => {
            const at = findTarget();
            if (at < 0) { showToast('此頁已變更，無法套用這次的精修結果', 'info', 3200); return; }
            // 圖表容器送出時已清空：以原本的圖表資料重新畫進新版面
            const refined = { ...target, html_content: html };
            await bakeSlideCharts([refined]);
            pushUndoSnapshot();
            deck.slides[at] = {
                ...slideWithNewVersion(target, { html_content: refined.html_content }, 'AI 精修'),
                notes_stale: target.notes_stale,                 // 內容沒有改變，講者備註的狀態維持原樣
                page_number: target.page_number || at + 1
            };
            syncCurrentPresentationToHistory();
            if (!document.getElementById('sectionPlayer').classList.contains('hidden')) {
                buildThumbnails();
                if (at === currentSlideIdx) renderSlide(at, 'fade'); else updateThumbnails();
            }
            if (!document.getElementById('sectionReview').classList.contains('hidden')) renderReviewSection(true);
            const versions = deck.slides[at].versions;
            showToast(`第 ${at + 1} 頁 AI 精修完成：${issuesSummary(data.issues) || '已調整版面'}`, 'success', 9000, {
                label: '比較舊版', onClick: () => {
                    const i = currentPresentationData === deck ? deck.slides.findIndex(s => s.versions === versions) : -1;
                    if (i >= 0) openVersionModal(i);
                }
            });
        };
        const changed = contentChange(contentFingerprint(target.html_content), contentFingerprint(html));
        if (changed) {
            showToast(`AI 精修時改動了此頁的${changed}，為避免內容出錯，沒有套用這次的結果`, 'error', 10000, { label: '仍要套用', onClick: apply });
            return;
        }
        await apply();
    } catch (err) {
        if (!err.handled) showToast(friendlyError(err), 'error', 8000, retryAction(err, () => refineSlide(idx)));
    } finally {
        setRefineState(idx, false);
        setReviewRegenerateState(idx, false);
        setCurrentRegenerateState(false);
        slideBusyLabel = '重產中...';
        refiningSlide = false;
        regeneratingSlideIdx = null;
        regeneratingDeck = null;
        updateUndoButtons();
    }
}
