const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(require.resolve(`../${file}`), 'utf8');

function profileFixture({ top = false, marked = true, path = '/shows/breaking-bad' } = {}) {
	const calls = [];
	const native = query => { calls.push(query); return { media: query, matches: query.includes('1024') }; };
	const window = { frameElement: { dataset: { cinetraktNativeSeasons: marked ? path : '' } }, matchMedia: native };
	window.top = top ? window : {};
	vm.runInNewContext(read('trakt-seasons-native.js'), { window, location: { pathname: path }, EventTarget });
	return { window, native, calls };
}

test('only the marked seasons document mounts the official small-tablet components at desktop width', () => {
	const f = profileFixture();
	assert.equal(f.window.matchMedia('(min-width: 481px) and (max-width: 768px)').matches, true);
	assert.equal(f.window.matchMedia('(max-width: 480px)').matches, false);
	assert.equal(f.window.matchMedia('(min-width: 769px) and (max-width: 1023px)').matches, false);
	assert.equal(f.window.matchMedia('(min-width: 1024px)').matches, false);
	assert.equal(f.calls.length, 0);
	const mouse = '(hover: hover) and (pointer: fine)';
	assert.equal(f.window.matchMedia(mouse).media, mouse); assert.deepEqual(f.calls, [mouse]);
	for (const options of [{ top: true }, { marked: false }, { path: '/movies/a-film' }]) {
		const other = profileFixture(options); assert.equal(other.window.matchMedia, other.native);
	}
});

test('fixed device queries keep normal subscription methods without following actual viewport changes', () => {
	const f = profileFixture(); const q = f.window.matchMedia('(min-width: 1024px)'); let changed = 0;
	const listener = () => changed++; q.addEventListener('change', listener); q.removeEventListener('change', listener);
	q.addListener(listener); q.removeListener(listener);
	assert.equal(q, f.window.matchMedia('(min-width:1024px)')); assert.equal(changed, 0);
});

test('season selection forwards only the same show and respects modified or middle clicks', () => {
	const { seasonNavigation } = require('../trakt-native-section.js');
	const route = '/shows/breaking-bad'; const click = { button: 0 };
	assert.equal(seasonNavigation(`${route}?season=2`, click, route), `${route}?season=2`);
	assert.equal(seasonNavigation(`${route}?season=2&view=seasons`, click, route), `${route}?season=2&view=seasons`);
	for (const href of ['https://evil.test/shows/breaking-bad?season=2', '/shows/another-show?season=2', 'javascript:alert(1)']) assert.equal(seasonNavigation(href, click, route), '');
	for (const event of [{ button: 1 }, { button: 2 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true }]) assert.equal(seasonNavigation(`${route}?season=2`, event, route), '');
});

function controllerFixture({ width = 2200, dropdown = true, episodesReady = true, railRoute = '/shows/breaking-bad' } = {}) {
	const mounts = [], selections = [], listeners = new Map(), observers = []; let disposed = 0;
	function element(tag = 'DIV') {
		const classes = new Set();
		return { tagName: tag, children: [], style: {}, isConnected: true, classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
			setAttribute() {}, appendChild(node) { this.children.push(node); node.parentElement = this; return node; },
			insertBefore(node, target) { const i = this.children.indexOf(target); this.children.splice(i, 0, node); node.parentElement = this; },
			remove() { this.isConnected = false; }, querySelector: () => null,
		};
	}
	const main = element('MAIN'), wrapper = main.appendChild(element()), episodes = wrapper.appendChild(element('SECTION'));
	main.querySelector = () => episodesReady ? episodes : null; episodes.querySelector = selector => selector === 'a[href]' ? { getAttribute: () => `${railRoute}?view=seasons` } : selector === '.trakt-list-inset-title' ? {} : dropdown ? {} : null;
	const document = { body: element('BODY'), documentElement: element('HTML'), createElement: element, querySelector: () => main };
	const window = { innerWidth: width, location: { pathname: '/shows/breaking-bad', search: '?season=1' },
		addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
	const context = vm.createContext({ window, document, URL, URLSearchParams,
		MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() { this.active = true; } disconnect() { this.active = false; } },
		CineTraktNativeSection: { mount(options) { mounts.push(options); const dispose = () => disposed++; dispose.setSeason = value => selections.push(value); return dispose; } },
	});
	vm.runInContext(read('trakt-season-selector.js'), context);
	return { api: context.CineTraktSeasonSelector, window, document, episodes, main, mounts, selections, listeners, observers,
		publishEpisodes(route) { if (route) railRoute = route; episodesReady = true; observers.filter(x => x.active).forEach(x => x.callback()); },
		publishDropdown() { dropdown = true; observers.filter(x => x.active).forEach(x => x.callback()); }, get disposed() { return disposed; } };
}

test('the desktop row is inserted before episodes, reuses its document across season picks and restores native controls on disable', () => {
	const f = controllerFixture(); f.api.update(true);
	assert.equal(f.mounts.length, 1); assert.equal(f.main.children[0].id, 'cinetrakt-season-selector');
	assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), true, 'the old header is hidden from the first layout');
	f.mounts[0].onReady(); assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), true);
	f.window.location.search = '?season=3'; f.api.update(true);
	assert.equal(f.mounts.length, 1); assert.deepEqual(f.selections, ['3']);
	f.api.update(false); assert.equal(f.disposed, 1); assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), false);
	f.mounts[0].onReady(); assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), false, 'a late ready event cannot hide the restored selector');
});

test('mobile and single-season pages keep the existing native selector; route changes and resizing dispose desktop sections', () => {
	for (const options of [{ width: 768 }, { dropdown: false }]) {
		const f = controllerFixture(options); f.api.update(true);
		assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), false);
		assert.equal(f.mounts.length, options.width ? 0 : 1); assert.equal(f.disposed, 0);
		if (!options.width) { f.mounts[0].onUnavailable(); assert.equal(f.disposed, 1); }
	}
	const f = controllerFixture(); f.api.update(true); f.window.innerWidth = 700; f.listeners.get('resize')();
	assert.equal(f.disposed, 1); f.window.innerWidth = 2200; f.listeners.get('resize')(); assert.equal(f.mounts.length, 2);
	f.window.location.pathname = '/movies/a-film'; f.api.update(true); assert.equal(f.disposed, 2);
});

test('seasons preload before the episode rail exists and placement never mounts a second native document', () => {
	const f = controllerFixture({ episodesReady: false }); f.api.update(true);
	assert.equal(f.mounts.length, 1); assert.equal(f.mounts[0].portal, true);
	assert.equal(f.main.children[0].id, undefined);
	assert.equal(f.document.documentElement.classList.contains('cinetrakt-season-posters-enabled'), true);
	f.publishEpisodes();
	assert.equal(f.main.children[0].id, 'cinetrakt-season-selector'); assert.equal(f.main.children[0].hidden, false);
	assert.equal(f.mounts.length, 1); assert.ok(f.observers.every(x => !x.active));
});

test('failed preloads restore native controls and do not restart on every DOM update', () => {
	const f = controllerFixture(); f.api.update(true); f.mounts[0].onUnavailable();
	assert.equal(f.disposed, 1); assert.equal(f.episodes.classList.contains('cinetrakt-season-episodes-replaced'), false);
	assert.equal(f.document.documentElement.classList.contains('cinetrakt-season-posters-enabled'), false);
	f.api.update(true); assert.equal(f.mounts.length, 1);
	f.api.update(false); f.api.update(true); assert.equal(f.mounts.length, 2);
});

test('a late native dropdown does not cancel a valid multi-season preload', () => {
	const f = controllerFixture({ dropdown: false }); f.api.update(true);
	assert.equal(f.main.children[0].id, undefined); assert.equal(f.disposed, 0);
	f.publishDropdown();
	assert.equal(f.main.children[0].id, 'cinetrakt-season-selector'); assert.equal(f.mounts.length, 1); assert.equal(f.disposed, 0);
});

test('SPA transitions do not attach a new show preload to the previous show episode rail', () => {
	const f = controllerFixture({ railRoute: '/shows/previous-show' }); f.api.update(true);
	assert.equal(f.main.children[0].id, undefined); assert.equal(f.mounts.length, 1);
	f.publishEpisodes('/shows/breaking-bad');
	assert.equal(f.main.children[0].id, 'cinetrakt-season-selector'); assert.equal(f.mounts.length, 1);
});

test('watched artwork preference applies at startup and responds live without removing watched state', async () => {
	const classes = new Set(); let changed, resolve, unsubscribed = false;
	const window = { addEventListener(name, fn) { this[name] = fn; } };
	const settings = { getAll: () => ({ traktClearWatchedPosters: true }), ready: new Promise(r => resolve = r),
		onChange(fn) { changed = fn; return () => unsubscribed = true; } };
	vm.runInNewContext(read('trakt-appearance.js'), { window, document: { documentElement: { classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); } } } }, CineTraktSettings: settings });
	assert.equal(classes.has('cinetrakt-clear-watched-posters'), true);
	resolve({ traktClearWatchedPosters: false }); await Promise.resolve(); assert.equal(classes.size, 0);
	changed({ traktClearWatchedPosters: true }); assert.equal(classes.size, 1);
	window.pagehide(); assert.equal(unsubscribed, true);
});
