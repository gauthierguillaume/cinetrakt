const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSnapshot, buildTableModel } = require('../episode-rating-utils.js');
const ratings = require('../rating-utils.js');
const { createLoader } = require('../imdb-episode-loader.js');
const { MESSAGE_TYPES: types } = require('../extension-protocol.js');
const fs = require('node:fs');
const vm = require('node:vm');
const snapshot = { imdbId: 'tt0460681', complete: true, totalEpisodes: 3, episodes: [
	{ season: 2, episode: 1, imdbId: 'tt1000003', rating: null },
	{ season: 1, episode: 2, imdbId: 'tt1000002', rating: 9 },
	{ season: 1, episode: 1, imdbId: 'tt1000001', rating: 7.4 },
] };

test('transposition preserves season and episode numbers, excludes missing scores from averages, and grows with seasons', () => {
	const normalized = normalizeSnapshot(snapshot, snapshot.imdbId);
	const model = buildTableModel(normalized, ratings);
	assert.deepEqual(model.seasons.map(s => s.number), [1, 2]);
	assert.equal(model.seasons[0].episodes.get(2).imdbId, 'tt1000002');
	assert.equal(model.seasons[0].average, 8.2);
	assert.equal(model.seasons[1].average, null);
	assert.equal(model.seasons[1].episodes.has(2), false);
	assert.equal(model.episodeCount, 2);
	const many = { ...snapshot, totalEpisodes: 15, episodes: Array.from({ length: 15 }, (_, i) => ({ ...snapshot.episodes[0], season: i + 1 })) };
	assert.ok(buildTableModel(normalizeSnapshot(many, snapshot.imdbId), ratings).width > model.width);
});

test('conflicting identities, invalid ratings, injection strings and wrong titles are rejected; partial seasons have no average', () => {
	assert.equal(normalizeSnapshot(snapshot, 'tt1111111'), null);
	for (const override of [{ season: -1 }, { episode: 0 }, { rating: '8.2' }, { rating: NaN }, { rating: 10.1 }, { imdbId: 'tt1234567/"onclick=' }]) {
		assert.equal(normalizeSnapshot({ ...snapshot, episodes: [{ ...snapshot.episodes[0], ...override }] }, snapshot.imdbId), null);
	}
	assert.equal(normalizeSnapshot({ ...snapshot, episodes: [snapshot.episodes[0], { ...snapshot.episodes[0], imdbId: 'tt3333333' }] }, snapshot.imdbId), null);
	const partial = normalizeSnapshot({ ...snapshot, totalEpisodes: 10 }, snapshot.imdbId);
	assert.equal(partial.complete, false);
	assert.ok(buildTableModel(partial, ratings).seasons.every(s => s.average === null));
});

function loaderFixture({ deferred = false } = {}) {
	const tabs = new Map(), created = [], removed = [], replies = [], timers = new Map(); let nextTab = 100, nextTimer = 0, pendingCreate;
	const chrome = { runtime: {}, tabs: {
		create(options, callback) { const tab = { ...options, id: ++nextTab }; tabs.set(tab.id, tab); created.push(tab);
			if (deferred) pendingCreate = () => callback(tab); else callback(tab); },
		get(id, callback) { callback(tabs.get(id)); }, remove(id, callback) { removed.push(id); tabs.delete(id); callback?.(); },
	} };
	const loader = createLoader({ chrome, CineTraktEpisodeRatings: require('../episode-rating-utils.js'), CineTraktExtensionProtocol: { MESSAGE_TYPES: types },
		setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
	const sender = { frameId: 0, tab: { id: 5, windowId: 2, url: 'https://app.trakt.tv/shows/supernatural?view=ratings' } };
	const message = { type: types.GET_IMDB_EPISODES, imdbId: snapshot.imdbId, requestId: '1' };
	return { loader, sender, message, tabs, created, removed, replies, timers,
		request(msg = message, from = sender) { return loader.handleMessage(msg, from, response => replies.push(response)); },
		result(data = snapshot, from) { return loader.handleMessage({ type: types.IMDB_EPISODES_RESULT, data },
			from || { frameId: 0, tab: { id: created.at(-1).id }, url: created.at(-1).url }, () => {}); },
		createdCallback: () => pendingCreate(),
	};
}

test('only a top-level Trakt show can request collection, and results must come from the exact created IMDb tab', () => {
	const f = loaderFixture();
	for (const sender of [{ ...f.sender, frameId: 1 }, { ...f.sender, tab: { ...f.sender.tab, url: 'https://evil.test/shows/test' } },
		{ ...f.sender, tab: { ...f.sender.tab, url: 'https://app.trakt.tv/home' } }]) assert.equal(f.request(f.message, sender), false);
	assert.equal(f.created.length, 0);
	assert.equal(f.request(), true); assert.equal(f.created[0].active, false); assert.equal(f.created[0].windowId, 2);
	f.result(snapshot, { frameId: 0, tab: { id: 999 }, url: f.created[0].url });
	assert.equal(f.removed.length, 0);
	f.result(snapshot, { frameId: 1, tab: { id: f.created[0].id }, url: f.created[0].url });
	assert.equal(f.removed.length, 0);
	f.result();
	assert.equal(f.replies.at(-1).data.episodes.length, 3); assert.deepEqual(f.removed, [101]); assert.equal(f.timers.size, 0);
	f.request({ ...f.message, requestId: '2' });
	assert.equal(f.created.length, 1, 'complete results are reused for subsequent opens');
});

test('cancel and timeout remove only their own still-inactive collector; user-navigated or activated tabs are preserved', () => {
	for (const changed of [null, 'active', 'navigated']) {
		const f = loaderFixture(); f.request();
		if (changed === 'active') f.tabs.get(101).active = true;
		if (changed === 'navigated') f.tabs.get(101).url = 'https://www.imdb.com/title/tt9999999/';
		f.request({ ...f.message, type: types.CANCEL_IMDB_EPISODES }, { ...f.sender, tab: { ...f.sender.tab, url: 'https://app.trakt.tv/home' } });
		assert.equal(f.removed.length, changed ? 0 : 1); assert.equal(f.timers.size, 0);
	}
	const timeout = loaderFixture(); timeout.request();
	assert.equal([...timeout.timers.values()][0].delay, 45000); [...timeout.timers.values()][0].callback();
	assert.equal(timeout.replies[0].error, 'timeout'); assert.deepEqual(timeout.removed, [101]);
	const race = loaderFixture({ deferred: true }); race.request(); race.request({ ...race.message, type: types.CANCEL_IMDB_EPISODES });
	race.createdCallback(); assert.deepEqual(race.removed, [101]);
});

test('the collector loads both season and episode pagination and exports actual IMDb identities without modifying a popup', async () => {
	let now = 0, paged = false; const sent = [];
	const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'imdb-episode-data.js'), 'utf8');
	const records = [{ season: 1, episode: 1, imdbId: 'tt1000001', rating: 7.4 }, { season: 1, episode: 2, imdbId: 'tt1000002', rating: 9 }];
	const rows = () => [{ querySelectorAll: () => (paged ? records : records.slice(0, 1)).map(item => ({
		textContent: String(item.rating), getAttribute: key => key === 'aria-label' ? `Season ${item.season} Episode ${item.episode}, Rating ${item.rating}` : `/title/${item.imdbId}/`,
	})) }];
	const window = { location: { pathname: '/title/tt0460681/ratings/' }, addEventListener() {}, setTimeout(callback, ms) { now += ms; queueMicrotask(callback); } };
	window.top = window;
	const context = vm.createContext({ window, Date: { now: () => now }, CineTraktImdbPage: { isRatingsDataMode: () => true },
		CineTraktExtensionProtocol: { MESSAGE_TYPES: types }, CineTraktSettings: { ready: Promise.resolve(), isEnabled: () => true },
		chrome: { runtime: { sendMessage: message => sent.push(message) } },
		document: { body: { innerText: '' }, querySelectorAll: selector => selector.includes('seasons-column') ? [{ textContent: 'S1' }] : rows(),
			querySelector: selector => selector === 'script#__NEXT_DATA__' ? { textContent: JSON.stringify({ props: { pageProps: { contentData: { heatmapData: { totalEpisodes: 2 } } } } }) }
				: selector.includes('Load additional episodes') && !paged ? { getAttribute: () => null, click() { paged = true; } } : null },
	});
	vm.runInContext(source, context);
	for (let i = 0; i < 20 && !sent.length; i++) await new Promise(resolve => setImmediate(resolve));
	assert.equal(sent.length, 1); assert.equal(sent[0].type, types.IMDB_EPISODES_RESULT);
	assert.equal(sent[0].data.complete, true); assert.equal(sent[0].data.episodes.length, 2);
	assert.equal(sent[0].data.episodes[1].imdbId, 'tt1000002');
});

test('worker restart cleans up only recorded inactive collector tabs before accepting new requests', async () => {
	const { start } = require('../imdb-episode-loader.js');
	const removed = [], tabs = new Map([
		[1, { id: 1, active: false, url: 'https://www.imdb.com/title/tt0460681/ratings/?cinetrakt_ratings_data=1' }],
		[2, { id: 2, active: true, url: 'https://www.imdb.com/title/tt0460681/ratings/?cinetrakt_ratings_data=1' }],
		[3, { id: 3, active: false, url: 'https://www.imdb.com/title/tt9999999/' }],
	]);
	await start({ CineTraktExtensionProtocol: { MESSAGE_TYPES: types }, CineTraktEpisodeRatings: require('../episode-rating-utils.js'),
		chrome: { runtime: { onMessage: { addListener() {} } }, tabs: { onRemoved: { addListener() {} },
			get: (id, callback) => callback(tabs.get(id)), remove(id, callback) { removed.push(id); callback(); } },
			storage: { session: { get(key, callback) { callback({ [key]: [1, 2, 3].map(tabId => ({ tabId, imdbId: 'tt0460681' })) }); }, remove(key, callback) { callback(); } } } },
	});
	assert.deepEqual(removed, [1]);
});
