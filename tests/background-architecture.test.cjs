const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'utf8');

function lookupFixture(fetch) {
	const vm = require('node:vm'); const timers = new Map();
	const context = vm.createContext({ AbortController, fetch, console: { warn() {} },
		setTimeout(callback, delay) { timers.set(1, { callback, delay }); return 1; },
		clearTimeout(id) { timers.delete(id); },
		CineTraktTraktImdbResolver: require('../trakt-imdb-resolver.js'),
	});
	vm.runInContext(`const { getTraktApiMediaUrl, findImdbIdInTraktResponse, TRAKT_API_CLIENT_ID } = CineTraktTraktImdbResolver;
		${source.match(/const TRAKT_LOOKUP_TIMEOUT_MS = \d+;/)[0]}
		${source.slice(source.indexOf('async function resolveTraktImdbId('), source.indexOf('chrome.runtime.onMessage.addListener'))}
		globalThis.lookup = resolveTraktImdbId;`, context);
	return { lookup: context.lookup, timers };
}

test('Trakt lookup aborts a stalled request and releases its timeout', async () => {
	let signal;
	const fixture = lookupFixture((url, options) => {
		signal = options.signal;
		return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
	});
	const result = fixture.lookup('/shows/silo');
	assert.equal(fixture.timers.get(1).delay, 12000);
	fixture.timers.get(1).callback();
	assert.equal(signal.aborted, true);
	assert.equal(await result, '');
	assert.equal(fixture.timers.size, 0);
});

test('successful Trakt lookups keep the ID and clear the timeout; invalid routes never fetch', async () => {
	let calls = 0;
	const fixture = lookupFixture(async () => { calls++; return { ok: true, json: async () => ({ ids: { imdb: 'tt14688458' } }) }; });
	assert.equal(await fixture.lookup('/shows/silo'), 'tt14688458');
	assert.equal(fixture.timers.size, 0);
	assert.equal(await fixture.lookup('/users/test'), '');
	assert.equal(calls, 1);
});

function letterboxdFixture(fetch) {
	const vm = require('node:vm'); const timers = new Map(); let now = 0; let timerId = 0;
	const helpers = require('../trakt-imdb-resolver.js');
	const context = vm.createContext({ ...helpers, ...require('../season-rating-utils.js'), AbortController, fetch,
		Date: { now: () => now }, TRAKT_LOOKUP_TIMEOUT_MS: 12000,
		setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
		clearTimeout(id) { timers.delete(id); },
	});
	vm.runInContext(source.slice(source.indexOf('const externalRatingsCache = new Map();'),
		source.indexOf('async function resolveTraktImdbId(')), context);
	return { lookup: context.getTraktExternalRatings, timers, advance(ms) { now += ms; } };
}

test('Letterboxd requests share one pending lookup, cache results, and expire after six hours', async () => {
	let calls = 0; let release;
	const fixture = letterboxdFixture((url, options) => {
		calls++;
		assert.equal(url, 'https://api.trakt.tv/movies/test/ratings?extended=all');
		assert.equal(options.credentials, 'omit');
		return new Promise(resolve => { release = () => resolve({ ok: true, json: async () =>
			({ letterboxd: { rating: 3.6, link: 'letterboxd.com/film/test' } }) }); });
	});
	const first = fixture.lookup('/movies/test');
	assert.equal(fixture.lookup('/movies/test'), first);
	release();
	assert.equal((await first).ratings.letterboxd.rating, 3.6);
	assert.equal((await fixture.lookup('/movies/test')).ratings.letterboxd.rating, 3.6);
	assert.equal(calls, 1);
	assert.equal(fixture.timers.size, 0);
	fixture.advance(6 * 60 * 60 * 1000 + 1);
	const fresh = fixture.lookup('/movies/test'); release(); await fresh;
	assert.equal(calls, 2);
	assert.equal((await fixture.lookup('/users/test')).ratings, null);
	assert.equal(calls, 2);
});

test('a stalled Letterboxd request aborts and allows a later retry instead of inventing a rating', async () => {
	let calls = 0;
	const fixture = letterboxdFixture((url, options) => {
		calls++;
		return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
	});
	const first = fixture.lookup('/movies/test');
	[...fixture.timers.values()][0].callback();
	const failed = await first;
	assert.equal(failed.ratings, null);
	assert.equal(failed.retryable, true);
	assert.equal(fixture.timers.size, 0);
	assert.equal((await fixture.lookup('/movies/test')).ratings, null);
	assert.equal(calls, 1);
	fixture.advance(1500);
	const retry = fixture.lookup('/movies/test');
	[...fixture.timers.values()][0].callback(); await retry;
	assert.equal(calls, 2);
});

test('season and external rating requests have separate caches and season data expires after three hours', async () => {
	let calls = 0;
	const fixture = letterboxdFixture(async url => {
		calls++;
		return { ok: true, json: async () => url.includes('/seasons?')
			? [{ number: 1, rating: 8.6, episode_count: 10, first_aired: '2010-01-01' }]
			: { imdb: { rating: 8.4, votes: 532800, link: 'www.imdb.com/title/tt0460681' } } };
	});
	assert.equal((await fixture.lookup('/shows/supernatural')).ratings.imdb.rating, 8.4);
	assert.deepEqual((await fixture.lookup('/shows/supernatural', true)).seasons, [{ season: 1, percent: 86 }]);
	await fixture.lookup('/shows/supernatural', true);
	assert.equal(calls, 2);
	fixture.advance(3 * 60 * 60 * 1000 + 1);
	await fixture.lookup('/shows/supernatural', true);
	await fixture.lookup('/shows/supernatural');
	assert.equal(calls, 3);
	assert.equal((await fixture.lookup('/movies/test', true)).seasons, null);
	assert.equal(calls, 3);
});

test('rating requests accept only the same film or series in the top-level Trakt tab', async () => {
	const vm = require('node:vm'); let handler; const lookups = []; const replies = [];
	const context = vm.createContext({ URL, TRAKT_APP_ORIGIN: 'https://app.trakt.tv',
		MESSAGE_TYPES: require('../extension-protocol.js').MESSAGE_TYPES,
		chrome: { runtime: { onMessage: { addListener(callback) { handler = callback; } } } },
		getTraktExternalRatings: async route => { lookups.push(route); return { ratings: { imdb: { rating: 7.1 } }, retryable: false }; },
	});
	vm.runInContext(source.slice(source.indexOf('function hasExactOrigin('), source.indexOf('function getSavedWindowId('))
		+ source.slice(source.indexOf('chrome.runtime.onMessage.addListener'), source.indexOf('chrome.windows.onRemoved.addListener')), context);
	const message = { type: context.MESSAGE_TYPES.GET_TRAKT_RATINGS, pathname: '/movies/test' };
	for (const sender of [{ url: 'https://evil.example/movies/test', frameId: 0 },
		{ url: 'https://app.trakt.tv/movies/other', frameId: 0 },
		{ url: 'https://app.trakt.tv/movies/test', frameId: 1 }]) {
		assert.equal(handler(message, sender, reply => replies.push(reply)), false);
	}
	assert.equal(lookups.length, 0);
	assert.equal(handler(message, { url: 'https://app.trakt.tv/movies/test?view=ratings', frameId: 0 }, reply => replies.push(reply)), true);
	await Promise.resolve();
	assert.deepEqual(lookups, ['/movies/test']);
	assert.equal(replies.at(-1).ratings.imdb.rating, 7.1);
	assert.equal(handler(message, {
		url: 'https://app.trakt.tv/movies/original-document',
		tab: { url: 'https://app.trakt.tv/movies/test?mode=media' }, frameId: 0,
	}, reply => replies.push(reply)), true, 'SPA navigation must use the current tab URL rather than the original document URL');
	await Promise.resolve();
	assert.deepEqual(lookups, ['/movies/test', '/movies/test']);
	assert.equal(handler(message, {
		url: 'https://app.trakt.tv/movies/test', tab: { url: 'https://app.trakt.tv/movies/another' }, frameId: 0,
	}, () => {}), false, 'an old document cannot request ratings for the previous page');
});

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
	assert.equal((source.match(/hasExactOrigin\(senderUrl, TRAKT_APP_ORIGIN\)/g) || []).length, 5);
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
