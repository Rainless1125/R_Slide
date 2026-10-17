/* 帳號登入 / 註冊、登出，以及把舊版存在 localStorage 的歷史記錄匯入帳號
 * 所有 app/*.js 是一般 <script>（非 module），共用全域，須依 index.html 中的順序載入。 */
const LEGACY_HISTORY_KEY = 'rslide_history_v1';
let currentUser = null;
let authMode = 'login';            // 'login' | 'register'
let allowRegistration = true;

function isAuthOpen() { return !document.getElementById('authModal').classList.contains('hidden'); }

function setAuthMode(mode) {
    authMode = mode === 'register' && allowRegistration ? 'register' : 'login';
    const reg = authMode === 'register';
    document.getElementById('authTitle').textContent = reg ? '註冊新帳號' : '登入 R Slide';
    document.getElementById('authSubmitLabel').textContent = reg ? '註冊並登入' : '登入';
    document.getElementById('authPassword').autocomplete = reg ? 'new-password' : 'current-password';
    document.getElementById('authHint').classList.toggle('hidden', !reg);
    document.getElementById('authSwitch').classList.toggle('hidden', !allowRegistration);
    document.getElementById('authSwitchText').textContent = reg ? '已經有帳號？' : '還沒有帳號？';
    document.getElementById('authSwitchBtn').textContent = reg ? '登入' : '註冊新帳號';
    document.getElementById('authError').textContent = '';
}
function toggleAuthMode() { setAuthMode(authMode === 'login' ? 'register' : 'login'); }

function showAuth(message = '') {
    setAuthMode(authMode);
    document.getElementById('authError').textContent = message;
    document.getElementById('authModal').classList.remove('hidden');
    document.getElementById('authPassword').value = '';
    const user = document.getElementById('authUsername');
    (user.value ? document.getElementById('authPassword') : user).focus();
}

function setCurrentUser(username) {
    currentUser = username;
    document.getElementById('userChip').classList.toggle('hidden', !username);
    document.getElementById('userName').textContent = username || '';
}

async function submitAuth(e) {
    e.preventDefault();
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    const btn = document.getElementById('authSubmit');
    const errEl = document.getElementById('authError');
    if (!username || !password) { errEl.textContent = '請輸入帳號與密碼'; return; }
    btn.disabled = true;
    errEl.textContent = '';
    try {
        const res = await fetch('/api/auth/' + (authMode === 'register' ? 'register' : 'login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        if (!res.ok) throw await readApiError(res);
        await onLoggedIn((await res.json()).username);
    } catch (err) {
        errEl.textContent = err.status ? err.message : friendlyError(err);
    } finally {
        btn.disabled = false;
    }
}

async function onLoggedIn(username) {
    const switched = currentUser && currentUser.toLowerCase() !== username.toLowerCase();
    if (switched) {                // 登入逾時後換成別的帳號：不可沿用前一位使用者的畫面
        currentHistoryId = null;
        resetWorkspace(true);
    }
    setCurrentUser(username);
    document.getElementById('authModal').classList.add('hidden');
    document.getElementById('authPassword').value = '';
    await importLegacyHistory();
    await loadHistory();
    // 登入逾時期間的修改沒有存到：重新登入後把目前開著的簡報再存一次
    if (!switched && currentHistoryId && historyItems.some(h => h.id === currentHistoryId)) syncCurrentPresentationToHistory();
}

function onSessionExpired() {
    if (isAuthOpen()) return;
    showAuth('登入已逾時，請重新登入；目前畫面上的簡報不會遺失');
}

async function logout() {
    if (isGenerating()) { showToast('正在生成中，請稍候', 'info'); return; }
    try { await flushAllHistorySaves(); } catch (_) { }
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) { }
    historyItems = [];
    currentHistoryId = null;
    resetWorkspace(true);
    renderHistory();
    setCurrentUser(null);
    document.getElementById('authUsername').value = '';
    setAuthMode('login');
    showAuth();
}

// 舊版的歷史記錄存在瀏覽器 localStorage：第一次登入時詢問是否匯入到目前的帳號
async function importLegacyHistory() {
    let list;
    try { list = JSON.parse(localStorage.getItem(LEGACY_HISTORY_KEY)); } catch (_) { return; }
    if (!Array.isArray(list)) return;
    const items = list
        .filter(h => h && typeof h.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(h.id) && Array.isArray(h.data?.slides))
        .slice(0, MAX_HISTORY)
        .map(h => ({
            id: h.id,
            title: String(h.title || '未命名簡報').slice(0, 200),
            createdAt: Number.isFinite(h.createdAt) ? h.createdAt : null,
            input: h.input && typeof h.input === 'object' ? h.input : {},
            data: h.data
        }));
    if (!items.length) { try { localStorage.removeItem(LEGACY_HISTORY_KEY); } catch (_) { } return; }
    if (!confirm(`這個瀏覽器裡有 ${items.length} 筆舊的歷史記錄，要匯入到「${currentUser}」帳號嗎？\n匯入後會從瀏覽器移除；選「取消」則保留，下次登入時再詢問。`)) return;
    try {
        await historyFetch('POST', '/import', { items });
        try { localStorage.removeItem(LEGACY_HISTORY_KEY); } catch (_) { }
        showToast(`已匯入 ${items.length} 筆歷史記錄`, 'success', 2400);
    } catch (err) {
        if (!err.handled) showToast('匯入舊紀錄失敗：' + friendlyError(err), 'error', 6000);
    }
}

async function initAuth() {
    let me = { username: null, allow_registration: true };
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) me = await res.json();
    } catch (err) {
        showToast(friendlyError(err), 'error', 8000);
    }
    allowRegistration = me.allow_registration !== false;
    if (me.username) await onLoggedIn(me.username);
    else showAuth();
}
