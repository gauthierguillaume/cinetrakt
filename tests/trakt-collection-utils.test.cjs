const test = require('node:test');
const assert = require('node:assert/strict');
const { isOfficialMovieCollection, findUniqueOfficialMovieCollection, collectionPath, collectionNavigation } = require('../trakt-collection-utils.js');
const official = (slug, title) => ({ href: `/lists/official/${slug}?mode=media`, title, variant: 'official', owner: '@Trakt' });

test('Fellowship selects its collection after the more popular editorial list', () => {
	const editorial = official('1001-movies-you-must-see-before-you-die', '1001 Movies You Must See Before You Die');
	const collection = official('the-lord-of-the-rings-collection', 'The Lord of the Rings Collection');
	const afi = official('afi-s-100-years-100-movies-10th-anniversary-edition', "AFI's 100 Years... 100 Movies (10th Anniversary Edition)");
	assert.equal(findUniqueOfficialMovieCollection([editorial, collection, afi]), collection);
	assert.equal(findUniqueOfficialMovieCollection([afi, editorial, collection]), collection);
	assert.equal(findUniqueOfficialMovieCollection([editorial, afi]), null);
});

test('collections require an official Trakt identity and a collection title and path', () => {
	const collection = official('spider-man-mcu-collection', 'Spider-Man (MCU) Collection');
	assert.equal(isOfficialMovieCollection(collection), true);
	assert.equal(isOfficialMovieCollection({ ...collection, href: 'https://app.trakt.tv/lists/official/spider-man-mcu-collection/' }), true);
	for (const override of [
		{ href: '/lists/users/trakt/lists/spider-man-mcu-collection' },
		{ href: 'https://other.example/lists/official/spider-man-mcu-collection' },
		{ href: '/lists/official/spider-man-mcu-collection/items' },
		{ href: '/lists/official/some-popular-list' },
		{ title: 'Collection of 1001 Movies' }, { owner: '@OtherTrakt' },
		{ variant: 'personal' }, { owner: '' }, { href: null },
	]) assert.equal(isOfficialMovieCollection({ ...collection, ...override }), false, JSON.stringify(override));
});

test('Conjuring accepts the numeric ID suffix of its official collection', () => {
	const collection = official('the-conjuring-collection-745170', 'The Conjuring Collection');
	const editorial = official('1001-movies-you-must-see-before-you-die', '1001 Movies You Must See Before You Die');
	assert.equal(isOfficialMovieCollection(collection), true);
	assert.equal(isOfficialMovieCollection({ ...collection, href: 'https://trakt.tv/lists/official/the-conjuring-collection-745170/' }), true);
	assert.equal(findUniqueOfficialMovieCollection([editorial, collection]), collection);
	for (const override of [
		{ href: '/lists/official/the-conjuring-collection-editorial' },
		{ href: '/lists/official/the-conjuring-collection-745170/items' },
		{ href: '/lists/official/the-conjuring-collection-745170-extra' },
		{ owner: '@OtherUser' }, { variant: 'personal' },
		{ title: '1001 Movies You Must See Before You Die' },
	]) assert.equal(isOfficialMovieCollection({ ...collection, ...override }), false, JSON.stringify(override));
});

test('missing or ambiguous collections never fall back to another list', () => {
	assert.equal(findUniqueOfficialMovieCollection([]), null);
	const first = official('the-lord-of-the-rings-collection', 'The Lord of the Rings Collection');
	const second = official('another-collection', 'Another Collection');
	assert.equal(findUniqueOfficialMovieCollection([first, second]), null);
	assert.equal(findUniqueOfficialMovieCollection([first, { ...first, href: `${first.href}&page=2` }]), first);
});

test('collection selection is loaded before the Trakt customization script', () => {
	const manifest = require('../manifest.json');
	const scripts = manifest.content_scripts.find((entry) => entry.matches.includes('https://app.trakt.tv/*') && entry.run_at === 'document_end').js;
	assert.ok(scripts.indexOf('trakt-collection-utils.js') >= 0);
	assert.ok(scripts.indexOf('trakt-collection-utils.js') < scripts.indexOf('trakt-customizations.js'));
});

function collectionPreloadFixture({ wrapperReady = true } = {}) {
	const fs = require('node:fs');
	const path = require('node:path');
	const vm = require('node:vm');
	class Element {
		constructor() { this.children = []; this.parentNode = null; this.style = {}; this.attrs = new Map(); }
		get isConnected() { return this === body || Boolean(this.parentNode?.isConnected); }
		appendChild(child) {
			child.remove(); child.parentNode = this; this.children.push(child); return child;
		}
		insertBefore(child, anchor) {
			child.remove(); child.parentNode = this; this.children.splice(this.children.indexOf(anchor), 0, child);
		}
		remove() {
			if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
			this.parentNode = null;
		}
		getAttribute(name) { return this.attrs.get(name) ?? null; }
		setAttribute(name, value) { this.attrs.set(name, value); }
		removeAttribute(name) { this.attrs.delete(name); }
	}
	const body = new Element();
	const nativeParent = body.appendChild(new Element());
	const before = nativeParent.appendChild(new Element());
	const renderFor = nativeParent.appendChild(new Element());
	const after = nativeParent.appendChild(new Element());
	renderFor.setAttribute('style', 'display: contents; --native-value: 1');
	const wrapper = new Element();
	wrapper.setAttribute('style', '--height-list: var(--height-lists-list)');
	wrapper.closest = () => renderFor;
	const cards = [];
	wrapper.querySelectorAll = () => cards;
	const timers = new Map(); let nextTimer = 0;
	const listeners = new Map(); const observers = []; const scheduled = [];
	const document = {
		body, addEventListener() {}, scrollingElement: { scrollTop: 0 }, querySelectorAll: () => wrapperReady ? [wrapper] : [],
		querySelector: () => wrapperReady ? wrapper : null,
		createElement: () => new Element(), createComment: () => new Element(),
	};
	const context = vm.createContext({ document, window: {
		setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
		clearTimeout(id) { timers.delete(id); },
		addEventListener(type, callback) { listeners.set(type, callback); },
		removeEventListener(type) { listeners.delete(type); },
	}, MutationObserver: class {
		constructor(callback) { this.callback = callback; this.connected = false; observers.push(this); }
		observe() { this.connected = true; }
		disconnect() { this.connected = false; }
	}, CineTraktTraktRuntime: { schedule: (reason) => scheduled.push(reason) } });
	const source = fs.readFileSync(path.join(__dirname, '../trakt-customizations.js'), 'utf8');
	vm.runInContext(`let cinetraktCollectionRenderProbe = null; let cinetraktCollectionProbeAttemptedRoute = ''; let cinetraktCollectionDiscoveryObserver = null;
		${source.slice(source.indexOf('function restoreCinetraktCollectionRenderProbe()'), source.indexOf('function restoreCinetraktOfficialCollectionCard()'))}
		globalThis.probe = { start: primeCinetraktPopularListsRendering, restore: restoreCinetraktCollectionRenderProbe };`, context);
	return { probe: context.probe, body, nativeParent, renderFor, before, after, timers, cards, listeners, observers, scheduled, document,
		mountWrapper() { wrapperReady = true; },
		card(loaded) { const card = { loaded, querySelector() { return this.loaded ? {} : null; } }; cards.push(card); return card; },
		flushMutations() { for (const observer of observers) if (observer.connected) observer.callback(); },
		advance(ms) { for (const timer of [...timers.values()]) if (timer.delay <= ms) timer.callback(); },
	};
}

test('collection preloading restores the native list position and style after success, route change or timeout', () => {
	const { probe, body, nativeParent, renderFor, before, after, timers, observers, listeners, advance } = collectionPreloadFixture();
	probe.start('/movies/poltergeist-1982');
	const hiddenProbe = body.children[1];
	assert.equal(renderFor.parentNode, hiddenProbe);
	assert.equal(nativeParent.children.length, 3);
	probe.start('/movies/poltergeist-1982');
	assert.equal(body.children.length, 2);
	probe.restore();
	assert.deepEqual(nativeParent.children, [before, renderFor, after]);
	assert.equal(renderFor.getAttribute('style'), 'display: contents; --native-value: 1');
	assert.equal(body.children.length, 1);
	assert.equal(timers.size, 0);
	probe.start('/movies/the-conjuring-2013');
	probe.start('/movies/another-film');
	assert.equal(body.children.length, 2);
	assert.equal(timers.size, 1);
	advance(8000);
	assert.deepEqual(nativeParent.children, [before, renderFor, after]);
	assert.equal(body.children.length, 1);
	assert.equal(timers.size, 0);
	assert.equal(listeners.size, 0);
	assert.ok(observers.every((observer) => !observer.connected));
});

test('Nikita releases its popular lists immediately once cards render, even without a collection', () => {
	const fixture = collectionPreloadFixture();
	fixture.card(true); const deferred = fixture.card(false);
	fixture.probe.start('/movies/nikita-1990');
	assert.notEqual(fixture.renderFor.parentNode, fixture.nativeParent);
	deferred.loaded = true; fixture.flushMutations();
	assert.equal(fixture.renderFor.parentNode, fixture.nativeParent);
	assert.equal(fixture.body.children.length, 1);
	assert.equal(fixture.timers.size, 0);
	assert.deepEqual(fixture.scheduled, ['collection-preload-finished']);
	fixture.probe.start('/movies/nikita-1990');
	assert.equal(fixture.body.children.length, 1, 'already rendered lists never need to be hidden');
});

test('scrolling restores the native list immediately instead of waiting for preloading', () => {
	const fixture = collectionPreloadFixture(); fixture.card(false);
	fixture.probe.start('/movies/nikita-1990');
	fixture.listeners.get('scroll')({ type: 'scroll', target: fixture.document });
	assert.notEqual(fixture.renderFor.parentNode, fixture.nativeParent, 'initial page layout does not cancel preloading');
	fixture.document.scrollingElement.scrollTop = 100;
	fixture.listeners.get('scroll')({ type: 'scroll', target: fixture.document });
	assert.equal(fixture.renderFor.parentNode, fixture.nativeParent);
	assert.equal(fixture.timers.size, 0);
	assert.equal(fixture.listeners.size, 0);
	fixture.probe.start('/movies/nikita-1990');
	assert.equal(fixture.body.children.length, 1, 'no repeated probe without new cards');
});

test('popular lists mounting after the summary trigger a new collection update', () => {
	const fixture = collectionPreloadFixture({ wrapperReady: false });
	fixture.probe.start('/movies/poltergeist-1982');
	assert.equal(fixture.body.children.length, 1);
	assert.equal(fixture.observers.length, 1);
	fixture.flushMutations();
	assert.equal(fixture.scheduled.length, 0);
	fixture.mountWrapper(); fixture.flushMutations();
	assert.deepEqual(fixture.scheduled, ['collection-row-ready']);
	assert.equal(fixture.observers[0].connected, false);
	fixture.probe.start('/movies/poltergeist-1982');
	assert.notEqual(fixture.renderFor.parentNode, fixture.nativeParent);
});

test('late native cards finish preloading without scrolling and carousel scrolls do not cancel it', () => {
	const fixture = collectionPreloadFixture();
	fixture.probe.start('/movies/poltergeist-1982');
	fixture.advance(2000);
	assert.notEqual(fixture.renderFor.parentNode, fixture.nativeParent);
	const deferred = fixture.card(false);
	fixture.listeners.get('scroll')({ type: 'scroll', target: fixture.renderFor });
	assert.notEqual(fixture.renderFor.parentNode, fixture.nativeParent);
	deferred.loaded = true; fixture.flushMutations();
	assert.equal(fixture.renderFor.parentNode, fixture.nativeParent);
});


test('collection frame URLs are canonical and restricted to official collections on Trakt', () => {
	assert.equal(collectionPath('/lists/official/the-conjuring-collection-745170/?page=2'), '/lists/official/the-conjuring-collection-745170');
	assert.equal(collectionPath('https://trakt.tv/lists/official/halloween-collection'), '/lists/official/halloween-collection');
	for (const href of [null, '/lists/personal/halloween-collection', 'https://evil.test/lists/official/halloween-collection',
		'javascript:alert(1)', '/movies/halloween-1978', '/lists/official/1001-movies']) assert.equal(collectionPath(href), '');
});

test('normal movie links navigate the main page while modified clicks and native menu actions remain native', () => {
	const click = { button: 0 };
	assert.equal(collectionNavigation('/movies/friday-the-13th-part-2-1981', click), '/movies/friday-the-13th-part-2-1981');
	for (const event of [{ button: 1 }, { button: 2 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true },
		{ button: 0, shiftKey: true }, { button: 0, altKey: true }]) assert.equal(collectionNavigation('/movies/test', event), '');
	for (const href of [null, '#menu', '/users/me/watchlist', 'https://evil.test/movies/test', 'javascript:alert(1)']) {
		assert.equal(collectionNavigation(href, click), '');
	}
});


function nativeCollectionFixture({ relatedLinkReady = true, collectionReady = true } = {}) {
	const vm = require('node:vm'); const fs = require('node:fs');
	const timers = new Map(), observers = [], frames = [], navigation = [], counts = [], animation = [], windowListeners = new Map(), parentListeners = new Map(), dismissals = [];
	let id = 0, menuOpen = false; const drawers = [];
	function element(tagName = 'DIV') {
		const classes = new Set(), listeners = new Map();
		return { tagName, dataset: {}, children: [], style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } }, isConnected: true, listeners,
			getBoundingClientRect: () => ({ width: 143.4, height: 243.1 }),
			classList: { add: x => classes.add(x), contains: x => classes.has(x), toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } },
			matches: () => false, querySelector: () => null,
			setAttribute(key, value) { this[key] = value; },
			append(...nodes) { nodes.forEach(x => this.appendChild(x)); },
			appendChild(node) { this.children.push(node); node.parentElement = this; }, prepend(node) { this.children.unshift(node); node.parentElement = this; },
			addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type),
			remove() { this.isConnected = false; }, click() { navigation.push(this.href); },
		};
	}
	const list = element(); list.querySelector = () => null; list.querySelectorAll = selector => selector.includes('trakt-default-media-item') ? Array.from({ length: 12 }, () => ({})) : [];
	list.getBoundingClientRect = () => ({ bottom: 474 });
	const grid = element(); grid.querySelector = selector => selector.includes('trakt-list-item-container') ? list : null;
	const body = element('BODY'), main = element('MAIN'), chrome = element();
	body.appendChild(main); main.append(grid, chrome);
	const frameDocument = { URL: 'https://app.trakt.tv/movies/friday-the-13th-1980', body,
		head: element('HEAD'), documentElement: element('HTML'), getElementById: () => null, createElement: element,
		querySelector: selector => selector.startsWith('a[href=') ? (relatedLinkReady ? { closest: () => grid } : null) : selector.startsWith('svelte-css-wrapper') ? grid : selector.includes('[aria-modal="true"]') ? (selector.includes('.trakt-drawer') ? drawers[0] || null : null) : menuOpen ? {} : null,
		querySelectorAll: selector => selector.includes('.trakt-drawer') ? drawers : selector === '#trakt-portal-underlay' ? drawers.map((_, index) => ({ click: () => dismissals.push(index) })) : [],
		listeners: new Map(), addEventListener(type, callback) { this.listeners.set(type, callback); },
		removeEventListener(type) { this.listeners.delete(type); },
	};
	const host = element();
	let hostTop = 200;
	host.getBoundingClientRect = () => ({ left: 80, top: hostTop, width: 1200, height: parseFloat(host.style.height) || 260 });
	const document = { body: element('BODY'), addEventListener: (type, fn) => parentListeners.set(type, fn), removeEventListener: type => parentListeners.delete(type), createElement(tag) { const node = element(tag.toUpperCase());
		if (tag === 'iframe') { node.contentDocument = frameDocument; if (collectionReady) node.dataset.cinetraktCollectionIds = Array.from({ length: 12 }, (_, i) => i + 1).join(','); frames.push(node); } return node; } };
	const context = vm.createContext({ URL, document, crypto: { randomUUID: () => 'abcd-1234' }, indexedDB: { deleteDatabase() {} },
		CineTraktTraktImdbResolver: { TRAKT_API_CLIENT_ID: 'public-client' },
		CineTraktCollectionUtils: require('../trakt-collection-utils.js'),
		window: { location: { origin: 'https://app.trakt.tv' }, innerHeight: 900, innerWidth: 1600,
			addEventListener: (type, fn) => windowListeners.set(type, fn), removeEventListener: type => windowListeners.delete(type),
			setTimeout(callback) { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key),
			requestAnimationFrame: callback => animation.push(callback),
		},
		MutationObserver: class { constructor(callback) { this.kind = 'mutation'; this.callback = callback; observers.push(this); }
			observe() { this.active = true; } disconnect() { this.active = false; } },
		ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); }
			observe() { this.active = true; } disconnect() { this.active = false; } },
	});
	vm.runInContext(fs.readFileSync(require.resolve('../trakt-collection-section.js'), 'utf8'), context);
	return { host, frames, frameDocument, grid, chrome, timers, observers, counts, navigation, windowListeners, parentListeners, dismissals,
		mount: href => context.CineTraktCollectionSection.mount({ host, href, title: 'Friday the 13th Collection', moviePath: '/movies/friday-the-13th-1980', onCount: n => counts.push(n) }),
		menu(open) { menuOpen = open; observers.find(x => x.kind === 'mutation').callback(); while (animation.length) animation.shift()(); },
		scrollTo(top) { hostTop = top; windowListeners.get('scroll')?.(); },
		drawerCount(count, flush = true) { drawers.length = 0; for (let i = 0; i < count; i++) drawers.push({ tagName: 'DIV', className: 'trakt-drawer', getBoundingClientRect: () => ({ width: 400, height: 900 }) });
			observers.find(x => x.kind === 'mutation').callback(); if (flush) while (animation.length) animation.shift()(); },
	};
}

test('native collection keeps the live movie grid, hides surrounding page chrome and sizes without an inner scrollbar', () => {
	const f = nativeCollectionFixture(); f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')();
	assert.equal(frame.src, 'https://app.trakt.tv/movies/friday-the-13th-1980');
	assert.equal(f.grid.classList.contains('cinetrakt-native-collection-grid'), true);
	assert.equal(f.chrome.classList.contains('cinetrakt-collection-frame-hidden'), true);
	assert.equal(f.chrome.style.display, 'none'); assert.match(f.frameDocument.head.children[0].textContent, /^@layer cinetraktCollection/);
	assert.equal(f.frameDocument.documentElement.style['--width-portrait-card'], '143.4px');
	assert.equal(f.frameDocument.documentElement.style['--height-portrait-card-sm'], '243.1px');
	assert.deepEqual(f.counts, [12]); assert.equal(f.host.style.height, '482px'); assert.equal(frame.style.height, '800px'); assert.equal(frame.style.clipPath, 'inset(0 0 318px 0)');
	assert.equal(f.timers.size, 0);
	f.menu(true); assert.equal(frame.style.height, '800px', 'native menu portals have room without shifting following sections');
	assert.equal(f.host.style.height, '482px'); f.menu(false); assert.equal(frame.style.height, '800px'); assert.equal(frame.style.clipPath, 'inset(0 0 318px 0)');
});

test('native collection navigation does not swallow menu buttons and cleanup cancels pending work', () => {
	const f = nativeCollectionFixture(); const dispose = f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')();
	const click = f.frameDocument.listeners.get('click'); let stopped = 0;
	click({ button: 0, target: { closest: () => null }, preventDefault() { throw Error('menu swallowed'); } });
	click({ button: 0, target: { closest: () => ({ getAttribute: () => '/movies/friday-the-13th-part-2-1981' }) },
		preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
	assert.equal(stopped, 2); assert.deepEqual(f.navigation, ['/movies/friday-the-13th-part-2-1981']);
	dispose(); assert.equal(frame.isConnected, false); assert.equal(f.timers.size, 0);
	assert.ok(f.observers.every(x => !x.active)); assert.equal(f.frameDocument.listeners.size, 0);
});

test('blocked, invalid or late collection documents retain a plain list link without injecting into another page', () => {
	const f = nativeCollectionFixture(); f.mount('https://evil.test/lists/official/friday-the-13th-collection'); assert.equal(f.frames.length, 0);
	const dispose = f.mount('/lists/official/friday-the-13th-collection');
	f.frameDocument.URL = 'https://app.trakt.tv/users/login'; f.frames[0].listeners.get('load')();
	assert.equal(f.observers.length, 1, 'only the parent sizing observer is registered');
	[...f.timers.values()][0](); assert.equal(f.host.children[1].textContent, 'Afficher les films de la collection');
	dispose(); assert.equal(f.timers.size, 0);
	f.frames[0].listeners.get('load')?.(); assert.equal(f.observers.length, 1, 'only the parent sizing observer is registered');
});



function nativeFeedFixture({ top = false, marked = true } = {}) {
	const fs = require('node:fs'); const vm = require('node:vm'); const calls = [], databases = [];
	const frame = { dataset: { cinetraktCollectionMovie: marked ? '/movies/friday-the-13th-1980' : '',
		cinetraktNativeCollection: '/lists/official/friday-the-13th-collection',
		cinetraktCollectionCache: 'cinetrakt-collection-view-abcd-1234', cinetraktCollectionApiKey: 'public-client' } };
	class IDBFactory { open(name) { databases.push(name); return name; } }
	const movies = [{ ids: { trakt: 1, slug: 'friday-the-13th-1980' }, title: 'Friday the 13th' },
		{ ids: { trakt: 2, slug: 'friday-the-13th-part-2-1981' }, title: 'Friday the 13th Part 2' }];
	const window = { frameElement: frame, fetch: async (...args) => { calls.push(args); return 'native response'; } };
	window.top = top ? window : {};
	const location = { pathname: '/movies/friday-the-13th-1980', href: 'https://app.trakt.tv/movies/friday-the-13th-1980' };
	vm.runInNewContext(fs.readFileSync(require.resolve('../trakt-collection-native.js'), 'utf8'), {
		window, location, IDBFactory, URL, Response,
		CineTraktCollectionUtils: { ...require('../trakt-collection-utils.js'), createCollectionLoader(options) {
			assert.equal(options.apiKey, 'public-client'); return async () => movies;
		} },
	});
	return { window, frame, calls, movies, open: name => new IDBFactory().open(name), databases };
}

test('only the marked embedded Related Movies receives the collection; main-page requests and other APIs stay native', async () => {
	const f = nativeFeedFixture();
	const response = await f.window.fetch('https://api.trakt.tv/movies/friday-the-13th-1980/related?limit=20');
	assert.deepEqual(await response.json(), f.movies); assert.equal(response.headers.get('x-pagination-page-count'), '1');
	assert.equal(f.frame.dataset.cinetraktCollectionIds, '1,2'); assert.equal(f.calls.length, 0);
	assert.deepEqual(await (await f.window.fetch('https://apiz.trakt.tv/movies/friday-the-13th-1980/related')).json(), f.movies);
	const init = { method: 'POST', headers: { get authorization() { throw Error('must not inspect authentication'); } } };
	assert.equal(await f.window.fetch('https://api.trakt.tv/sync/watchlist', init), 'native response');
	assert.equal(f.calls[0][1], init);
	await f.window.fetch('https://api.trakt.tv/movies/other/related'); assert.equal(f.calls.length, 2);
	for (const options of [{ top: true }, { marked: false }]) {
		const untouched = nativeFeedFixture(options);
		await untouched.window.fetch('https://api.trakt.tv/movies/friday-the-13th-1980/related'); assert.equal(untouched.calls.length, 1);
		assert.equal(untouched.open('trakt-query'), 'trakt-query');
	}
	assert.equal(f.open('trakt-query'), 'cinetrakt-collection-view-abcd-1234');
	assert.equal(f.open('unrelated-database'), 'unrelated-database');
});

test('movie, collection-title and mixtape links route to the main page while modified clicks stay native', () => {
	assert.equal(collectionNavigation('/lists/official/friday-the-13th-collection', { button: 0 }), '/lists/official/friday-the-13th-collection');
	assert.equal(collectionNavigation('/discover/mixtape?type=movie&picks=1', { button: 0 }), '/discover/mixtape?type=movie&picks=1');
	assert.equal(collectionNavigation('https://evil.test/discover/mixtape?type=movie&picks=1', { button: 0 }), '');
});

test('official collection data is paginated, ordered and passed intact to Trakt with no user credentials', async () => {
	const calls = [];
	const movies = [{ ids: { trakt: 1 }, title: 'First' }, { ids: { trakt: 2 }, title: 'Second' }];
	const load = require('../trakt-collection-utils.js').createCollectionLoader({ apiKey: 'public', fetch: async (url, init) => {
		calls.push({ url, init });
		const body = url.includes('/lists/official/popular') ? [{ ids: { slug: '1001-movies', trakt: 9 }, name: 'Editorial', type: 'official', user: { username: 'Trakt' } },
			{ ids: { slug: 'friday-the-13th-collection', trakt: 7 }, name: 'Friday the 13th Collection', type: 'official', user: { username: 'Trakt' } }]
			: [{ rank: 2, type: 'movie', movie: movies[1] }, { rank: 1, type: 'movie', movie: movies[0] }];
		return new Response(JSON.stringify(body), { headers: { 'x-pagination-page-count': '1' } });
	} });
	const first = load('/movies/friday-the-13th-1980', '/lists/official/friday-the-13th-collection');
	assert.equal(load('/movies/friday-the-13th-1980', '/lists/official/friday-the-13th-collection'), first);
	assert.deepEqual(await first, movies); assert.equal(calls.length, 2); assert.match(calls[1].url, /\/lists\/7\/items\/movies/);
	assert.ok(calls.every(x => x.init.credentials === 'omit' && !('Authorization' in x.init.headers)));
	assert.equal(await load('/users/me', '/lists/official/friday-the-13th-collection'), null);
});


test('the native Related Movies placeholder mounts without scrolling even before its title link exists', () => {
	const f = nativeCollectionFixture({ relatedLinkReady: false });
	f.mount('/lists/official/friday-the-13th-collection'); f.frames[0].listeners.get('load')();
	assert.equal(f.grid.classList.contains('cinetrakt-native-collection-grid'), true);
	assert.equal(f.chrome.style.display, 'none');
	assert.equal(f.frames[0].classList.contains('cinetrakt-collection-frame-ready'), true);
});


test('native Manage Lists div panels occupy the page viewport and restore the collection after their last nested panel closes', () => {
	const f = nativeCollectionFixture(); f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')();
	const initialHeight = f.host.style.height;
	f.drawerCount(1);
	assert.equal(frame.classList.contains('cinetrakt-collection-modal'), true, 'native drawers have neither a dialog role nor an open attribute');
	assert.equal(f.grid.style.visibility, undefined); assert.equal(frame.style.clipPath, 'path("M80 200H1280V682H80Z M1200 0H1600V900H1200Z")');
	assert.equal(f.grid.style.position, 'fixed'); assert.equal(f.grid.style.left, '80px'); assert.equal(f.grid.style.top, '200px');
	assert.equal(f.host.style.height, initialHeight, 'opening the panel does not reflow the movie page underneath');
	f.drawerCount(2); f.drawerCount(1);
	assert.equal(frame.classList.contains('cinetrakt-collection-modal'), true, 'closing a list preview keeps its Manage Lists parent in page mode');
	f.drawerCount(0);
	assert.equal(frame.classList.contains('cinetrakt-collection-modal'), false);
	assert.equal(f.grid.style.position, undefined); assert.equal(frame.style.clipPath, 'inset(0 0 318px 0)');
	assert.equal(f.host.style.height, initialHeight);
});


test('native drawer viewport switches immediately even when the parent animation frame has not run', () => {
	const f = nativeCollectionFixture(); f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')();
	f.drawerCount(1, false);
	assert.equal(frame.dataset.cinetraktCollectionViewport, 'page');
	assert.equal(frame.classList.contains('cinetrakt-collection-modal'), true);
	assert.match(frame.style.clipPath, /^path\(/); assert.equal(f.grid.style.position, 'fixed');
	f.drawerCount(0, false);
	assert.equal(frame.dataset.cinetraktCollectionViewport, 'collection');
	assert.equal(frame.classList.contains('cinetrakt-collection-modal'), false);
	assert.equal(frame.style.clipPath, 'inset(0 0 318px 0)'); assert.equal(f.grid.style.position, undefined);
});

test('the collection follows main-page scrolling while its drawer stays at the viewport edge', () => {
	const f = nativeCollectionFixture(); const dispose = f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')(); f.drawerCount(1);
	f.scrollTo(-150);
	assert.equal(f.grid.style.top, '-150px');
	assert.equal(frame.style.clipPath, 'path("M80 -150H1280V332H80Z M1200 0H1600V900H1200Z")');
	assert.equal(f.host.style.height, '482px');
	dispose(); assert.equal(f.windowListeners.size, 0);
});

test('outside clicks dismiss the top native drawer without swallowing main-page interaction', () => {
	const f = nativeCollectionFixture(); f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')(); f.drawerCount(2);
	f.parentListeners.get('pointerdown')({ target: frame });
	assert.deepEqual(f.dismissals, []);
	f.parentListeners.get('pointerdown')({ target: f.host, preventDefault() { throw Error('main page click swallowed'); } });
	assert.deepEqual(f.dismissals, [1]);
});

test('drawer observation leaves the initial lazy collection unclipped until native cards are ready', () => {
	const f = nativeCollectionFixture({ collectionReady: false });
	f.mount('/lists/official/friday-the-13th-collection');
	const frame = f.frames[0]; frame.listeners.get('load')();
	f.menu(false);
	assert.equal(frame.classList.contains('cinetrakt-collection-frame-ready'), false);
	assert.equal(frame.style.clipPath, 'none', 'the initial 260px viewport must remain intersectable');
	frame.dataset.cinetraktCollectionIds = Array.from({ length: 12 }, (_, i) => i + 1).join(',');
	f.menu(false);
	assert.equal(frame.classList.contains('cinetrakt-collection-frame-ready'), true);
	assert.equal(frame.style.height, '800px');
	assert.equal(frame.style.clipPath, 'inset(0 0 318px 0)');
});
