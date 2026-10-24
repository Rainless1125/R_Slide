/* R Slide 後台：登入、分頁切換與各分頁的資料載入（API 見 admin.py） */
/* ===================== 主題（與主畫面共用 localStorage 的 theme） ===================== */
function initTheme() {
    let theme = null;
    try { theme = localStorage.getItem('theme'); } catch (e) { }
    const dark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
}
function toggleTheme() {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { }
}
initTheme();

/* ===================== 小工具 ===================== */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n || 0).toLocaleString('en-US');
const fmtTime = ms => {
    if (!ms) return '—';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const stars = r => r ? `<span class="stars" aria-label="${r} 星">${'★'.repeat(r)}${'☆'.repeat(5 - r)}</span>` : '';
const emptyRow = (cols, text) => `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;

function showToast(msg, type = 'info', ms = 3200) {
    const icon = { info: 'fa-circle-info text-sky-400', error: 'fa-triangle-exclamation text-amber-400', success: 'fa-circle-check text-emerald-400' }[type];
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(msg)}</span>`;
    $('toastRoot').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
}

class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api/admin' + path, {
        method, credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        let msg = `請求失敗（${res.status}）`;
        try { const d = await res.json(); if (typeof d.detail === 'string') msg = d.detail; } catch (e) { }
        if (res.status === 401 && path !== '/login') showLogin();
        throw new ApiError(res.status, msg);
    }
    return res.json();
}

/* ===================== 登入 ===================== */
let passwordRule = '';

function showLogin(notice = '') {
    $('adminMain').classList.add('hidden');
    $('adminChip').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    $('loginNotice').classList.toggle('hidden', !notice);
    $('loginNotice').innerHTML = notice;
    $('loginFields').disabled = !!notice;
    if (!notice) setTimeout(() => $('loginUsername').focus(), 50);
}

function showAdmin(username) {
    $('loginView').classList.add('hidden');
    $('adminMain').classList.remove('hidden');
    $('adminChip').classList.remove('hidden');
    $('adminName').textContent = username;
    document.querySelectorAll('.password-rule').forEach(el => { el.textContent = passwordRule; });
    switchTab(currentTab());
}

async function initAuth() {
    let me;
    try {
        me = await api('/me');
    } catch (e) {
        showLogin(`<i class="fa-solid fa-triangle-exclamation mr-1"></i>無法連線到伺服器：${esc(e.message)}`);
        return;
    }
    passwordRule = me.password_rule;
    if (me.status === 'not_configured') {
        showLogin('<i class="fa-solid fa-circle-info mr-1"></i>後台尚未啟用。請在伺服器的 <code>.env</code> 設定 <code>ADMIN_USERNAME</code> 與 <code>ADMIN_PASSWORD</code>，再重新啟動服務。');
    } else if (me.status === 'weak_password') {
        showLogin(`<i class="fa-solid fa-triangle-exclamation mr-1"></i><code>ADMIN_PASSWORD</code> 不符合密碼規則，後台未啟用：${esc(me.password_rule)}。修改 <code>.env</code> 後重新啟動服務。`);
    } else if (me.username) {
        showAdmin(me.username);
    } else {
        showLogin();
    }
}

$('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginSubmit');
    $('loginError').textContent = '';
    btn.disabled = true;
    try {
        const r = await api('/login', { method: 'POST', body: { username: $('loginUsername').value, password: $('loginPassword').value } });
        $('loginPassword').value = '';
        showAdmin(r.username);
    } catch (err) {
        $('loginError').textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});

async function adminLogout() {
    try { await api('/logout', { method: 'POST' }); } catch (e) { }
    showLogin();
}

/* ===================== 分頁 ===================== */
const TABS = ['overview', 'users', 'usage', 'feedback', 'lockouts'];
const DAYS_TABS = new Set(['overview', 'usage', 'feedback']);   // 會依區間篩選的分頁

function currentTab() {
    const t = location.hash.slice(1);
    return TABS.includes(t) ? t : 'overview';
}

function switchTab(tab) {
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);
    document.querySelectorAll('.admin-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.admin-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab));
    $('daysWrap').classList.toggle('invisible', !DAYS_TABS.has(tab));
    refreshTab();
}

function refreshTab() {
    const loaders = { overview: loadOverview, users: loadUsers, usage: loadUsage, feedback: loadFeedback, lockouts: loadLockouts };
    loaders[currentTab()]().catch(e => { if (e.status !== 401) showToast(e.message, 'error'); });
}

document.querySelectorAll('.admin-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
$('daysSelect').addEventListener('change', refreshTab);
const days = () => $('daysSelect').value;
const daysLabel = () => $('daysSelect').selectedOptions[0].textContent;

/* ===================== 總覽 ===================== */
async function loadOverview() {
    const o = await api(`/overview?days=${days()}`);
    const tile = (icon, label, value, sub = '') => `
        <div class="admin-card stat-tile">
            <div class="label"><i class="fa-solid ${icon}"></i>${esc(label)}</div>
            <div class="value">${value}</div>
            <div class="sub">${sub}</div>
        </div>`;
    const span = esc(daysLabel());
    $('overviewStats').innerHTML = [
        tile('fa-users', '帳號數', num(o.users), `${num(o.history)} 筆歷史記錄`),
        tile('fa-user-check', '使用 LLM 的帳號', num(o.active_users), span),
        tile('fa-bolt', 'LLM 呼叫', num(o.llm_calls), `${span}・失敗 ${num(o.llm_errors)}・限流 ${num(o.llm_rate_limited)}`),
        tile('fa-coins', '合計 tokens', num(o.llm_total_tokens), span),
        tile('fa-comment-dots', '意見回饋', num(o.feedback), span),
        tile('fa-star', '平均使用體驗', o.feedback_avg_rating == null ? '—' : `${o.feedback_avg_rating.toFixed(1)}<span class="text-base text-zinc-400"> / 5</span>`,
            `${num(o.feedback_rated)} 則評分`),
        tile('fa-lock', '被鎖定的 IP', num(o.lockouts), '目前'),
        tile('fa-door-open', '自行註冊', o.allow_registration ? '開放' : '關閉', 'ALLOW_REGISTRATION'),
    ].join('');
    $('overviewNote').textContent = '統計區間可在右上角切換；帳號數、歷史記錄與 IP 鎖定為目前的數量。';
}

/* ===================== 帳號 ===================== */
let users = [];

async function loadUsers() {
    users = await api('/users');
    renderUsers();
}

function renderUsers() {
    const q = $('userSearch').value.trim().toLowerCase();
    const list = q ? users.filter(u => u.username.toLowerCase().includes(q)) : users;
    $('userCount').textContent = q ? `${list.length} / ${users.length}` : String(users.length);
    $('userRows').innerHTML = list.length ? list.map(u => `
        <tr>
            <td class="font-semibold">${esc(u.username)}</td>
            <td>${fmtTime(u.created_at)}</td>
            <td class="num">${num(u.history_count)}</td>
            <td>${fmtTime(u.last_used)}</td>
            <td class="text-right">
                <button class="admin-btn-ghost admin-btn-sm" data-action="password" data-user="${esc(u.username)}"><i class="fa-solid fa-key"></i>重設密碼</button>
                <button class="admin-btn-ghost admin-btn-sm danger" data-action="delete" data-user="${esc(u.username)}"><i class="fa-regular fa-trash-can"></i>刪除</button>
            </td>
        </tr>`).join('') : emptyRow(5, users.length ? '沒有符合的帳號' : '目前還沒有帳號');
}

$('userSearch').addEventListener('input', renderUsers);

$('userRows').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const username = btn.dataset.user;
    if (btn.dataset.action === 'password') {
        openModal({
            title: `重設 ${username} 的密碼`,
            text: '重設後該帳號在所有裝置上都需重新登入。',
            password: true, submitLabel: '重設密碼',
            onSubmit: async pw => {
                await api(`/users/${encodeURIComponent(username)}/password`, { method: 'PUT', body: { password: pw } });
                showToast(`已重設 ${username} 的密碼`, 'success');
            },
        });
    } else {
        openModal({
            title: `刪除帳號 ${username}？`,
            text: '帳號與其所有歷史記錄會一併刪除且無法復原；LLM 使用紀錄與意見回饋會保留。',
            danger: true, submitLabel: '刪除帳號',
            onSubmit: async () => {
                await api(`/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
                showToast(`已刪除 ${username}`, 'success');
                loadUsers();
            },
        });
    }
});

$('addUserForm').addEventListener('submit', async e => {
    e.preventDefault();
    const username = $('newUsername').value.trim();
    try {
        await api('/users', { method: 'POST', body: { username, password: $('newPassword').value } });
        $('newUsername').value = '';
        $('newPassword').value = '';
        showToast(`已建立帳號 ${username}`, 'success');
        loadUsers();
    } catch (err) {
        if (err.status !== 401) showToast(err.message, 'error', 4500);
    }
});

/* ===================== LLM 用量 ===================== */
async function loadUsage() {
    const rows = await api(`/usage?days=${days()}`);
    $('usageRows').innerHTML = rows.length ? rows.map(r => `
        <tr class="clickable" data-user="${esc(r.username)}" title="點選展開明細">
            <td class="font-semibold"><i class="fa-solid fa-chevron-right text-[10px] text-zinc-400 mr-1.5 transition-transform"></i>${esc(r.username)}</td>
            <td class="num">${num(r.calls)}</td>
            <td class="num ${r.errors ? 'text-red-500' : ''}">${num(r.errors)}</td>
            <td class="num ${r.rate_limited ? 'text-amber-500' : ''}">${num(r.rate_limited)}</td>
            <td class="num">${num(r.generates)}</td>
            <td class="num">${num(r.regenerates)}</td>
            <td class="num">${num(r.outlines)}</td>
            <td class="num">${num(r.extracts)}</td>
            <td class="num">${num(r.input_tokens)}</td>
            <td class="num">${num(r.output_tokens)}</td>
            <td class="num font-semibold">${num(r.total_tokens)}</td>
            <td class="num">${num(r.max_same_content)}</td>
            <td>${fmtTime(r.last_used)}</td>
        </tr>`).join('') : emptyRow(13, `${daysLabel()}沒有 LLM 使用紀錄`);
}

$('usageRows').addEventListener('click', async e => {
    const tr = e.target.closest('tr.clickable');
    if (!tr) return;
    const chevron = tr.querySelector('.fa-chevron-right');
    if (tr.nextElementSibling?.classList.contains('detail')) {
        tr.nextElementSibling.remove();
        chevron.style.transform = '';
        return;
    }
    chevron.style.transform = 'rotate(90deg)';
    const detail = document.createElement('tr');
    detail.className = 'detail';
    detail.innerHTML = `<td colspan="13"><div class="px-6 py-3 text-xs text-zinc-400">載入中…</div></td>`;
    tr.after(detail);
    try {
        const rows = await api(`/usage/${encodeURIComponent(tr.dataset.user)}?days=${days()}`);
        detail.firstElementChild.innerHTML = `<div class="px-4 py-2"><table class="admin-table">
            <thead><tr><th>日期</th><th>平台</th><th>模型</th><th class="num">呼叫</th><th class="num">失敗</th><th class="num">輸入 tokens</th><th class="num">輸出 tokens</th><th class="num">合計 tokens</th></tr></thead>
            <tbody>${rows.length ? rows.map(r => `<tr>
                <td>${esc(r.day)}</td><td>${esc(r.provider)}</td><td>${esc(r.model)}</td>
                <td class="num">${num(r.calls)}</td><td class="num ${r.errors ? 'text-red-500' : ''}">${num(r.errors)}</td>
                <td class="num">${num(r.input_tokens)}</td><td class="num">${num(r.output_tokens)}</td><td class="num">${num(r.total_tokens)}</td>
            </tr>`).join('') : emptyRow(8, '沒有成功送出的呼叫（只有被限流的請求）')}</tbody></table></div>`;
    } catch (err) {
        detail.remove();
        chevron.style.transform = '';
        if (err.status !== 401) showToast(err.message, 'error');
    }
});

/* ===================== 意見回饋 ===================== */
async function loadFeedback() {
    const user = $('feedbackUser').value.trim();
    const rows = await api(`/feedback?days=${days()}${user ? '&username=' + encodeURIComponent(user) : ''}`);
    const ratings = rows.map(r => r.rating).filter(Boolean);
    const avg = ratings.length ? `，平均使用體驗 ${(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)} 星（${ratings.length} 則評分）` : '';
    $('feedbackSummary').textContent = `${user ? user + ' ' : ''}${daysLabel()}共 ${rows.length} 則意見回饋${avg}`;
    $('feedbackList').innerHTML = rows.length ? rows.map(r => `
        <article class="admin-card p-4">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span class="font-bold text-sm">${esc(r.username)}</span>
                ${stars(r.rating)}
                <span class="text-zinc-400 ml-auto tabular-nums">${fmtTime(r.created_at)}</span>
            </div>
            ${r.content ? `<p class="mt-2 text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">${esc(r.content)}</p>` : ''}
        </article>`).join('') : `<div class="admin-card p-10 text-center text-sm text-zinc-400">沒有意見回饋</div>`;
}

$('feedbackUser').addEventListener('keydown', e => { if (e.key === 'Enter') refreshTab(); });

/* ===================== IP 鎖定 ===================== */
async function loadLockouts() {
    const rows = await api('/lockouts');
    $('lockoutRows').innerHTML = rows.length ? rows.map(r => `
        <tr>
            <td class="font-mono">${esc(r.ip)}</td>
            <td>${fmtTime(r.locked_until)}</td>
            <td class="text-right"><button class="admin-btn-ghost admin-btn-sm" data-ip="${esc(r.ip)}"><i class="fa-solid fa-lock-open"></i>解除鎖定</button></td>
        </tr>`).join('') : emptyRow(3, '目前沒有被鎖定的 IP');
}

$('lockoutRows').addEventListener('click', async e => {
    const btn = e.target.closest('button[data-ip]');
    if (!btn) return;
    btn.disabled = true;
    try {
        await api(`/lockouts/${encodeURIComponent(btn.dataset.ip)}`, { method: 'DELETE' });
        showToast(`已解除 ${btn.dataset.ip} 的鎖定`, 'success');
        loadLockouts();
    } catch (err) {
        btn.disabled = false;
        if (err.status !== 401) showToast(err.message, 'error');
    }
});

/* ===================== 對話框 ===================== */
let modalSubmit = null;

function openModal({ title, text, password = false, danger = false, submitLabel, onSubmit }) {
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalError').textContent = '';
    $('modalPasswordWrap').classList.toggle('hidden', !password);
    $('modalPassword').value = '';
    $('modalSubmit').textContent = submitLabel;
    $('modalSubmit').classList.toggle('danger', danger);
    modalSubmit = async () => onSubmit(password ? $('modalPassword').value : undefined);
    $('adminModal').classList.remove('hidden');
    setTimeout(() => (password ? $('modalPassword') : $('modalSubmit')).focus(), 50);
}

function closeModal() {
    $('adminModal').classList.add('hidden');
    modalSubmit = null;
}

$('modalForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!modalSubmit) return;
    const btn = $('modalSubmit');
    btn.disabled = true;
    try {
        await modalSubmit();
        closeModal();
    } catch (err) {
        if (err.status === 401) closeModal();
        else $('modalError').textContent = err.message;
    } finally {
        btn.disabled = false;
    }
});
$('adminModal').addEventListener('click', e => { if (e.target === $('adminModal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('adminModal').classList.contains('hidden')) closeModal(); });

initAuth();
