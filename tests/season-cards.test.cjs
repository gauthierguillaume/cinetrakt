const test = require('node:test');
const assert = require('node:assert/strict');
const cards = require('../trakt-season-cards.js');
const utils = require('../season-rating-utils.js');
const entry = (query, data, dependencies = [], at = Date.now()) => ({ queryKey: [`query:${query}`, ...dependencies],
	state: { status: 'success', data, dataUpdatedAt: at } });

test('season links open the exact native season drawer and discard an episode selection', () => {
	assert.equal(cards.seasonHref('/shows/american-horror-story', 2, '?season=3&episode=7&view=ratings'),
		'/shows/american-horror-story?season=2&view=seasons');
	assert.equal(cards.seasonHref('/shows/test', 0), '/shows/test?season=0&view=seasons');
	for (const route of ['/movies/test', '/shows/test/seasons/2', 'https://other.test/shows/test']) assert.equal(cards.seasonHref(route, 1), '');
	for (const number of [-1, 1.5, 201, '2']) assert.equal(cards.seasonHref('/shows/test', number), '');
});

test('native season metadata preserves anthology titles without inventing generic subtitles', () => {
	assert.deepEqual(utils.parseSeasonDetails([
		{ number: 1, title: 'Murder House', episode_count: 12, aired_episodes: 12 },
		{ number: 2, title: ' Asylum ', episode_count: 13, aired_episodes: 20 },
		{ number: 3, title: 'Season 3', episode_count: 10, aired_episodes: 4 },
		{ number: 0, title: 'Specials', episode_count: 2 }, { number: 1, title: 'Wrong duplicate' },
		{ number: -1, title: 'Invalid' }, { number: 4, title: null, episode_count: 0, aired_episodes: 0 },
	]), { 0: { title: '', aired: 2 }, 1: { title: 'Murder House', aired: 12 }, 2: { title: 'Asylum', aired: 13 },
		3: { title: '', aired: 4 }, 4: { title: '', aired: 0 } });
});

test('watched indicators match native aired-episode rules, including partial and unaired seasons', () => {
	assert.equal(cards.watchedStatus(12, 12), 'watched');
	assert.equal(cards.watchedStatus(12, 13), 'watched');
	assert.equal(cards.watchedStatus(12, 1), 'partial');
	for (const [aired, plays] of [[12, 0], [0, 2], [12, undefined], [undefined, 12]]) assert.equal(cards.watchedStatus(aired, plays), '');
});

test('history extraction selects only the current show, rejects expired data and preserves season numbers', () => {
	const now = Date.now();
	const summary = entry('showSummary:v2', { id: 1409 }, ['dependency:american-horror-story'], now);
	assert.equal(cards.showIdFromEntry(summary, '/shows/american-horror-story', now), 1409);
	assert.equal(cards.showIdFromEntry(summary, '/shows/supernatural', now), null);
	assert.equal(cards.showIdFromEntry(summary, '/shows/american-horror-story', now + 4 * 3600000), null);
	const history = entry('currentUserWatchedShows', { pages: [{ entries: [{ id: 999, playsPerSeason: new Map([[1, 99]]) }] },
		{ entries: [{ id: 1409, playsPerSeason: new Map([[0, 2], [2, 13], [9, 5], [-1, 1], [4, '10']]) }] }] }, [], now);
	assert.deepEqual(cards.playsFromEntry(history, 1409, now), new Map([[0, 2], [2, 13], [9, 5]]));
	assert.equal(cards.playsFromEntry(history, 1409, now + 13 * 3600000), null);
	assert.equal(cards.playsFromEntry(history, 42, now), null);
});

test('cache access is read-only, bounded to summary/history keys, and returns only selected season counts', async () => {
	const values = [entry('showSummary:v2', { id: 1409 }, ['dependency:american-horror-story']),
		entry('currentUserWatchedShows', { pages: [{ entries: [{ id: 1409, playsPerSeason: new Map([[1, 12]]) },
			{ id: 999, playsPerSeason: new Map([[5, 10]]) }] }] }),
		entry('currentUserSettings', { token: 'must-not-be-read' }), entry('showSummary:v2', { id: 999 }, ['dependency:other-show'])];
	const rows = new Map(values.map(v => [JSON.stringify(v.queryKey), v]));
	const read = []; let closed = 0, pending = 0;
	const tx = { objectStore(name) { assert.equal(name, 'query-cache'); return {
		getAllKeys: () => request([...rows.keys()]), get(key) { read.push(key); return request(rows.get(key)); },
	}; } };
	function request(result) {
		pending++; const r = { result };
		setImmediate(() => { r.onsuccess?.(); if (!--pending) tx.oncomplete?.(); }); return r;
	}
	const idb = { open(name) {
		assert.equal(name, 'trakt-query'); const opened = { result: {
			objectStoreNames: { contains: name => name === 'query-cache' }, close() { closed++; },
			transaction(name, mode) { assert.equal(mode, 'readonly'); return tx; },
		} }; setImmediate(() => opened.onsuccess()); return opened;
	} };
	assert.deepEqual(await cards.readWatched('/shows/american-horror-story', idb), new Map([[1, 12]]));
	assert.equal(read.length, 2); assert.equal(closed, 1);
	assert.ok(read.every(key => !key.includes('Settings') && !key.includes('other-show')));
	assert.equal(await cards.readWatched('/movies/test', idb), null);
	assert.equal(await cards.readWatched('/shows/test', null), null);
});
