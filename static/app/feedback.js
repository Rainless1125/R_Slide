/* 意見回饋 Modal：右上角「使用教學」旁的按鈕開啟，輸入一段文字送到 /api/feedback
 * 一般 <script>，在 main.js 之前載入；Esc 關閉由 main.js 的全域快捷鍵處理。 */
let feedbackReturnFocus = null;
let feedbackSending = false;

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
    if (!content) { errEl.textContent = '請輸入回饋內容'; input.focus(); return; }
    const btn = document.getElementById('feedbackSubmit');
    const icon = document.getElementById('feedbackSubmitIcon');
    feedbackSending = true;
    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin text-[11px]';
    try {
        const res = await fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content })
        });
        if (res.status === 401) { closeFeedback(); onSessionExpired(); return; }   // 輸入的文字保留，重新登入後可再送出
        if (!res.ok) throw await readApiError(res);
        input.value = '';
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
    const input = document.getElementById('feedbackInput');
    input.addEventListener('input', updateFeedbackCount);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitFeedback(); }
    });
})();
