'use strict';

/* ── Config constants ────────────────────────────────────────────────────────
   Extract magic numbers here for easy adjustment.                            */
const TOAST_DURATION_MS      = 3200;  // How long toasts stay visible (ms)
const AUTO_REFRESH_INTERVAL  = 5000;  // Connections auto-refresh interval (ms)

/* ── Globals ─────────────────────────────────────────────────────────────────
   allUsers  : array of user objects from /api/users
   allConns  : array of connection objects from /api/connections           */
let allUsers    = [];
let allConns    = [];
let connTimer   = null;
let currentView = 'dashboard';

// ── Toast Notifications ───────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), TOAST_DURATION_MS);
}

// ── API Helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/'; return null; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ── View Switching ────────────────────────────────────────────────────────────
function switchView(name) {
    currentView = name;

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(el => {
        el.classList.toggle('active', el.id === `view-${name}`);
    });

    const titles = {
        dashboard:    'Dashboard',
        connections:  'Active Connections',
        users:        'User Management',
        'panel-admins': 'Panel Admins',
    };
    document.getElementById('topbar-title').textContent = titles[name] || name;

    // Topbar action buttons per view
    const actions = document.getElementById('topbar-actions');
    actions.innerHTML = '';

    if (name === 'connections') {
        clearInterval(connTimer);
        loadConnections();
        connTimer = setInterval(loadConnections, AUTO_REFRESH_INTERVAL);
    } else {
        clearInterval(connTimer);
    }

    if (name === 'users')         loadUsers();
    if (name === 'dashboard')     loadDashboard();
    if (name === 'panel-admins')  loadPanelAdmins();
}

// ── Logout ────────────────────────────────────────────────────────────────────
async function logout() {
    await api('POST', '/api/logout');
    window.location.href = '/';
}

// ── Admin Level Helpers ───────────────────────────────────────────────────────
const LEVEL_LABELS = ['No Access', 'Moderator', 'Admin', 'Super Admin'];
const LEVEL_BADGES = ['badge-none', 'badge-mod', 'badge-admin', 'badge-superadmin'];

function levelBadge(level) {
    const l = parseInt(level, 10) || 0;
    return `<span class="badge ${LEVEL_BADGES[l]}">${LEVEL_LABELS[l]}</span>`;
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function timeAgo(iso) {
    if (!iso) return '—';
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60)  return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
    try {
        const [users, conns] = await Promise.all([
            api('GET', '/api/users'),
            api('GET', '/api/connections'),
        ]);
        if (!users || !conns) return;
        allUsers = users;
        allConns = conns;

        document.getElementById('stat-online').textContent = conns.length;
        document.getElementById('stat-total').textContent  = users.length;
        document.getElementById('stat-banned').textContent = users.filter(u => u.banned).length;
        document.getElementById('stat-admins').textContent = users.filter(u => u.adminLevel > 0).length;
        document.getElementById('conn-count-badge').textContent = conns.length;

        const tbody = document.getElementById('dashboard-tbody');
        const recent = [...users]
            .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
            .slice(0, 20);

        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">No players recorded yet.</td></tr>';
            return;
        }
        tbody.innerHTML = recent.map(u => {
            const isOnline = conns.some(c => c.socialClub === u.socialClub);
            return `<tr>
                <td><strong>${escHtml(u.name)}</strong></td>
                <td style="font-size:12px;color:var(--text-muted);">${escHtml(u.socialClub)}</td>
                <td>${levelBadge(u.adminLevel)}</td>
                <td style="font-size:12px;">${timeAgo(u.lastSeen)}</td>
                <td>${isOnline
                    ? '<span class="badge badge-online">● Online</span>'
                    : (u.banned ? '<span class="badge badge-banned">Banned</span>' : '<span class="badge badge-none">Offline</span>')
                }</td>
            </tr>`;
        }).join('');
    } catch (e) {
        toast('Failed to load dashboard: ' + e.message, 'error');
    }
}

// ── Active Connections ────────────────────────────────────────────────────────
async function loadConnections() {
    try {
        const conns = await api('GET', '/api/connections');
        if (!conns) return;
        allConns = conns;
        document.getElementById('conn-count-badge').textContent = conns.length;

        const grid = document.getElementById('conn-grid');
        if (conns.length === 0) {
            grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
                <div class="empty-icon">🌐</div>
                <p>No players are currently connected.</p>
            </div>`;
            return;
        }
        grid.innerHTML = conns.map(c => `
            <div class="conn-card" id="conn-card-${c.id}">
                <div class="conn-card-header">
                    <div class="conn-avatar">${escHtml(c.name.charAt(0).toUpperCase())}</div>
                    <div>
                        <div class="conn-name">${escHtml(c.name)}</div>
                        <div class="conn-id">ID: ${c.id} &nbsp;|&nbsp; Ping: ${c.ping} ms</div>
                    </div>
                </div>
                <div class="conn-meta">
                    ${levelBadge(c.adminLevel)}
                    ${c.banned ? '<span class="badge badge-banned">Banned</span>' : ''}
                    ${c.permissions && c.permissions.vip ? '<span class="badge badge-vip">VIP</span>' : ''}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;">
                    ${escHtml(c.socialClub)}
                </div>
                <div class="conn-actions">
                    <button class="btn btn-success btn-xs" onclick="liveAction(${c.id},'heal')">💚 Heal</button>
                    <button class="btn btn-danger  btn-xs" onclick="liveAction(${c.id},'kill')">💀 Kill</button>
                    <button class="btn btn-warning btn-xs" onclick="liveAction(${c.id},'freeze',true)">🧊 Freeze</button>
                    <button class="btn btn-info    btn-xs" onclick="liveAction(${c.id},'freeze',false)">🔥 Unfreeze</button>
                    <button class="btn btn-ghost   btn-xs" onclick="openLivePermsModal(${c.id})">⚙ Perms</button>
                    <button class="btn btn-ghost   btn-xs" onclick="openSetLevelModal(${c.id})">🛡 Level</button>
                    <button class="btn btn-danger  btn-xs" onclick="openKickModal(${c.id})">🚪 Kick</button>
                </div>
            </div>
        `).join('');
    } catch (e) {
        // Silently ignore on auto-refresh; show only on manual refresh.
        if (document.getElementById('conn-grid').querySelector('.spinner')) {
            document.getElementById('conn-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p style="color:var(--red);">Failed to load connections.</p></div>`;
        }
    }
}

async function liveAction(playerId, type, value) {
    try {
        const payload = { type };
        if (value !== undefined) payload.value = value;
        const res = await api('POST', `/api/connections/${playerId}/action`, payload);
        if (res && res.ok) toast(`Action '${type}' applied.`, 'success');
        else if (res && res.error) toast(res.error, 'error');
    } catch (e) {
        toast(e.message, 'error');
    }
}

function openKickModal(playerId) {
    const conn = allConns.find(c => c.id === playerId);
    const name = conn ? conn.name : `Player #${playerId}`;
    openModal({
        title: `Kick ${escHtml(name)}`,
        body: `
            <div class="form-row">
                <label>Kick Reason</label>
                <input type="text" id="kick-reason" placeholder="Reason…" value="Kicked by admin." />
            </div>`,
        confirmLabel: '🚪 Kick',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            const reason = document.getElementById('kick-reason').value || 'Kicked by admin.';
            await liveAction(playerId, 'kick');
            await api('POST', `/api/connections/${playerId}/action`, { type: 'kick', reason });
            toast(`Kicked ${name}.`, 'success');
            loadConnections();
        },
    });
}

function openSetLevelModal(playerId) {
    const conn = allConns.find(c => c.id === playerId);
    const name = conn ? conn.name : `Player #${playerId}`;
    openModal({
        title: `Set Admin Level – ${escHtml(name)}`,
        body: `
            <div class="form-row">
                <label>Admin Level</label>
                <select id="level-select">
                    <option value="0">0 – No Access</option>
                    <option value="1">1 – Moderator</option>
                    <option value="2">2 – Admin</option>
                    <option value="3">3 – Super Admin</option>
                </select>
            </div>`,
        onOpen: () => {
            if (conn) document.getElementById('level-select').value = conn.adminLevel;
        },
        confirmLabel: '✔ Apply',
        confirmClass: 'btn-primary',
        onConfirm: async () => {
            const level = parseInt(document.getElementById('level-select').value, 10);
            await api('POST', `/api/connections/${playerId}/action`, { type: 'setAdminLevel', value: level });
            toast(`Admin level set to ${level} for ${name}.`, 'success');
            loadConnections();
        },
    });
}

function openLivePermsModal(playerId) {
    const conn = allConns.find(c => c.id === playerId);
    if (!conn) return;
    const perms = conn.permissions || {};
    const permKeys = Object.keys(perms);
    const labels = {
        canSpawnVehicle: 'Spawn Vehicle',
        canSetWeather:   'Set Weather',
        canKickPlayers:  'Kick Players',
        canBanPlayers:   'Ban Players',
        canTeleport:     'Teleport',
        canGiveWeapons:  'Give Weapons',
        canHealOthers:   'Heal Others',
        canSetTime:      'Set World Time',
        vip:             'VIP Status',
    };

    const rows = permKeys.map(k => `
        <div class="perm-row">
            <span class="perm-label">${labels[k] || k}</span>
            <label class="switch">
                <input type="checkbox" id="perm-${k}" ${perms[k] ? 'checked' : ''} />
                <span class="slider"></span>
            </label>
        </div>
    `).join('');

    openModal({
        title: `Permissions – ${escHtml(conn.name)}`,
        body: `<div class="perm-grid">${rows}</div>`,
        confirmLabel: '💾 Save & Apply',
        confirmClass: 'btn-primary',
        onConfirm: async () => {
            for (const k of permKeys) {
                const checked = document.getElementById(`perm-${k}`).checked;
                await api('POST', `/api/connections/${playerId}/action`, { type: 'setPermission', key: k, value: checked });
            }
            toast(`Permissions updated for ${conn.name}.`, 'success');
            loadConnections();
        },
    });
}

// ── User Management ───────────────────────────────────────────────────────────
async function loadUsers() {
    try {
        const users = await api('GET', '/api/users');
        if (!users) return;
        allUsers = users;
        renderUsers(users);
    } catch (e) {
        toast('Failed to load users: ' + e.message, 'error');
    }
}

function filterUsers() {
    const q       = document.getElementById('user-search').value.toLowerCase();
    const level   = document.getElementById('filter-level').value;
    const banned  = document.getElementById('filter-banned').value;

    const filtered = allUsers.filter(u => {
        const matchQ   = !q || u.name.toLowerCase().includes(q) || u.socialClub.toLowerCase().includes(q);
        const matchLvl = !level || String(u.adminLevel) === level;
        const matchBan = !banned || (banned === 'banned' ? u.banned : !u.banned);
        return matchQ && matchLvl && matchBan;
    });
    renderUsers(filtered);
}

function renderUsers(users) {
    document.getElementById('user-count').textContent = `${users.length} player${users.length !== 1 ? 's' : ''}`;
    const tbody = document.getElementById('user-tbody');
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:32px;">No users found.</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => {
        const permCount = Object.values(u.permissions || {}).filter(Boolean).length;
        return `<tr>
            <td><strong>${escHtml(u.name)}</strong></td>
            <td style="font-size:12px;color:var(--text-muted);">${escHtml(u.socialClub)}</td>
            <td>${levelBadge(u.adminLevel)}</td>
            <td><span class="badge badge-none">${permCount} active</span></td>
            <td>${u.banned ? `<span class="badge badge-banned" title="${escHtml(u.banReason)}">Banned</span>` : '<span class="badge badge-online">Active</span>'}</td>
            <td style="font-size:12px;">${timeAgo(u.lastSeen)}</td>
            <td style="text-align:right; white-space:nowrap;">
                <button class="btn btn-ghost btn-xs" onclick='openEditUserModal(${JSON.stringify(u.socialClub)})'>✏ Edit</button>
                ${u.banned
                    ? `<button class="btn btn-success btn-xs" onclick='unbanUser(${JSON.stringify(u.socialClub)})'>✔ Unban</button>`
                    : `<button class="btn btn-danger  btn-xs" onclick='openBanModal(${JSON.stringify(u.socialClub)})'>🚫 Ban</button>`
                }
            </td>
        </tr>`;
    }).join('');
}

function openEditUserModal(socialClub) {
    const u = allUsers.find(x => x.socialClub === socialClub);
    if (!u) return;
    const perms = u.permissions || {};
    const labels = {
        canSpawnVehicle: 'Spawn Vehicle',
        canSetWeather:   'Set Weather',
        canKickPlayers:  'Kick Players',
        canBanPlayers:   'Ban Players',
        canTeleport:     'Teleport',
        canGiveWeapons:  'Give Weapons',
        canHealOthers:   'Heal Others',
        canSetTime:      'Set World Time',
        vip:             'VIP Status',
    };

    const permRows = Object.keys(perms).map(k => `
        <div class="perm-row">
            <span class="perm-label">${labels[k] || k}</span>
            <label class="switch">
                <input type="checkbox" id="ep-${k}" ${perms[k] ? 'checked' : ''} />
                <span class="slider"></span>
            </label>
        </div>
    `).join('');

    openModal({
        title: `Edit – ${escHtml(u.name)}`,
        body: `
            <div class="form-row">
                <label>Admin Level</label>
                <select id="edit-level">
                    <option value="0">0 – No Access</option>
                    <option value="1">1 – Moderator</option>
                    <option value="2">2 – Admin</option>
                    <option value="3">3 – Super Admin</option>
                </select>
            </div>
            <div class="form-row">
                <label>Notes</label>
                <textarea id="edit-notes" rows="2" style="resize:vertical;">${escHtml(u.notes || '')}</textarea>
            </div>
            <div class="section-title" style="margin-bottom:10px;">In-Game Permissions</div>
            <div class="perm-grid">${permRows}</div>
        `,
        onOpen: () => {
            document.getElementById('edit-level').value = u.adminLevel || 0;
        },
        confirmLabel: '💾 Save',
        confirmClass: 'btn-primary',
        onConfirm: async () => {
            const newLevel = parseInt(document.getElementById('edit-level').value, 10);
            const newNotes = document.getElementById('edit-notes').value;
            const newPerms = {};
            Object.keys(perms).forEach(k => {
                newPerms[k] = document.getElementById(`ep-${k}`).checked;
            });
            await api('PUT', `/api/users/${encodeURIComponent(socialClub)}`, {
                adminLevel:  newLevel,
                notes:       newNotes,
                permissions: newPerms,
            });
            toast(`${u.name} updated.`, 'success');
            loadUsers();
        },
    });
}

function openBanModal(socialClub) {
    const u = allUsers.find(x => x.socialClub === socialClub);
    const name = u ? u.name : socialClub;
    openModal({
        title: `Ban ${escHtml(name)}`,
        body: `
            <div class="form-row">
                <label>Ban Reason</label>
                <input type="text" id="ban-reason" placeholder="Reason…" />
            </div>`,
        confirmLabel: '🚫 Ban',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            const reason = document.getElementById('ban-reason').value || 'Banned by admin.';
            await api('POST', `/api/users/${encodeURIComponent(socialClub)}/ban`, { reason });
            toast(`${name} has been banned.`, 'success');
            loadUsers();
        },
    });
}

async function unbanUser(socialClub) {
    const u = allUsers.find(x => x.socialClub === socialClub);
    const name = u ? u.name : socialClub;
    try {
        await api('POST', `/api/users/${encodeURIComponent(socialClub)}/unban`);
        toast(`${name} has been unbanned.`, 'success');
        loadUsers();
    } catch (e) {
        toast(e.message, 'error');
    }
}

// ── Panel Admins ──────────────────────────────────────────────────────────────
async function loadPanelAdmins() {
    try {
        const admins = await api('GET', '/api/panel-admins');
        if (!admins) return;
        const body = document.getElementById('panel-admins-body');
        if (admins.length === 0) {
            body.innerHTML = '<div class="empty-state"><p>No admins found.</p></div>';
            return;
        }
        body.innerHTML = admins.map(a => `
            <div class="admin-user-row">
                <div class="au-avatar">${a.username.charAt(0).toUpperCase()}</div>
                <div class="au-name">${escHtml(a.username)}</div>
                <button class="btn btn-ghost btn-sm" onclick='openChangePwdModal(${JSON.stringify(a.username)})'>🔑 Change Password</button>
                <button class="btn btn-danger btn-sm" onclick='deleteAdmin(${JSON.stringify(a.username)})'>🗑 Remove</button>
            </div>
        `).join('');
    } catch (e) {
        toast('Failed to load panel admins: ' + e.message, 'error');
    }
}

function openAddAdminModal() {
    openModal({
        title: 'Add Panel Admin',
        body: `
            <div class="form-row">
                <label>Username</label>
                <input type="text" id="new-admin-user" placeholder="Username" />
            </div>
            <div class="form-row">
                <label>Password</label>
                <input type="password" id="new-admin-pass" placeholder="Password" />
            </div>`,
        confirmLabel: '＋ Add Admin',
        confirmClass: 'btn-primary',
        onConfirm: async () => {
            const username = document.getElementById('new-admin-user').value.trim();
            const password = document.getElementById('new-admin-pass').value;
            if (!username || !password) throw new Error('Username and password are required.');
            await api('POST', '/api/panel-admins', { username, password });
            toast(`Admin '${username}' created.`, 'success');
            loadPanelAdmins();
        },
    });
}

function openChangePwdModal(username) {
    openModal({
        title: `Change Password – ${escHtml(username)}`,
        body: `
            <div class="form-row">
                <label>New Password</label>
                <input type="password" id="new-pwd" placeholder="New password" />
            </div>`,
        confirmLabel: '💾 Save',
        confirmClass: 'btn-primary',
        onConfirm: async () => {
            const password = document.getElementById('new-pwd').value;
            if (!password) throw new Error('Password cannot be empty.');
            await api('PUT', `/api/panel-admins/${encodeURIComponent(username)}/password`, { password });
            toast('Password updated.', 'success');
        },
    });
}

async function deleteAdmin(username) {
    if (!confirm(`Remove admin '${username}'? This cannot be undone.`)) return;
    try {
        await api('DELETE', `/api/panel-admins/${encodeURIComponent(username)}`);
        toast(`Admin '${username}' removed.`, 'success');
        loadPanelAdmins();
    } catch (e) {
        toast(e.message, 'error');
    }
}

// ── Generic Modal Helper ──────────────────────────────────────────────────────
function openModal({ title, body, confirmLabel = 'Confirm', confirmClass = 'btn-primary', onConfirm, onOpen }) {
    const container = document.getElementById('modal-container');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    backdrop.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-header">
                <span class="modal-title">${title}</span>
                <button class="modal-close" aria-label="Close">✕</button>
            </div>
            <div class="modal-body">${body}</div>
            <div class="modal-footer">
                <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
                <button class="btn ${confirmClass}" id="modal-confirm">${confirmLabel}</button>
            </div>
        </div>
    `;

    container.appendChild(backdrop);

    const closeModal = () => backdrop.remove();

    backdrop.querySelector('.modal-close').addEventListener('click', closeModal);
    backdrop.querySelector('#modal-cancel').addEventListener('click', closeModal);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });

    backdrop.querySelector('#modal-confirm').addEventListener('click', async () => {
        const btn = backdrop.querySelector('#modal-confirm');
        btn.disabled = true;
        try {
            await onConfirm();
            closeModal();
        } catch (e) {
            toast(e.message, 'error');
            btn.disabled = false;
        }
    });

    if (onOpen) onOpen();

    // Focus first input
    const firstInput = backdrop.querySelector('input, select, textarea');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
    // Verify session
    try {
        const me = await api('GET', '/api/me');
        if (!me) return;
        const initial = me.username.charAt(0).toUpperCase();
        document.getElementById('sidebar-avatar').textContent   = initial;
        document.getElementById('sidebar-username').textContent = me.username;
    } catch {
        window.location.href = '/';
        return;
    }

    switchView('dashboard');
})();
