const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');

test('service worker imports shared URL and window layout helpers', () => {
	assert.match(source, /importScripts\("settings\.js", "extension-protocol\.js", "stremio-url\.js", "window-layout\.js"\)/);
	assert.match(source, /const \{ MESSAGE_TYPES \} = globalThis\.CineTraktExtensionProtocol/);
	assert.match(source, /const \{ isStremioWebUrl \} = globalThis\.CineTraktStremioUrls/);
	assert.match(source, /getPopupLayout/);
});

test('Stremio requests are limited to trusted Trakt senders and valid final URLs', () => {
	assert.match(source, /senderUrl\.startsWith\("https:\/\/app\.trakt\.tv\/"\)/);
	assert.match(source, /!isStremioWebUrl\(message\.url\)/);
});

test('reusing a Stremio window performs a single navigation without delayed retry', () => {
	const start = source.indexOf('function moveAndReuseStremioPopup');
	const end = source.indexOf('function openOrReuseStremioWindow', start);
	const reuseFlow = source.slice(start, end);

	assert.ok(start >= 0 && end > start);
	assert.equal((reuseFlow.match(/safeTabUpdate\(firstTab\.id, \{ url, active: true \}/g) || []).length, 1);
	assert.doesNotMatch(reuseFlow, /setTimeout/);
	assert.doesNotMatch(source, /wos_retry/i);
	assert.doesNotMatch(source, /reapplyStremioRouteAfterFocus|getStremioRouteReapplyUrl/);
});
