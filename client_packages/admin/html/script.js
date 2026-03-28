'use strict';

/* ── State ──────────────────────────────────────────────────────────────────── */
let selectedPlayerId   = null;
let selectedPlayerName = null;
let notifyTimer        = null;

/* ── RageMP Bridge ───────────────────────────────────────────────────────────
   In the CEF context mp.trigger() sends an event to the client-side JS.       */
function trigger(event, ...args) {
    if (typeof mp !== 'undefined') {
        mp.trigger(event, ...args);
    } else {
        // Dev-only fallback when opening the HTML file directly in a browser.
        console.log('[trigger]', event, args);
    }
}

/* ── Notification ─────────────────────────────────────────────────────────── */
function showNotification(msg) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
        el.classList.remove('show');
    }, 2500);
}

/* ── Overlay click (close if clicking outside menu) ─────────────────────── */
function handleOverlayClick(e) {
    if (e.target === document.getElementById('overlay')) {
        closeMenu();
    }
}

/* ── Menu Controls ───────────────────────────────────────────────────────── */
function closeMenu() {
    trigger('admin:cef:closeMenu');
}

/* ── Tab Switching ────────────────────────────────────────────────────────── */
function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // Find the button whose onclick attribute matches the tab name safely via iteration.
    document.querySelectorAll('.tab-btn').forEach(b => {
        if (b.getAttribute('onclick') === `switchTab('${name}')`) b.classList.add('active');
    });
    const activeContent = document.getElementById(`tab-${name}`);
    if (activeContent) activeContent.classList.add('active');
}

/* ── Player Tab ───────────────────────────────────────────────────────────── */
function teleportToWaypoint() {
    trigger('admin:cef:teleportToWaypoint');
    showNotification('Teleporting to waypoint…');
}

function healSelf() {
    trigger('admin:cef:healSelf');
    showNotification('Healed to full HP and armor.');
}

function killSelf() {
    trigger('admin:cef:killSelf');
    showNotification('You killed yourself.');
}

function setHealth() {
    const val = parseInt(document.getElementById('health-val').value, 10);
    if (isNaN(val) || val < 0 || val > 100) return showNotification('Enter a value between 0 and 100.');
    trigger('admin:cef:setHealth', val);
    showNotification(`Health set to ${val}.`);
}

function setArmor() {
    const val = parseInt(document.getElementById('armor-val').value, 10);
    if (isNaN(val) || val < 0 || val > 100) return showNotification('Enter a value between 0 and 100.');
    trigger('admin:cef:setArmor', val);
    showNotification(`Armor set to ${val}.`);
}

function toggleGodMode(enabled) {
    trigger('admin:cef:toggleGodMode', enabled);
    showNotification(`God mode ${enabled ? 'ON' : 'OFF'}.`);
}

function toggleInvisible(enabled) {
    trigger('admin:cef:toggleInvisible', enabled);
    showNotification(`Invisibility ${enabled ? 'ON' : 'OFF'}.`);
}

/* ── Vehicle Tab ──────────────────────────────────────────────────────────── */
function spawnVehicle() {
    const model = document.getElementById('vehicle-model').value.trim().toLowerCase();
    if (!model) return showNotification('Enter a vehicle model name.');
    trigger('admin:cef:spawnVehicle', model);
    showNotification(`Spawning: ${model}…`);
    document.getElementById('vehicle-model').value = '';
}

function fixVehicle() {
    trigger('admin:cef:fixVehicle');
    showNotification('Vehicle repaired.');
}

function deleteVehicle() {
    trigger('admin:cef:deleteVehicle');
    showNotification('Vehicle deleted.');
}

function flipVehicle() {
    trigger('admin:cef:flipVehicle');
    showNotification('Vehicle flipped.');
}

/* ── Weapons Tab ──────────────────────────────────────────────────────────── */
function giveWeapon() {
    const name = document.getElementById('weapon-name').value.trim().toUpperCase();
    if (!name) return showNotification('Enter a weapon name.');
    trigger('admin:cef:giveWeapon', name);
    showNotification(`Gave weapon: ${name}.`);
    document.getElementById('weapon-name').value = '';
}

function removeAllWeapons() {
    trigger('admin:cef:removeAllWeapons');
    showNotification('All weapons removed.');
}

/* ── World Tab ────────────────────────────────────────────────────────────── */
function setTime() {
    const hour = parseInt(document.getElementById('time-hour').value, 10);
    const min  = parseInt(document.getElementById('time-min').value, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) return showNotification('Hour must be 0–23.');
    if (isNaN(min)  || min  < 0 || min  > 59) return showNotification('Minute must be 0–59.');
    trigger('admin:cef:setTime', hour, min);
    showNotification(`Time set to ${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}.`);
}

function setWeather(weather) {
    trigger('admin:cef:setWeather', weather);
    showNotification(`Weather: ${weather}.`);
}

/* ── Players Tab ──────────────────────────────────────────────────────────── */
function requestPlayerList() {
    trigger('admin:cef:getPlayerList');
    document.getElementById('player-list-container').innerHTML =
        '<div class="placeholder">Loading…</div>';
}

/** Called by the client-side JS after receiving the list from the server. */
function receivePlayerList(list) {
    const container = document.getElementById('player-list-container');
    if (!list || list.length === 0) {
        container.innerHTML = '<div class="placeholder">No players online.</div>';
        return;
    }
    container.innerHTML = '';
    list.forEach(p => {
        const row = document.createElement('div');
        row.className = 'player-row' + (p.id === selectedPlayerId ? ' selected' : '');
        row.dataset.id   = p.id;
        row.dataset.name = p.name;
        row.innerHTML = `<span class="player-id">${p.id}</span><span class="player-name">${escapeHtml(p.name)}</span>`;
        row.addEventListener('click', () => selectPlayer(p.id, p.name));
        container.appendChild(row);
    });
}

function selectPlayer(id, name) {
    selectedPlayerId   = id;
    selectedPlayerName = name;

    document.querySelectorAll('.player-row').forEach(r => {
        r.classList.toggle('selected', parseInt(r.dataset.id, 10) === id);
    });

    document.getElementById('selected-player-name').textContent = `${name} (ID: ${id})`;
    document.getElementById('player-actions').classList.remove('hidden');
}

function healTargetPlayer() {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    trigger('admin:cef:healPlayer', selectedPlayerId);
    showNotification(`Healed ${selectedPlayerName}.`);
}

function killTargetPlayer() {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    trigger('admin:cef:killPlayer', selectedPlayerId);
    showNotification(`Killed ${selectedPlayerName}.`);
}

function teleportToTargetPlayer() {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    trigger('admin:cef:teleportToPlayer', selectedPlayerId);
    showNotification(`Teleported to ${selectedPlayerName}.`);
}

function bringTargetPlayer() {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    trigger('admin:cef:bringPlayer', selectedPlayerId);
    showNotification(`Bringing ${selectedPlayerName} to you.`);
}

function freezeTargetPlayer(freeze) {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    trigger('admin:cef:freezePlayer', selectedPlayerId, freeze);
    showNotification(`${freeze ? 'Frozen' : 'Unfrozen'}: ${selectedPlayerName}.`);
}

function kickTargetPlayer() {
    if (selectedPlayerId === null) return showNotification('Select a player first.');
    const reason = prompt(`Kick reason for ${selectedPlayerName}:`) || 'Kicked by admin.';
    trigger('admin:cef:kickPlayer', selectedPlayerId, reason);
    showNotification(`Kicked ${selectedPlayerName}.`);
    selectedPlayerId = null;
    selectedPlayerName = null;
    document.getElementById('player-actions').classList.add('hidden');
    requestPlayerList();
}

/* ── Utilities ────────────────────────────────────────────────────────────── */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ── Keyboard: Escape to close ───────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
});
