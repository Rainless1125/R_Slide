/* 意見回饋 Modal：右上角「使用教學」旁的按鈕開啟，選擇使用體驗 1~5 星（選填）並輸入一段文字，送到 /api/feedback
 * 一般 <script>，在 main.js 之前載入；Esc 關閉由 main.js 的全域快捷鍵處理。 */
let feedbackReturnFocus = null;
let feedbackSending = false;
let feedbackRating = null;         // 1~5，未評分為 null
const FEEDBACK_RATING_TEXT = ['很差', '不太好', '普通', '不錯', '非常好'];

function ratingStars() { return [...document.querySelectorAll('#feedbackRating [data-rating]')]; }

// preview：滑鼠移到星星上時先預覽，離開後回到已選的評分
function paintRating(preview = null) {
    const shown = preview ?? feedbackRating;
    ratingStars().forEach((b, i) => {
        b.classList.toggle('on', shown != null && i < shown);
        b.setAttribute('aria-checked', i + 1 === feedbackRating ? 'true' : 'false');
        // roving tabindex：Tab 只停在已選的星（未評分時停在第 1 顆），方向鍵切換
        b.tabIndex = i + 1 === (feedbackRating ?? 1) ? 0 : -1;
    });
    document.getElementById('feedbackRatingText').textContent = shown ? FEEDBACK_RATING_TEXT[shown - 1] : '選填';
}

function setFeedbackRating(value) {
    // 再點一次同一顆星即取消評分
    feedbackRating = value === feedbackRating ? null : value;
    paintRating();
    document.getElementById('feedbackError').textContent = '';
}

function isFeedbackOpen() { return !document.getElementById('feedbackModal').classList.contains('hidden'); }

function updateFeedbackCount() {
    const input = document.getElementById('feedbackInput');
    document.getElementById('feedbackCount').textContent = `${input.value.length} / ${input.maxLength}`;
    document.getElementById('feedbackError').textContent = '';
}

function openFeedback() {
    feedbackReturnFocus = document.activeElement;
    document.getElementById('feedbackModal').classList.remove('hidden');
    updateFeedbackCount();
    document.getElementById('feedbackInput').focus();
}

function closeFeedback() {
    document.getElementById('feedbackModal').classList.add('hidden');
    feedbackReturnFocus?.focus?.();
    feedbackReturnFocus = null;
}

async function submitFeedback(e) {
    e?.preventDefault();
    if (feedbackSending) return;
    const input = document.getElementById('feedbackInput');
    const errEl = document.getElementById('feedbackError');
    const content = input.value.trim();
    if (!content && feedbackRating == null) { errEl.textContent = '請選擇使用體驗評分或輸入回饋內容'; input.focus(); return; }
    const btn = document.getElementById('feedbackSubmit');
    const icon = document.getElementById('feedbackSubmitIcon');
    feedbackSending = true;
    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin text-[11px]';
    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, rating: feedbackRating })
        });
        if (res.status === 401) { closeFeedback(); onSessionExpired(); return; }   // 輸入的文字保留，重新登入後可再送出
        if (!res.ok) throw await readApiError(res);
        input.value = '';
        feedbackRating = null;
        paintRating();
        closeFeedback();
        showToast('感謝你的回饋！', 'success');
    } catch (err) {
        errEl.textContent = err.status ? err.message : friendlyError(err);
    } finally {
        feedbackSending = false;
        btn.disabled = false;
        icon.className = 'fa-solid fa-paper-plane text-[11px]';
    }
}

(function () {
    const group = document.getElementById('feedbackRating');
    ratingStars().forEach((b) => {
        const value = Number(b.dataset.rating);
        b.addEventListener('click', () => setFeedbackRating(value));
        b.addEventListener('mouseenter', () => paintRating(value));
    });
    group.addEventListener('mouseleave', () => paintRating());
    // 星等：方向鍵調整評分（WAI-ARIA radio group）
    group.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        feedbackRating = Math.max(1, Math.min(5, (feedbackRating ?? 0) + d));
        paintRating();
        ratingStars()[feedbackRating - 1].focus();
    });
    paintRating();

    const input = document.getElementById('feedbackInput');
    input.addEventListener('input', updateFeedbackCount);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitFeedback(); }
    });
})();
