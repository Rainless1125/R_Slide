/* 確認對話框（取代瀏覽器的 confirm()）與歷史記錄「複製給其他帳號」Modal
 * 一般 <script>，在 main.js 之前載入；Esc 關閉由 main.js 的全域快捷鍵處理。 */

/* ===================== 確認對話框 ===================== */
let confirmResolve = null;
let confirmReturnFocus = null;

function isConfirmOpen() { return !document.getElementById('confirmModal').classList.contains('hidden'); }

// 回傳 Promise<boolean>：按確認為 true，取消 / Esc / 點背景為 false
// danger：紅色按鈕，預設焦點放在「取消」，避免誤按 Enter 就刪除
function confirmDialog({ title, message = '', confirmText = '確定', icon = 'fa-trash', danger = true } = {}) {
    if (confirmResolve) closeConfirmDialog(false);
    confirmReturnFocus = document.activeElement;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    document.getElementById('confirmIcon').className = `fa-solid ${icon} text-sm`;
    document.getElementById('confirmIconWrap').className = 'w-9 h-9 shrink-0 rounded-full flex items-center justify-center ' + (danger
        ? 'bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400'
        : 'bg-violet-50 text-violet-500 dark:bg-violet-500/15 dark:text-violet-300');
    const ok = document.getElementById('confirmOkBtn');
    ok.textContent = confirmText;
    ok.className = 'icon-btn h-9 px-4 rounded-full text-sm font-semibold ' + (danger
        ? 'bg-red-500 text-white hover:bg-red-600'
        : 'bg-black text-white dark:bg-white dark:text-black hover:bg-zinc-800 dark:hover:bg-zinc-200');
    document.getElementById('confirmModal').classList.remove('hidden');
    (danger ? document.getElementById('confirmCancelBtn') : ok).focus();
    return new Promise(resolve => { confirmResolve = resolve; });
}

function closeConfirmDialog(result) {
    document.getElementById('confirmModal').classList.add('hidden');
    const resolve = confirmResolve;
    confirmResolve = null;
    confirmReturnFocus?.focus?.();
    confirmReturnFocus = null;
    resolve?.(result);
}

/* ===================== 複製給其他帳號 ===================== */
let shareItemId = null;
let shareReturnFocus = null;
let shareSending = false;
const SHARE_LAST_KEY = 'rslide_share_last';     // 記住上次複製的對象，方便來回交接

function isShareOpen() { return !document.getElementById('shareModal').classList.contains('hidden'); }

function openShareModal(id) {
    const h = historyItems.find(x => x.id === id);
    if (!h) return;
    shareItemId = id;
    shareReturnFocus = document.activeElement;
    document.getElementById('shareDeckTitle').textContent = `「${h.title}」· ${h.pages ?? 0} 頁`;
    document.getElementById('shareDeckTitle').title = h.title;
    const input = document.getElementById('shareUsername');
    if (!input.value) {
        // 收到的簡報預設複製回給寄件人，其餘帶入上次的對象
        let last = '';
        try { last = localStorage.getItem(SHARE_LAST_KEY) || ''; } catch (_) { }
        input.value = h.sharedFrom || last;
    }
    document.getElementById('shareError').textContent = '';
    document.getElementById('shareModal').classList.remove('hidden');
    input.focus();
    input.select();
}

function closeShareModal() {
    if (shareSending) return;
    document.getElementById('shareModal').classList.add('hidden');
    document.getElementById('shareUsername').value = '';
    shareItemId = null;
    shareReturnFocus?.focus?.();
    shareReturnFocus = null;
}

async function submitShare(e) {
    e?.preventDefault();
    if (shareSending || !shareItemId) return;
    const input = document.getElementById('shareUsername');
    const errEl = document.getElementById('shareError');
    const username = input.value.trim();
    if (!username) { errEl.textContent = '請輸入對方的帳號'; input.focus(); return; }
    if (currentUser && username.toLowerCase() === currentUser.toLowerCase()) { errEl.textContent = '不能複製給自己'; input.focus(); return; }
    const id = shareItemId;
    const btn = document.getElementById('shareSubmit');
    const icon = document.getElementById('shareSubmitIcon');
    shareSending = true;
    btn.disabled = true;
    icon.className = 'fa-solid fa-spinner fa-spin text-[11px]';
    errEl.textContent = '';
    try {
        // 先把尚未送出的修改存到伺服器，複製出去的才是畫面上最新的內容
        await flushHistorySave(id);
        await saveChains.get(id);
        const r = await historyFetch('POST', '/' + encodeURIComponent(id) + '/copy', { username });
        try { localStorage.setItem(SHARE_LAST_KEY, r.username); } catch (_) { }
        shareSending = false;
        closeShareModal();
        showToast(`已複製一份給「${r.username}」，對方重新整理歷史記錄即可看到`, 'success', 3500);
    } catch (err) {
        if (err.status === 401) { shareSending = false; closeShareModal(); return; }   // 已跳出登入視窗
        errEl.textContent = err.status ? err.message : friendlyError(err);
        input.focus();
    } finally {
        shareSending = false;
        btn.disabled = false;
        icon.className = 'fa-solid fa-copy text-[11px]';
    }
}

document.getElementById('shareUsername').addEventListener('input', () => { document.getElementById('shareError').textContent = ''; });
