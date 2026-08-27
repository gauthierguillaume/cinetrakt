const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');

test('service worker imports shared URL, media resolver, and window layout helpers', () => {
	assert.match(source, /importScripts\("settings\.js", "extension-protocol\.js", "stremio-url\.js", "trakt-imdb-resolver\.js", "window-layout\.js"\)/);
	assert.match(source, /const \{ MESSAGE_TYPES \} = globalThis\.CineTraktExtensionProtocol/);
	assert.match(source, /const \{ isStremioWebUrl \} = globalThis\.CineTraktStremioUrls/);
	assert.match(source, /getPopupLayout/);
});

test('Trakt IMDb resolution uses the official API for trusted app senders', () => {
	assert.match(source, /MESSAGE_TYPES\.RESOLVE_TRAKT_IMDB_ID/);
	assert.match(source, /hasExactOrigin\(senderUrl, TRAKT_APP_ORIGIN\)/);
	assert.match(source, /getTraktApiMediaUrl\(pathname\)/);
	assert.match(source, /'trakt-api-key': TRAKT_API_CLIENT_ID/);
});

test('Stremio requests are limited to trusted Trakt senders and valid final URLs', () => {
	assert.match(source, /new URL\(String\(value \|\| ""\)\)\.origin === expectedOrigin/);
	assert.equal((source.match(/hasExactOrigin\(senderUrl, TRAKT_APP_ORIGIN\)/g) || []).length, 3);
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
