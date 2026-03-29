'use strict';

/**
 * WebPanel Package – Admin Control Panel
 *
 * Starts an HTTP server on WEB_PORT (default 8080) that provides:
 *  • A login page (HTML) with session-cookie authentication.
 *  • A dashboard with User Management and Active Connections tabs.
 *  • A REST API consumed by the dashboard's JavaScript.
 *
 * Data is persisted in packages/webpanel/data/:
 *  • admins.json  – web-panel login accounts (hashed passwords)
 *  • users.json   – per-player records (admin level, permissions, ban status)
 *
 * The package also registers RAGE:MP playerJoin / playerQuit events so it can
 * track who is currently online and apply live permission changes.
 */

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────
const WEB_PORT             = 8080;
const SESSION_DURATION_MS  = 24 * 60 * 60 * 1000; // 24 hours
const MAX_BODY_BYTES       = 1_048_576;            // 1 MB
const MAX_CONSOLE_LOGS     = 200;
const DATA_DIR      = path.join(__dirname, 'data');
const PUBLIC_DIR    = path.join(__dirname, 'public');
const ADMINS_FILE   = path.join(DATA_DIR, 'admins.json');
const USERS_FILE    = path.join(DATA_DIR, 'users.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');

// Ensure data directory exists on first run.
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Permission Defaults ───────────────────────────────────────────────────────
function defaultPermissions() {
    return {
        canSpawnVehicle:  false,
        canSetWeather:    false,
        canKickPlayers:   false,
        canBanPlayers:    false,
        canTeleport:      false,
        canGiveWeapons:   false,
        canHealOthers:    false,
        canSetTime:       false,
        vip:              false,
    };
}

// ── Panel Admin Accounts ──────────────────────────────────────────────────────
function loadAdmins() {
    if (!fs.existsSync(ADMINS_FILE)) {
        const def = [{
            username:     'admin',
            passwordHash: hashPassword('admin123'),
        }];
        fs.writeFileSync(ADMINS_FILE, JSON.stringify(def, null, 2));
        console.log('[WebPanel] Default admin created – username: admin  password: admin123  ← CHANGE THIS!');
    }
    return JSON.parse(fs.readFileSync(ADMINS_FILE, 'utf8'));
}

function saveAdmins(admins) {
    fs.writeFileSync(ADMINS_FILE, JSON.stringify(admins, null, 2));
}

// ── Game Player Records ───────────────────────────────────────────────────────
function loadUsers() {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({}, null, 2));
    }
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveUsers(users) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ── Player UCP Accounts ───────────────────────────────────────────────────────
// accounts.json stores player UCP credentials, keyed by username.
// Fields: username, passwordHash, socialClub (null until linked in-game), createdAt, lastLogin
function loadAccounts() {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({}, null, 2));
    }
    try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8')); } catch { return {}; }
}

function saveAccounts(accounts) {
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

// ── Console Log Buffer ────────────────────────────────────────────────────────
// Keeps the last MAX_CONSOLE_LOGS server-side log entries for the UCP console.
const consoleLogs = [];

function logConsole(type, message) {
    consoleLogs.push({ type, message, timestamp: new Date().toISOString() });
    if (consoleLogs.length > MAX_CONSOLE_LOGS) consoleLogs.shift();
    console.log(`[Console:${type}] ${message}`);
}

// ── UCP Sessions (player accounts, separate from panel-admin sessions) ────────
const ucpSessions = new Map(); // token → { username, expires }

function createUcpSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    ucpSessions.set(token, { username, expires: Date.now() + SESSION_DURATION_MS });
    return token;
}

function getUcpSession(token) {
    if (!token) return null;
    const s = ucpSessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expires) { ucpSessions.delete(token); return null; }
    return s;
}

function deleteUcpSession(token) { ucpSessions.delete(token); }

/** Verifies UCP player session; returns session or null (with 401/redirect). */
function requireUcpAuth(req, res) {
    const cookies = parseCookies(req);
    const session = getUcpSession(cookies.ucpSession);
    if (!session) {
        if (req.url.startsWith('/api/ucp')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
        } else {
            res.writeHead(302, { Location: '/ucp' });
            res.end();
        }
        return null;
    }
    return session;
}

/** Create or update the persisted record for a player on join. */
function ensureUser(player) {
    const users = loadUsers();
    if (!users[player.socialClub]) {
        users[player.socialClub] = {
            socialClub:  player.socialClub,
            name:        player.name,
            adminLevel:  0,
            permissions: defaultPermissions(),
            notes:       '',
            banned:      false,
            banReason:   '',
            firstSeen:   new Date().toISOString(),
            lastSeen:    new Date().toISOString(),
        };
    } else {
        users[player.socialClub].name     = player.name;
        users[player.socialClub].lastSeen = new Date().toISOString();
    }
    saveUsers(users);
    return users[player.socialClub];
}

// ── Session Store ─────────────────────────────────────────────────────────────
const sessions = new Map(); // token → { username, expires }

function createSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, expires: Date.now() + SESSION_DURATION_MS });
    return token;
}

function getSession(token) {
    if (!token) return null;
    const s = sessions.get(token);
    if (!s) return null;
    if (Date.now() > s.expires) { sessions.delete(token); return null; }
    return s;
}

function deleteSession(token) { sessions.delete(token); }

// ── Password Hashing (scrypt via Node built-in crypto) ────────────────────────
// Stored format: "scrypt:<hex-salt>:<hex-hash>"
// This is a one-way KDF with a random salt – resistant to brute-force and
// rainbow-table attacks without requiring any external npm packages.

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 };

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
        N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
    }).toString('hex');
    return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    // Legacy SHA-256 format (plain 64-char hex) – upgrade on next save.
    if (!stored.startsWith('scrypt:')) {
        return crypto.createHash('sha256').update(password).digest('hex') === stored;
    }
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const [, salt, expectedHash] = parts;
    try {
        const actualHash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
            N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
        }).toString('hex');
        // Constant-time comparison to prevent timing attacks.
        return crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));
    } catch {
        return false;
    }
}

function parseCookies(req) {
    return (req.headers.cookie || '').split(';').reduce((acc, pair) => {
        const idx = pair.indexOf('=');
        if (idx > 0) {
            acc[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
        }
        return acc;
    }, {});
}

function parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
            if (body.length > MAX_BODY_BYTES) { req.destroy(); resolve(null); }
        });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { resolve(null); }
        });
        req.on('error', () => resolve(null));
    });
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
};

function serveFile(res, filePath) {
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

function jsonOk(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function jsonErr(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
}

/** Verifies session; if missing returns a 401/redirect and returns null. */
function requireAuth(req, res) {
    const cookies = parseCookies(req);
    const session = getSession(cookies.session);
    if (!session) {
        if (req.url.startsWith('/api/')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
        } else {
            res.writeHead(302, { Location: '/' });
            res.end();
        }
        return null;
    }
    return session;
}

// ── Online Player Tracking ────────────────────────────────────────────────────
// Map: playerId (number) → RAGE:MP player object
const onlinePlayers = new Map();

function getActiveConnections() {
    const users = loadUsers();
    return Array.from(onlinePlayers.entries()).map(([id, player]) => {
        const u = users[player.socialClub] || {};
        return {
            id,
            name:        player.name,
            socialClub:  player.socialClub,
            adminLevel:  u.adminLevel   || 0,
            permissions: u.permissions  || defaultPermissions(),
            banned:      u.banned       || false,
            ping:        player.ping    || 0,
        };
    });
}

/** Push updated permissions/admin-level to a live player. */
function applyToLivePlayer(socialClub, userData) {
    onlinePlayers.forEach(player => {
        if (player.socialClub !== socialClub) return;
        player.setVariable('adminLevel',   userData.adminLevel  || 0);
        player.setVariable('permissions',  JSON.stringify(userData.permissions || {}));
    });
}

/** Kick all live sessions of a player (e.g. after ban). */
function kickLivePlayer(socialClub, reason) {
    onlinePlayers.forEach(player => {
        if (player.socialClub === socialClub) player.kick(reason || 'Banned.');
    });
}

/** Perform a live in-game action on a specific player ID. */
function performLiveAction(playerId, action) {
    const player = onlinePlayers.get(playerId);
    if (!player) return { error: 'Player not found or offline.' };

    switch (action.type) {
        case 'setAdminLevel': {
            const level = Math.max(0, Math.min(3, parseInt(action.value, 10)));
            player.setVariable('adminLevel', level);
            const users = loadUsers();
            if (users[player.socialClub]) {
                users[player.socialClub].adminLevel = level;
                saveUsers(users);
            }
            return { ok: true, adminLevel: level };
        }
        case 'setPermission': {
            const users = loadUsers();
            const u = users[player.socialClub];
            if (!u) return { error: 'No user record found.' };
            if (!(action.key in u.permissions)) return { error: 'Unknown permission key.' };
            u.permissions[action.key] = !!action.value;
            saveUsers(users);
            applyToLivePlayer(player.socialClub, u);
            return { ok: true };
        }
        case 'kick':
            player.kick(action.reason || 'Kicked by admin panel.');
            return { ok: true };
        case 'heal':
            player.health = 100;
            player.armour = 100;
            return { ok: true };
        case 'kill':
            player.health = 0;
            return { ok: true };
        case 'freeze':
            player.freeze(!!action.value);
            return { ok: true };
        case 'teleportToSpawn':
            player.position = new mp.Vector3(0, 0, 72);
            return { ok: true };
        default:
            return { error: 'Unknown action type.' };
    }
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    // Use the WHATWG URL API to avoid url.parse deprecation.
    let parsed;
    try {
        parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
        res.writeHead(400); res.end('Bad Request'); return;
    }
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const method   = req.method.toUpperCase();

    // ── Static / HTML pages ───────────────────────────────────────────────────

    if ((pathname === '/' || pathname === '/index.html') && method === 'GET') {
        return serveFile(res, path.join(PUBLIC_DIR, 'index.html'));
    }

    if (pathname === '/register' && method === 'GET') {
        return serveFile(res, path.join(PUBLIC_DIR, 'register.html'));
    }

    if (pathname === '/ucp' && method === 'GET') {
        return serveFile(res, path.join(PUBLIC_DIR, 'ucp.html'));
    }

    if (pathname === '/ucp/home' && method === 'GET') {
        if (!requireUcpAuth(req, res)) return;
        return serveFile(res, path.join(PUBLIC_DIR, 'ucp.html'));
    }

    if (pathname === '/dashboard' && method === 'GET') {
        if (!requireAuth(req, res)) return;
        return serveFile(res, path.join(PUBLIC_DIR, 'dashboard.html'));
    }

    if (pathname.startsWith('/assets/') && method === 'GET') {
        const filePath = path.resolve(PUBLIC_DIR, pathname.slice(1)); // strip leading /
        // Prevent path traversal: resolved path must stay within PUBLIC_DIR.
        if (!filePath.startsWith(path.resolve(PUBLIC_DIR) + path.sep)) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        return serveFile(res, filePath);
    }

    // ── API ───────────────────────────────────────────────────────────────────

    // POST /api/login
    if (pathname === '/api/login' && method === 'POST') {
        const body = await parseBody(req);
        if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
            return jsonErr(res, 400, 'username and password are required.');
        }
        const admins = loadAdmins();
        const match  = admins.find(a => a.username === body.username && verifyPassword(body.password, a.passwordHash));
        if (!match) return jsonErr(res, 401, 'Invalid username or password.');
        const token = createSession(body.username);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end(JSON.stringify({ ok: true, username: match.username }));
        return;
    }

    // POST /api/logout
    if (pathname === '/api/logout' && method === 'POST') {
        const cookies = parseCookies(req);
        deleteSession(cookies.session);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'session=; Max-Age=0; Path=/',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // GET /api/me
    if (pathname === '/api/me' && method === 'GET') {
        const session = requireAuth(req, res);
        if (!session) return;
        return jsonOk(res, { username: session.username });
    }

    // GET /api/users
    if (pathname === '/api/users' && method === 'GET') {
        if (!requireAuth(req, res)) return;
        const users    = loadUsers();
        const accounts = loadAccounts();

        // Start with all game-joined players
        const result = Object.values(users);
        const linkedSocialClubs = new Set(Object.keys(users));

        // Also include UCP accounts that have never joined the game or whose
        // Social Club is not yet recorded in users.json
        Object.values(accounts).forEach(acc => {
            if (acc.socialClub && linkedSocialClubs.has(acc.socialClub)) return;
            result.push({
                socialClub:  acc.socialClub || null,
                name:        acc.username,
                adminLevel:  0,
                permissions: defaultPermissions(),
                notes:       '',
                banned:      false,
                banReason:   '',
                firstSeen:   acc.createdAt,
                lastSeen:    acc.lastLogin || acc.createdAt,
                ucpUsername: acc.username,
                ucpOnly:     !acc.socialClub,
            });
        });

        return jsonOk(res, result);
    }

    // PUT /api/users/:socialClub
    const userEdit = pathname.match(/^\/api\/users\/([^/]+)$/);
    if (userEdit && method === 'PUT') {
        if (!requireAuth(req, res)) return;
        const socialClub = decodeURIComponent(userEdit[1]);
        const body = await parseBody(req);
        if (!body) return jsonErr(res, 400, 'Invalid JSON.');
        const users = loadUsers();
        if (!users[socialClub]) return jsonErr(res, 404, 'User not found.');
        const allowed = ['adminLevel', 'permissions', 'notes', 'banned', 'banReason'];
        allowed.forEach(k => { if (k in body) users[socialClub][k] = body[k]; });
        saveUsers(users);
        applyToLivePlayer(socialClub, users[socialClub]);
        return jsonOk(res, users[socialClub]);
    }

    // POST /api/users/:socialClub/ban
    const banRoute = pathname.match(/^\/api\/users\/([^/]+)\/ban$/);
    if (banRoute && method === 'POST') {
        if (!requireAuth(req, res)) return;
        const socialClub = decodeURIComponent(banRoute[1]);
        const body = await parseBody(req) || {};
        const users = loadUsers();
        if (!users[socialClub]) return jsonErr(res, 404, 'User not found.');
        users[socialClub].banned    = true;
        users[socialClub].banReason = body.reason || 'Banned by admin panel.';
        saveUsers(users);
        kickLivePlayer(socialClub, users[socialClub].banReason);
        return jsonOk(res, users[socialClub]);
    }

    // POST /api/users/:socialClub/unban
    const unbanRoute = pathname.match(/^\/api\/users\/([^/]+)\/unban$/);
    if (unbanRoute && method === 'POST') {
        if (!requireAuth(req, res)) return;
        const socialClub = decodeURIComponent(unbanRoute[1]);
        const users = loadUsers();
        if (!users[socialClub]) return jsonErr(res, 404, 'User not found.');
        users[socialClub].banned    = false;
        users[socialClub].banReason = '';
        saveUsers(users);
        return jsonOk(res, users[socialClub]);
    }

    // GET /api/connections
    if (pathname === '/api/connections' && method === 'GET') {
        if (!requireAuth(req, res)) return;
        return jsonOk(res, getActiveConnections());
    }

    // POST /api/connections/:id/action
    const connAction = pathname.match(/^\/api\/connections\/(\d+)\/action$/);
    if (connAction && method === 'POST') {
        if (!requireAuth(req, res)) return;
        const pid  = parseInt(connAction[1], 10);
        const body = await parseBody(req);
        if (!body) return jsonErr(res, 400, 'Invalid JSON.');
        return jsonOk(res, performLiveAction(pid, body));
    }

    // GET /api/panel-admins
    if (pathname === '/api/panel-admins' && method === 'GET') {
        if (!requireAuth(req, res)) return;
        const admins = loadAdmins().map(a => ({ username: a.username }));
        return jsonOk(res, admins);
    }

    // POST /api/panel-admins  – create
    if (pathname === '/api/panel-admins' && method === 'POST') {
        if (!requireAuth(req, res)) return;
        const body = await parseBody(req);
        if (!body || !body.username || !body.password) return jsonErr(res, 400, 'username and password required.');
        const admins = loadAdmins();
        if (admins.find(a => a.username === body.username)) return jsonErr(res, 409, 'Username already exists.');
        admins.push({ username: body.username, passwordHash: hashPassword(body.password) });
        saveAdmins(admins);
        return jsonOk(res, { ok: true });
    }

    // DELETE /api/panel-admins/:username
    const delAdmin = pathname.match(/^\/api\/panel-admins\/([^/]+)$/);
    if (delAdmin && method === 'DELETE') {
        const session = requireAuth(req, res);
        if (!session) return;
        const target = decodeURIComponent(delAdmin[1]);
        if (target === session.username) return jsonErr(res, 400, 'Cannot delete your own account.');
        let admins = loadAdmins();
        if (!admins.find(a => a.username === target)) return jsonErr(res, 404, 'Admin not found.');
        admins = admins.filter(a => a.username !== target);
        if (admins.length === 0) return jsonErr(res, 400, 'Cannot remove the last admin account.');
        saveAdmins(admins);
        return jsonOk(res, { ok: true });
    }

    // PUT /api/panel-admins/:username/password
    const chgPwd = pathname.match(/^\/api\/panel-admins\/([^/]+)\/password$/);
    if (chgPwd && method === 'PUT') {
        if (!requireAuth(req, res)) return;
        const target = decodeURIComponent(chgPwd[1]);
        const body   = await parseBody(req);
        if (!body || !body.password) return jsonErr(res, 400, 'password required.');
        const admins = loadAdmins();
        const admin  = admins.find(a => a.username === target);
        if (!admin) return jsonErr(res, 404, 'Admin not found.');
        admin.passwordHash = hashPassword(body.password);
        saveAdmins(admins);
        return jsonOk(res, { ok: true });
    }

    // ── UCP (Player Account) API ──────────────────────────────────────────────

    // POST /api/ucp-register  – create a player UCP account
    if (pathname === '/api/ucp-register' && method === 'POST') {
        const body = await parseBody(req);
        if (!body || !body.username || !body.password) {
            return jsonErr(res, 400, 'username and password are required.');
        }
        const username = String(body.username).trim().toLowerCase();
        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            return jsonErr(res, 400, 'Username must be 3–20 characters (letters, numbers, underscore).');
        }
        if (String(body.password).length < 6) {
            return jsonErr(res, 400, 'Password must be at least 6 characters.');
        }
        const accounts = loadAccounts();
        if (accounts[username]) return jsonErr(res, 409, 'Username already taken.');
        accounts[username] = {
            username,
            passwordHash: hashPassword(body.password),
            socialClub:   null,
            createdAt:    new Date().toISOString(),
            lastLogin:    null,
        };
        saveAccounts(accounts);
        logConsole('REGISTER', `New UCP account registered: ${username}`);
        return jsonOk(res, { ok: true });
    }

    // GET /api/ucp-stats  – aggregate stats for the player UCP dashboard
    if (pathname === '/api/ucp-stats' && method === 'GET') {
        const accounts = loadAccounts();
        const users    = loadUsers();
        const totalRegistered = Object.keys(accounts).length;
        const totalGameUsers  = Object.keys(users).length;
        const onlineCount     = onlinePlayers.size;
        return jsonOk(res, {
            registeredUsers: totalRegistered,
            gameUsers:       totalGameUsers,
            onlinePlayers:   onlineCount,
        });
    }

    // POST /api/ucp-login  – log in to the player UCP
    if (pathname === '/api/ucp-login' && method === 'POST') {
        const body = await parseBody(req);
        if (!body || !body.username || !body.password) {
            return jsonErr(res, 400, 'username and password are required.');
        }
        const username = String(body.username).trim().toLowerCase();
        const accounts = loadAccounts();
        const account  = accounts[username];
        if (!account || !verifyPassword(body.password, account.passwordHash)) {
            return jsonErr(res, 401, 'Invalid username or password.');
        }
        account.lastLogin = new Date().toISOString();
        saveAccounts(accounts);
        const token = createUcpSession(username);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': `ucpSession=${token}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end(JSON.stringify({ ok: true, username }));
        return;
    }

    // POST /api/ucp-logout
    if (pathname === '/api/ucp-logout' && method === 'POST') {
        const cookies = parseCookies(req);
        deleteUcpSession(cookies.ucpSession);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Set-Cookie': 'ucpSession=; Max-Age=0; Path=/',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // GET /api/ucp-me  – get logged-in player account info
    if (pathname === '/api/ucp-me' && method === 'GET') {
        const session = requireUcpAuth(req, res);
        if (!session) return;
        const accounts = loadAccounts();
        const account  = accounts[session.username];
        if (!account) return jsonErr(res, 404, 'Account not found.');
        // Enrich with game data if Social Club is linked
        let gameData = null;
        if (account.socialClub) {
            const users = loadUsers();
            gameData = users[account.socialClub] || null;
        }
        return jsonOk(res, {
            username:   account.username,
            socialClub: account.socialClub,
            createdAt:  account.createdAt,
            lastLogin:  account.lastLogin,
            adminLevel: gameData ? (gameData.adminLevel || 0) : 0,
            permissions: gameData ? (gameData.permissions || {}) : {},
        });
    }

    // GET /api/ucp-password  – change password (UCP user)
    if (pathname === '/api/ucp-password' && method === 'PUT') {
        const session = requireUcpAuth(req, res);
        if (!session) return;
        const body = await parseBody(req);
        if (!body || !body.currentPassword || !body.newPassword) {
            return jsonErr(res, 400, 'currentPassword and newPassword are required.');
        }
        if (String(body.newPassword).length < 6) {
            return jsonErr(res, 400, 'New password must be at least 6 characters.');
        }
        const accounts = loadAccounts();
        const account  = accounts[session.username];
        if (!account) return jsonErr(res, 404, 'Account not found.');
        if (!verifyPassword(body.currentPassword, account.passwordHash)) {
            return jsonErr(res, 401, 'Current password is incorrect.');
        }
        account.passwordHash = hashPassword(body.newPassword);
        saveAccounts(accounts);
        return jsonOk(res, { ok: true });
    }

    // ── Console API (requires panel-admin auth) ───────────────────────────────

    // GET /api/console  – get recent console log entries
    if (pathname === '/api/console' && method === 'GET') {
        if (!requireAuth(req, res)) return;
        const since = parsed.searchParams.get('since');
        const logs = since
            ? consoleLogs.filter(e => e.timestamp > since)
            : consoleLogs.slice(-100);
        return jsonOk(res, logs);
    }

    // POST /api/console/send  – execute a server command via the UCP console
    if (pathname === '/api/console/send' && method === 'POST') {
        if (!requireAuth(req, res)) return;
        const body = await parseBody(req);
        if (!body || typeof body.command !== 'string') return jsonErr(res, 400, 'command required.');
        const cmd = body.command.trim();
        if (!cmd) return jsonErr(res, 400, 'command cannot be empty.');
        // Fire a server-side event that admin package listens to
        logConsole('UCP_CMD', `[UCP Command] ${cmd}`);
        mp.events.call('webpanel:consoleCommand', cmd);
        return jsonOk(res, { ok: true });
    }

    // POST /api/ingame-auth  – verify in-game login (called by internal flow)
    if (pathname === '/api/ingame-auth' && method === 'POST') {
        const body = await parseBody(req);
        if (!body || !body.username || !body.password || !body.socialClub) {
            return jsonErr(res, 400, 'username, password and socialClub are required.');
        }
        const username   = String(body.username).trim().toLowerCase();
        const socialClub = String(body.socialClub);
        const accounts   = loadAccounts();
        const account    = accounts[username];
        if (!account || !verifyPassword(body.password, account.passwordHash)) {
            return jsonOk(res, { ok: false, reason: 'Invalid username or password.' });
        }
        // Link Social Club to account if not yet linked (or update if they re-registered)
        if (!account.socialClub) {
            account.socialClub = socialClub;
        } else if (account.socialClub !== socialClub) {
            return jsonOk(res, { ok: false, reason: 'This account is linked to a different Social Club.' });
        }
        account.lastLogin = new Date().toISOString();
        saveAccounts(accounts);
        // Load the game permissions for this player
        const users = loadUsers();
        const userData = users[socialClub] || null;
        logConsole('AUTH', `Player logged in: ${username} (${socialClub})`);
        return jsonOk(res, {
            ok:          true,
            username,
            adminLevel:  userData ? (userData.adminLevel  || 0) : 0,
            permissions: userData ? (userData.permissions || {}) : {},
        });
    }

    // Fallback 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(WEB_PORT, '0.0.0.0', () => {
    console.log(`[WebPanel] Admin Control Panel → http://localhost:${WEB_PORT}`);
    console.log(`[WebPanel] Login with admin / admin123 (change in packages/webpanel/data/admins.json)`);
});

server.on('error', (err) => {
    console.error('[WebPanel] HTTP server error:', err.message);
});

// ── RAGE:MP Events ────────────────────────────────────────────────────────────

mp.events.add('playerJoin', (player) => {
    const userData = ensureUser(player);
    onlinePlayers.set(player.id, player);

    // Apply stored admin level so in-game permission checks work immediately.
    player.setVariable('adminLevel',  userData.adminLevel  || 0);
    player.setVariable('permissions', JSON.stringify(userData.permissions || defaultPermissions()));

    if (userData.banned) {
        player.kick(userData.banReason || 'You are banned from this server.');
    }
    logConsole('JOIN', `${player.name} (${player.socialClub}) joined the server.`);
});

mp.events.add('playerQuit', (player, exitType) => {
    onlinePlayers.delete(player.id);
    const users = loadUsers();
    if (users[player.socialClub]) {
        users[player.socialClub].lastSeen = new Date().toISOString();
        saveUsers(users);
    }
    logConsole('QUIT', `${player.name} (${player.socialClub}) left the server. (${exitType})`);
});

// Console command sent from UCP
mp.events.add('webpanel:consoleCommand', (cmd) => {
    // Broadcast as an admin command chat message if it starts with a known command.
    logConsole('UCP_CMD', `Executing UCP command: ${cmd}`);
    // Simple command dispatcher – extend as needed.
    const parts = cmd.trim().split(/\s+/);
    const name  = parts[0].toLowerCase().replace(/^\//, '');
    if (name === 'say' && parts.length > 1) {
        const msg = parts.slice(1).join(' ');
        mp.players.broadcast(`!{#ff6600}[SERVER] !{#ffffff}${msg}`);
        logConsole('SAY', `[SERVER] ${msg}`);
    } else if (name === 'kick' && parts.length >= 2) {
        const target = mp.players.at(parseInt(parts[1], 10));
        if (target) {
            const reason = parts.slice(2).join(' ') || 'Kicked via UCP console.';
            target.kick(reason);
            logConsole('KICK', `Kicked ${target.name}: ${reason}`);
        }
    } else {
        logConsole('UCP_CMD', `Unknown UCP command: ${cmd}`);
    }
});
