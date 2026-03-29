'use strict';

const fs   = require('fs');
const path = require('path');

// ─── Users.json Integration ───────────────────────────────────────────────────
const USERS_FILE    = path.join(__dirname, '..', 'webpanel', 'data', 'users.json');
const ACCOUNTS_FILE = path.join(__dirname, '..', 'webpanel', 'data', 'accounts.json');

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
    } catch { /* ignore parse errors */ }
    return {};
}

function loadAccounts() {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        }
    } catch { /* ignore parse errors */ }
    return {};
}

function saveAccounts(accounts) {
    try {
        fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    } catch { /* ignore */ }
}

// ─── Admin Level Configuration ────────────────────────────────────────────────
// Set a player's admin level in-game via the setadmin command or by adding
// their Social Club name to HARDCODED_ADMINS below.
const HARDCODED_ADMINS = [
    // 'YourSocialClubName',
];

const ADMIN_LEVEL = {
    NONE: 0,
    MOD: 1,
    ADMIN: 2,
    SUPERADMIN: 3,
};

// In-memory admin level storage (resets on server restart).
// For persistence, replace with a database read/write.
const playerAdminLevels = new Map();

// Holds the active restart countdown interval so a second /restartserver call
// cannot start a parallel countdown.
let restartCountdownTick = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getAdminLevel(player) {
    if (HARDCODED_ADMINS.includes(player.socialClub)) {
        return ADMIN_LEVEL.SUPERADMIN;
    }
    // Check the in-memory override first (set via /setadmin command this session).
    if (playerAdminLevels.has(player.id)) {
        return playerAdminLevels.get(player.id);
    }
    // Fall back to persisted level from the web panel users.json.
    const users = loadUsers();
    const record = users[player.socialClub];
    if (record && typeof record.adminLevel === 'number') {
        return record.adminLevel;
    }
    return ADMIN_LEVEL.NONE;
}

function isAdmin(player, minLevel = ADMIN_LEVEL.MOD) {
    return getAdminLevel(player) >= minLevel;
}

function notifyAdmin(player, message) {
    player.outputChatBox(`!{#ff6600}[ADMIN] !{#ffffff}${message}`);
}

function notifyError(player, message) {
    player.outputChatBox(`!{#ff0000}[ERROR] !{#ffffff}${message}`);
}

function broadcastAdminAction(player, action) {
    mp.players.broadcast(`!{#ff6600}[ADMIN] !{#aaaaaa}${player.name} ${action}`);
}

/** Coerce a boolean-like value (true, false, "true", "false") to a boolean. */
function toBoolean(value) {
    return value === true || value === 'true';
}

// ─── In-Game Authentication ───────────────────────────────────────────────────
// Tracks which players have successfully authenticated this session.
// Players are identified by their in-game ID (resets on disconnect).
const authenticatedPlayers = new Set(); // player.id values
const loginAttempts        = new Map(); // player.id → failed attempt count
const MAX_LOGIN_ATTEMPTS   = 5;

/** Returns true if the player has authenticated (logged in) this session. */
function isAuthenticated(player) {
    return authenticatedPlayers.has(player.id);
}

/**
 * Verify UCP credentials and link Social Club to account on success.
 * Returns { ok, reason, adminLevel, permissions } synchronously.
 */
function verifyIngameLogin(username, password, socialClub) {
    const accounts = loadAccounts();
    const account  = accounts[username.trim().toLowerCase()];
    if (!account) return { ok: false, reason: 'Account not found. Register at the UCP first.' };

    // Simple scrypt-based verification (same logic as webpanel)
    const crypto = require('crypto');
    const stored = account.passwordHash;
    if (!stored || !stored.startsWith('scrypt:')) return { ok: false, reason: 'Invalid account data.' };
    const parts = stored.split(':');
    if (parts.length !== 3) return { ok: false, reason: 'Invalid account data.' };
    const [, salt, expectedHash] = parts;
    try {
        const actualHash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
        if (!crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
            return { ok: false, reason: 'Wrong password.' };
        }
    } catch {
        return { ok: false, reason: 'Login error. Please try again.' };
    }

    // Credentials are valid – link Social Club if not yet linked
    if (!account.socialClub) {
        account.socialClub = socialClub;
    } else if (account.socialClub !== socialClub) {
        return { ok: false, reason: 'This UCP account is linked to a different GTA account.' };
    }
    account.lastLogin = new Date().toISOString();
    saveAccounts(accounts);

    // Load game-level permissions from users.json
    const users    = loadUsers();
    const userData = users[socialClub] || {};
    return {
        ok:          true,
        adminLevel:  userData.adminLevel  || 0,
        permissions: userData.permissions || {},
    };
}

// ─── Server Events ────────────────────────────────────────────────────────────
mp.events.add('playerJoin', (player) => {
    player.setVariable('adminLevel', getAdminLevel(player));
});

mp.events.add('playerQuit', (player) => {
    authenticatedPlayers.delete(player.id);
    loginAttempts.delete(player.id);
});

// ─── In-game Login Event (called from client via callRemote) ──────────────────
mp.events.add('auth:login', (player, username, password) => {
    const attempts = (loginAttempts.get(player.id) || 0);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
        player.kick('Too many failed login attempts.');
        return;
    }
    const result = verifyIngameLogin(String(username), String(password), player.socialClub);
    if (result.ok) {
        authenticatedPlayers.add(player.id);
        loginAttempts.delete(player.id);
        // Apply permissions
        player.setVariable('adminLevel',  result.adminLevel);
        player.setVariable('permissions', JSON.stringify(result.permissions));
        player.call('auth:loginResult', [true, '']);
        notifyAdmin(player, `Welcome back! Admin level: ${result.adminLevel}.`);
        mp.events.call('console:log', 'AUTH', `${player.name} logged in as ${username}.`);
    } else {
        loginAttempts.set(player.id, attempts + 1);
        const remaining = MAX_LOGIN_ATTEMPTS - (attempts + 1);
        player.call('auth:loginResult', [false, result.reason + (remaining > 0 ? ` (${remaining} attempts left)` : '')]);
        if (remaining <= 0) {
            setTimeout(() => player.kick('Too many failed login attempts.'), 1500);
        }
    }
});

// ─── Client → Server Admin Actions ───────────────────────────────────────────

/** Teleport the requesting player to their waypoint (coords sent from client). */
mp.events.add('admin:teleportToWaypoint', (player, x, y, z) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.position = new mp.Vector3(parseFloat(x), parseFloat(y), parseFloat(z));
    notifyAdmin(player, `Teleported to waypoint (${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}).`);
});

/** Spawn a vehicle at the requesting player's position. */
mp.events.add('admin:spawnVehicle', (player, modelName) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const pos = player.position;
    const heading = player.heading;
    try {
        const vehicle = mp.vehicles.new(mp.joaat(modelName), pos, {
            heading,
            numberPlate: 'ADMIN',
            color: [[255, 255, 255], [255, 255, 255]],
            locked: false,
            engine: false,
        });
        player.putIntoVehicle(vehicle, 0);
        notifyAdmin(player, `Spawned vehicle: ${modelName}.`);
        broadcastAdminAction(player, `spawned a ${modelName}.`);
    } catch (e) {
        notifyError(player, `Could not spawn vehicle "${modelName}". Check the model name.`);
    }
});

/** Fix (repair) the vehicle the player is currently in. */
mp.events.add('admin:fixVehicle', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const vehicle = player.vehicle;
    if (!vehicle) return notifyError(player, 'You are not in a vehicle.');
    vehicle.repair();
    notifyAdmin(player, 'Vehicle repaired.');
});

/** Delete the vehicle the player is currently in or closest vehicle. */
mp.events.add('admin:deleteVehicle', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const vehicle = player.vehicle;
    if (!vehicle) return notifyError(player, 'You are not in a vehicle.');
    vehicle.destroy();
    notifyAdmin(player, 'Vehicle deleted.');
    broadcastAdminAction(player, 'deleted a vehicle.');
});

/** Flip the vehicle the player is currently in. */
mp.events.add('admin:flipVehicle', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const vehicle = player.vehicle;
    if (!vehicle) return notifyError(player, 'You are not in a vehicle.');
    vehicle.rotation = new mp.Vector3(0, 0, vehicle.rotation.z);
    notifyAdmin(player, 'Vehicle flipped.');
});

/** Heal the requesting player to full health. */
mp.events.add('admin:healSelf', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.health = 100;
    player.armour = 100;
    notifyAdmin(player, 'Healed to full health and armor.');
});

/** Kill the requesting player. */
mp.events.add('admin:killSelf', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.health = 0;
    notifyAdmin(player, 'You have been killed.');
});

/** Set the requesting player's health (0-100). */
mp.events.add('admin:setHealth', (player, value) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const hp = Math.max(0, Math.min(100, parseInt(value, 10)));
    player.health = hp;
    notifyAdmin(player, `Health set to ${hp}.`);
});

/** Set the requesting player's armor (0-100). */
mp.events.add('admin:setArmor', (player, value) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const armor = Math.max(0, Math.min(100, parseInt(value, 10)));
    player.armour = armor;
    notifyAdmin(player, `Armor set to ${armor}.`);
});

/** Toggle god mode for the requesting player. */
mp.events.add('admin:toggleGodMode', (player, enabled) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.invincible = toBoolean(enabled);
    notifyAdmin(player, `God mode ${player.invincible ? 'ON' : 'OFF'}.`);
});

/** Toggle invisibility for the requesting player. */
mp.events.add('admin:toggleInvisible', (player, enabled) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.alpha = toBoolean(enabled) ? 0 : 255;
    notifyAdmin(player, `Invisibility ${player.alpha === 0 ? 'ON' : 'OFF'}.`);
});

/** Give the requesting player a weapon with full ammo. */
mp.events.add('admin:giveWeapon', (player, weaponName) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    try {
        player.giveWeapon(mp.joaat(weaponName), 9999);
        notifyAdmin(player, `Gave weapon: ${weaponName}.`);
    } catch (e) {
        notifyError(player, `Invalid weapon name: "${weaponName}".`);
    }
});

/** Remove all weapons from the requesting player. */
mp.events.add('admin:removeAllWeapons', (player) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    player.removeAllWeapons();
    notifyAdmin(player, 'All weapons removed.');
});

/** Set the world time (hour 0-23). */
mp.events.add('admin:setTime', (player, hour, minute) => {
    if (!isAdmin(player, ADMIN_LEVEL.ADMIN)) return notifyError(player, 'No permission.');
    const h = Math.max(0, Math.min(23, parseInt(hour, 10)));
    const m = Math.max(0, Math.min(59, parseInt(minute, 10) || 0));
    mp.world.time = { hour: h, minute: m, second: 0 };
    mp.players.broadcast(`!{#ff6600}[ADMIN] !{#ffffff}World time set to ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} by ${player.name}.`);
});

/** Set the world weather. */
mp.events.add('admin:setWeather', (player, weather) => {
    if (!isAdmin(player, ADMIN_LEVEL.ADMIN)) return notifyError(player, 'No permission.');
    mp.world.weather = weather;
    mp.players.broadcast(`!{#ff6600}[ADMIN] !{#ffffff}Weather set to ${weather} by ${player.name}.`);
});

/** Teleport the requesting player to another player by ID. */
mp.events.add('admin:teleportToPlayer', (player, targetId) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    player.position = target.position;
    notifyAdmin(player, `Teleported to ${target.name}.`);
});

/** Teleport a target player to the admin. */
mp.events.add('admin:bringPlayer', (player, targetId) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    target.position = player.position;
    notifyAdmin(player, `Brought ${target.name} to you.`);
    notifyAdmin(target, `You were teleported to ${player.name}.`);
});

/** Freeze/unfreeze a target player. */
mp.events.add('admin:freezePlayer', (player, targetId, freeze) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    const isFrozen = toBoolean(freeze);
    target.freeze(isFrozen);
    notifyAdmin(player, `${target.name} ${isFrozen ? 'frozen' : 'unfrozen'}.`);
    notifyAdmin(target, `You have been ${isFrozen ? 'frozen' : 'unfrozen'} by ${player.name}.`);
});

/** Heal a target player. */
mp.events.add('admin:healPlayer', (player, targetId) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    target.health = 100;
    target.armour = 100;
    notifyAdmin(player, `Healed ${target.name}.`);
    notifyAdmin(target, `You were healed by ${player.name}.`);
});

/** Kill a target player. */
mp.events.add('admin:killPlayer', (player, targetId) => {
    if (!isAdmin(player)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    target.health = 0;
    notifyAdmin(player, `Killed ${target.name}.`);
    broadcastAdminAction(player, `killed ${target.name}.`);
});

/** Kick a target player. */
mp.events.add('admin:kickPlayer', (player, targetId, reason) => {
    if (!isAdmin(player, ADMIN_LEVEL.ADMIN)) return notifyError(player, 'No permission.');
    const target = mp.players.at(parseInt(targetId, 10));
    if (!target) return notifyError(player, 'Player not found.');
    const kickReason = reason || 'Kicked by an admin.';
    target.kick(kickReason);
    broadcastAdminAction(player, `kicked ${target.name} (${kickReason}).`);
});

/** Send the list of online players to the requesting admin's menu. */
mp.events.add('admin:getPlayerList', (player) => {
    if (!isAdmin(player)) return;
    const list = [];
    mp.players.forEach((p) => {
        list.push({ id: p.id, name: p.name });
    });
    player.call('admin:receivePlayerList', [JSON.stringify(list)]);
});

// ─── Chat Commands ────────────────────────────────────────────────────────────
mp.events.add('playerCommand', (player, cmdRaw) => {
    const parts = cmdRaw.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === 'login') {
        const username = parts[1];
        const password = parts[2];
        if (!username || !password) {
            return player.outputChatBox('!{#ff0000}[AUTH] !{#ffffff}Usage: /login <username> <password>');
        }
        // Delegate to the same handler the CEF login form uses
        const attempts = (loginAttempts.get(player.id) || 0);
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
            player.kick('Too many failed login attempts.');
            return;
        }
        const result = verifyIngameLogin(username, password, player.socialClub);
        if (result.ok) {
            authenticatedPlayers.add(player.id);
            loginAttempts.delete(player.id);
            player.setVariable('adminLevel',  result.adminLevel);
            player.setVariable('permissions', JSON.stringify(result.permissions));
            player.call('auth:loginResult', [true, '']);
            notifyAdmin(player, `Logged in successfully! Admin level: ${result.adminLevel}.`);
            mp.events.call('console:log', 'AUTH', `${player.name} logged in via /login as ${username}.`);
        } else {
            loginAttempts.set(player.id, attempts + 1);
            const remaining = MAX_LOGIN_ATTEMPTS - (attempts + 1);
            player.outputChatBox(`!{#ff0000}[AUTH] !{#ffffff}${result.reason}${remaining > 0 ? ` (${remaining} attempts left)` : ''}`);
            if (remaining <= 0) setTimeout(() => player.kick('Too many failed login attempts.'), 1500);
        }
        return;
    }

    if (cmd === 'admin') {
        if (!isAdmin(player)) return notifyError(player, 'You do not have admin access.');
        player.call('admin:openMenu');
        return;
    }

    if (cmd === 'setadmin') {
        // Only superadmins can promote others.
        if (!isAdmin(player, ADMIN_LEVEL.SUPERADMIN)) return notifyError(player, 'No permission.');
        const target = mp.players.at(parseInt(parts[1], 10));
        const level = parseInt(parts[2], 10);
        if (!target || isNaN(level)) return notifyError(player, 'Usage: /setadmin <id> <level 0-3>');
        playerAdminLevels.set(target.id, Math.max(0, Math.min(3, level)));
        target.setVariable('adminLevel', playerAdminLevels.get(target.id));
        notifyAdmin(player, `Set admin level of ${target.name} to ${level}.`);
        notifyAdmin(target, `Your admin level was set to ${level} by ${player.name}.`);
        return;
    }

    if (cmd === 'restartserver') {
        // Only superadmins can restart the server.
        if (!isAdmin(player, ADMIN_LEVEL.SUPERADMIN)) return notifyError(player, 'No permission.');
        if (restartCountdownTick !== null) {
            return notifyError(player, 'A server restart is already in progress.');
        }
        const delay = 5; // seconds before restart
        mp.players.broadcast(`!{#ff0000}[SERVER] !{#ffffff}Server restart in ${delay} seconds – initiated by ${player.name}.`);
        let remaining = delay - 1;
        restartCountdownTick = setInterval(() => {
            if (remaining <= 0) {
                clearInterval(restartCountdownTick);
                restartCountdownTick = null;
                mp.players.broadcast('!{#ff0000}[SERVER] !{#ffffff}Restarting now...');
                // Exit the process. A process manager (pm2 / restart loop) will bring it back up.
                setTimeout(() => process.exit(0), 500);
            } else {
                mp.players.broadcast(`!{#ff0000}[SERVER] !{#ffffff}Restarting in ${remaining}...`);
                remaining--;
            }
        }, 1000);
        return;
    }

    // Unknown command – notify the player so RAGE:MP does not show a generic
    // "Unknown command" message from the client.
    const hint = isAuthenticated(player) ? '' : ' Type /login to authenticate.';
    player.outputChatBox(`!{#888888}Unknown command: /${cmd}.${hint}`);
});

mp.events.add('playerReady', (player) => {
    // Show login overlay via CEF.
    player.call('auth:showLogin');
    player.outputChatBox('!{#00ff88}Welcome! Please log in with your UCP account using the login screen or /login <username> <password>');
    player.outputChatBox('!{#aaaaaa}No account yet? Register at: http://<server-ip>:8080/register');
});
