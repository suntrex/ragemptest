'use strict';

// ─── Admin Menu – Client Side ─────────────────────────────────────────────────
// Opens a CEF browser for the HTML/CSS/JS admin menu and bridges events between
// the menu and the server.

let browser = null;
let menuOpen = false;
let loginVisible = false;

const MENU_URL = 'package://admin/html/index.html';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function openMenu() {
    if (loginVisible) return; // don't toggle menu while login is showing
    if (menuOpen) {
        closeMenu();
        return;
    }
    menuOpen = true;
    browser = mp.browsers.new(MENU_URL);
    mp.gui.cursor.show(true, true);
    browser.active = true;
}

function closeMenu() {
    if (!menuOpen) return;
    menuOpen = false;
    if (browser && !loginVisible) {
        browser.destroy();
        browser = null;
    }
    if (!loginVisible) mp.gui.cursor.show(false, false);
}

// ─── Key Binding (F6 = toggle menu) ──────────────────────────────────────────
mp.keys.bind(0x75, true, () => {  // 0x75 = F6
    openMenu();
});

// ─── Login Overlay (shown on player join) ─────────────────────────────────────

/** Server signals that the player must authenticate. */
mp.events.add('auth:showLogin', (playerCount) => {
    loginVisible = true;
    if (!browser) {
        browser = mp.browsers.new(MENU_URL);
    }
    mp.gui.cursor.show(true, true);
    browser.active = true;
    // Give the browser a moment to load before executing JS.
    setTimeout(() => {
        if (browser) browser.execute('showLoginOverlay(' + (parseInt(playerCount, 10) || 0) + ')');
    }, 1500);
});

/** Server responds with login result. */
mp.events.add('auth:loginResult', (success, reason) => {
    if (success) {
        loginVisible = false;
        if (browser) browser.execute('hideLoginOverlay()');
        mp.gui.cursor.show(false, false);
        // Close the browser unless the admin menu was intentionally opened.
        if (!menuOpen) {
            if (browser) { browser.destroy(); browser = null; }
        }
    } else {
        if (browser) browser.execute(`showLoginError(${JSON.stringify(reason)})`);
    }
});

// ─── Server → Client Events ───────────────────────────────────────────────────

/** Server tells the client to open the menu (e.g. via /admin command). */
mp.events.add('admin:openMenu', () => {
    openMenu();
});

/** Receive the player list from the server and forward to the CEF page. */
mp.events.add('admin:receivePlayerList', (listJson) => {
    if (browser) {
        browser.execute(`receivePlayerList(${listJson})`);
    }
});

// ─── CEF → Client → Server Bridge ────────────────────────────────────────────
mp.events.add('admin:cef:closeMenu', () => {
    closeMenu();
});

// Login form submission from CEF
mp.events.add('auth:cef:login', (username, password) => {
    mp.events.callRemote('auth:login', username, password);
});

mp.events.add('admin:cef:teleportToWaypoint', () => {
    // Get the waypoint blip coords via native and send to server.
    const blipHandle = mp.game.ui.getFirstBlipInfoId(8); // type 8 = waypoint
    if (mp.game.ui.doesBlipExist(blipHandle)) {
        const coords = mp.game.ui.getBlipInfoIdCoord(blipHandle);
        // getGroundZFor3dCoord returns [bool, groundZ] in RageMP's native wrapper.
        const groundResult = mp.game.misc.getGroundZFor3dCoord(coords.x, coords.y, 1000.0, false);
        const z = (Array.isArray(groundResult) && groundResult[1]) ? groundResult[1] : (coords.z || 30.0);
        mp.events.callRemote('admin:teleportToWaypoint', coords.x, coords.y, z);
    } else {
        mp.game.ui.displayHelpTextThisFrame('~r~No waypoint set! Place a waypoint on the map first.');
    }
});

mp.events.add('admin:cef:spawnVehicle', (modelName) => {
    mp.events.callRemote('admin:spawnVehicle', modelName);
});

mp.events.add('admin:cef:fixVehicle', () => {
    mp.events.callRemote('admin:fixVehicle');
});

mp.events.add('admin:cef:deleteVehicle', () => {
    mp.events.callRemote('admin:deleteVehicle');
});

mp.events.add('admin:cef:flipVehicle', () => {
    mp.events.callRemote('admin:flipVehicle');
});

mp.events.add('admin:cef:healSelf', () => {
    mp.events.callRemote('admin:healSelf');
});

mp.events.add('admin:cef:killSelf', () => {
    mp.events.callRemote('admin:killSelf');
});

mp.events.add('admin:cef:setHealth', (value) => {
    mp.events.callRemote('admin:setHealth', value);
});

mp.events.add('admin:cef:setArmor', (value) => {
    mp.events.callRemote('admin:setArmor', value);
});

mp.events.add('admin:cef:toggleGodMode', (enabled) => {
    mp.events.callRemote('admin:toggleGodMode', enabled);
});

mp.events.add('admin:cef:toggleInvisible', (enabled) => {
    mp.events.callRemote('admin:toggleInvisible', enabled);
});

mp.events.add('admin:cef:giveWeapon', (weaponName) => {
    mp.events.callRemote('admin:giveWeapon', weaponName);
});

mp.events.add('admin:cef:removeAllWeapons', () => {
    mp.events.callRemote('admin:removeAllWeapons');
});

mp.events.add('admin:cef:setTime', (hour, minute) => {
    mp.events.callRemote('admin:setTime', hour, minute);
});

mp.events.add('admin:cef:setWeather', (weather) => {
    mp.events.callRemote('admin:setWeather', weather);
});

mp.events.add('admin:cef:teleportToPlayer', (targetId) => {
    mp.events.callRemote('admin:teleportToPlayer', targetId);
});

mp.events.add('admin:cef:bringPlayer', (targetId) => {
    mp.events.callRemote('admin:bringPlayer', targetId);
});

mp.events.add('admin:cef:freezePlayer', (targetId, freeze) => {
    mp.events.callRemote('admin:freezePlayer', targetId, freeze);
});

mp.events.add('admin:cef:healPlayer', (targetId) => {
    mp.events.callRemote('admin:healPlayer', targetId);
});

mp.events.add('admin:cef:killPlayer', (targetId) => {
    mp.events.callRemote('admin:killPlayer', targetId);
});

mp.events.add('admin:cef:kickPlayer', (targetId, reason) => {
    mp.events.callRemote('admin:kickPlayer', targetId, reason);
});

mp.events.add('admin:cef:getPlayerList', () => {
    mp.events.callRemote('admin:getPlayerList');
});
