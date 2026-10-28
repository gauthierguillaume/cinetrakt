const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { MESSAGE_TYPES } = require('../extension-protocol.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function fixture(watched = null) {
	const nodes = [], timers = new Map(), events = new Map(), requests = [], posterRequests = []; let nextTimer = 0, nativeOpen = false;
	function node(tag = 'div') {
		const classes = new Set();
		const value = { tag, children: [], isConnected: true, hidden: false, style: { removeProperty(key) { delete this[key]; }, setProperty(key, value) { this[key] = value; } },
			classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
			setAttribute() {}, addEventListener(name, callback) { this[name] = callback; },
			appendChild(child) { this.children.push(child); return child; }, append(...children) { this.children.push(...children); },
			replaceChildren(...children) { this.children = children; },
			remove() { this.isConnected = false; },
			querySelector(selector) { return selector === 'img' ? this.children.find(n => n.tag === 'img' && n.isConnected) : null; },
			querySelectorAll() {
				if (!this.posterSlots) this.posterSlots = [...(this.innerHTML || '').matchAll(/data-season-poster="(\d+)"/g)].map(match => {
					const slot = node('span'); slot.dataset = { seasonPoster: match[1] };
					const subtitle = node('span'), badge = node('span'), card = node('a'); badge.dataset = {};
					card.querySelector = selector => selector === '.cinetrakt-season-watched' ? badge : subtitle;
					slot.closest = () => card;
					return slot;
				});
				return this.posterSlots;
			},
		};
		nodes.push(value); return value;
	}
	const nativeTitle = node(), nativeContent = node(), titleHost = node(), contentHost = node(), drawer = node();
	nativeTitle.cloneNode = () => { const heading = node('h1'); heading.classList.add('ellipsis'); return heading; };
	titleHost.querySelector = () => nativeTitle;
	titleHost.appendChild(nativeTitle); contentHost.appendChild(nativeContent);
	let closeCount = 0, triggerCount = 0;
	drawer.querySelector = selector => ({ '.trakt-drawer-title': titleHost, '.trakt-drawer-content': contentHost,
		'button[aria-label="Close"]': { click() { closeCount++; nativeOpen = false; drawer.isConnected = false; } } })[selector];
	nativeContent.closest = () => drawer;
	const location = { pathname: '/shows/supernatural', search: '' };
	const trigger = { click() { triggerCount++; nativeOpen = true; location.search = '?view=ratings'; observers.at(-1).callback(); } };
	const observers = [];
	class MutationObserver {
		constructor(callback) { this.callback = callback; observers.push(this); }
		observe() { this.connected = true; } disconnect() { this.connected = false; }
	}
	const context = vm.createContext({ URL, URLSearchParams, MutationObserver, CineTraktExtensionProtocol: { MESSAGE_TYPES },
		CineTraktEpisodeRatings: require('../episode-rating-utils.js'), CineTraktRatingUtils: require('../rating-utils.js'),
		CineTraktSeasonRatings: require('../season-rating-utils.js'),
		CineTraktSeasonCards: { ...require('../trakt-season-cards.js'), readWatched: async () => watched },
		chrome: { runtime: { sendMessage(message, reply) { (message.type === MESSAGE_TYPES.GET_SHOW_SEASON_RATINGS ? posterRequests : requests).push({ message, reply }); } } },
		window: { location, clearTimeout: id => timers.delete(id), setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
			addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name) },
		document: { head: node(), body: node(), createElement: node, getElementById: () => true,
			addEventListener: (name, callback) => events.set(`document:${name}`, callback), removeEventListener: name => events.delete(`document:${name}`),
			querySelector: selector => selector === 'a[aria-label="View ratings breakdown"]' ? trigger : nativeOpen ? nativeContent : null },
	});
	vm.runInContext(read('trakt-imdb-panel.js'), context);
	const panel = context.CineTraktImdbPanel;
	return { panel, location, nodes, timers, events, observers, drawer, nativeTitle, nativeContent, requests, posterRequests,
		get triggerCount() { return triggerCount; }, get closeCount() { return closeCount; },
		status: () => nodes.filter(n => n.className === 'cinetrakt-imdb-panel-status' && n.isConnected).at(-1),
	};
}

test('the ratings panel uses the native drawer and heading, with no popup link or toolbar', () => {
	const f = fixture();
	assert.equal(f.panel.open('tt0460681/../other'), false);
	assert.equal(f.triggerCount, 0);
	assert.equal(f.panel.open('tt0460681'), true);
	assert.equal(f.triggerCount, 1);
	assert.equal(f.requests[0].message.type, MESSAGE_TYPES.GET_IMDB_EPISODES);
	assert.equal(f.requests[0].message.imdbId, 'tt0460681');
	assert.equal(f.nodes.some(n => n.tag === 'iframe'), false);
	assert.equal(f.nodes.some(n => n.textContent === 'Ouvrir dans la fenêtre IMDb'), false);
	const heading = f.nodes.find(n => n.textContent === 'IMDb Ratings');
	assert.ok(heading.classList.contains('ellipsis'));
	f.panel.open('tt0460681');
	assert.equal(f.triggerCount, 1);
	assert.equal(f.nativeTitle.isConnected, true); assert.equal(f.nativeContent.isConnected, true);
});

test('season header styling cannot resize the separate summary chart', () => {
	const source = read('trakt-imdb-panel.js');
	assert.doesNotMatch(source, /\.cinetrakt-season-card\b/);
	assert.match(source, /\.cinetrakt-imdb-season-card\s*\{/);
});

test('the table transposes seasons and episodes with correct links, averages and shared rating colors', () => {
	const f = fixture(); f.panel.open('tt0460681', () => {});
	f.requests[0].reply({ ok: true, data: { imdbId: 'tt0460681', complete: true, totalEpisodes: 3, episodes: [
		{ season: 2, episode: 1, imdbId: 'tt1000003', rating: 9.2 },
		{ season: 1, episode: 2, imdbId: 'tt1000002', rating: 8.2 },
		{ season: 1, episode: 1, imdbId: 'tt1000001', rating: 7.8 },
	] } });
	const table = f.nodes.find(n => n.tag === 'table');
	assert.ok(table.innerHTML.indexOf('Season 1') < table.innerHTML.indexOf('Season 2'));
	assert.match(table.innerHTML, /data-season-poster="1"/);
	assert.ok(table.innerHTML.indexOf('Moyenne<br>par saison') < table.innerHTML.indexOf('E1'));
	assert.match(table.innerHTML, /<th scope="col" aria-label="Épisodes"><\/th>/);
	assert.doesNotMatch(table.innerHTML, />Épisode<|>Moy\.</);
	assert.match(table.innerHTML, /cinetrakt-episode-average" style="color:#ec4899;">8<\/td>/);
	assert.match(table.innerHTML, /Saison 2, épisode 1 : 9.2/);
	assert.match(table.innerHTML, /https:\/\/www.imdb.com\/title\/tt1000003\//);
	assert.match(table.innerHTML, /background:#8b5cf6;color:#ffffff/);
	assert.match(table.innerHTML, /Aucun épisode/);
	assert.equal(f.status().hidden, true);
});

test('season posters can arrive before or after IMDb data without resetting the table, and never attach to the wrong season', () => {
	for (const postersFirst of [false, true]) {
		const f = fixture(); f.panel.open('tt0460681');
		const data = { imdbId: 'tt0460681', complete: true, totalEpisodes: 2, episodes: [
			{ season: 1, episode: 1, imdbId: 'tt1000001', rating: 8 }, { season: 9, episode: 1, imdbId: 'tt1000009', rating: 9 },
		] };
		const posters = { 9: 'https://media.trakt.tv/images/seasons/000/004/807/posters/thumb/ninth.jpg',
			1: 'https://media.trakt.tv/images/seasons/000/004/801/posters/thumb/first.jpg' };
		const coverReply = () => f.posterRequests[0].reply({ ok: true, posters });
		if (postersFirst) coverReply();
		f.requests[0].reply({ ok: true, data });
		const table = f.nodes.find(n => n.tag === 'table');
		if (!postersFirst) coverReply();
		assert.equal(f.nodes.filter(n => n.tag === 'table').length, 1);
		for (const slot of table.querySelectorAll()) assert.equal(slot.querySelector('img').src, posters[slot.dataset.seasonPoster]);
		assert.equal(f.posterRequests.length, 1, 'one shared request covers every season');
	}
});

test('season cards combine exact season names, native links and watched counts without rebuilding the ratings', async () => {
	const f = fixture(new Map([[1, 12], [2, 4]])); f.panel.open('tt0460681');
	f.posterRequests[0].reply({ ok: true, details: { 1: { title: 'Murder House', aired: 12 },
		2: { title: 'Asylum', aired: 13 }, 3: { title: '<script>literal text</script>', aired: 10 } } });
	f.requests[0].reply({ ok: true, data: { imdbId: 'tt0460681', complete: true, totalEpisodes: 3,
		episodes: [1, 2, 3].map(season => ({ season, episode: 1, imdbId: `tt100000${season}`, rating: 8 })) } });
	await new Promise(setImmediate);
	const table = f.nodes.find(n => n.tag === 'table');
	assert.match(table.innerHTML, /href="\/shows\/supernatural\?season=2&view=seasons"/);
	assert.doesNotMatch(table.innerHTML, /<script>/);
	const slots = table.querySelectorAll();
	assert.equal(slots[0].closest().querySelector('.cinetrakt-imdb-season-card-subtitle').textContent, 'Murder House');
	for (const [index, expected] of ['watched', 'partial', ''].entries()) {
		const badge = slots[index].closest().querySelector('.cinetrakt-season-watched');
		assert.equal(badge.dataset.indicator, expected); assert.equal(badge.hidden, !expected);
	}
	assert.equal(f.nodes.filter(n => n.tag === 'table').length, 1);
	f.panel.cleanup();
});

test('leaving the panel cancels pending collection and ignores late data', () => {
	const f = fixture(); f.panel.open('tt0460681', () => assert.fail('no unsolicited popup'));
	f.location.pathname = '/shows/another-series'; f.panel.sync();
	assert.equal(f.requests[1].message.type, MESSAGE_TYPES.CANCEL_IMDB_EPISODES);
	f.requests[0].reply({ ok: false });
	assert.equal(f.nodes.some(n => n.tag === 'table'), false);
	assert.equal(f.drawer.classList.contains('cinetrakt-imdb-panel-active'), false);
	assert.equal(f.nativeContent.isConnected, true); assert.equal(f.nativeTitle.isConnected, true);
	assert.ok(f.observers.every(o => !o.connected)); assert.equal(f.events.size, 0); assert.equal(f.timers.size, 0);
});

test('normal native arrow clicks and disabling the feature restore Trakt ratings without closing its drawer', () => {
	for (const restore of [f => f.panel.sync(false), f => {
		f.events.get('document:click')({ isTrusted: true, target: { closest: () => ({}) } });
	}]) {
		const f = fixture(); f.panel.open('tt0460681', () => {}); restore(f);
		assert.equal(f.drawer.classList.contains('cinetrakt-imdb-panel-active'), false);
		assert.equal(f.closeCount, 0); assert.equal(f.nativeContent.isConnected, true);
	}
});

test('unavailable data offers a manual retry without opening or retrying another page automatically', () => {
	const f = fixture(); f.panel.open('tt0460681', () => assert.fail('must remain opt-in'));
	f.requests[0].reply({ ok: false, error: 'verification' });
	assert.match(f.status().textContent, /vérification/);
	assert.equal(f.requests.length, 1);
	f.nodes.find(n => n.textContent === 'Réessayer').click();
	assert.equal(f.requests.length, 2);
});
