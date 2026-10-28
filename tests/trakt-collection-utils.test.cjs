const test = require('node:test');
const assert = require('node:assert/strict');
require('../trakt-collection-utils.js');
const { isOfficialMovieCollection, findUniqueOfficialMovieCollection } = globalThis.CineTraktCollectionUtils;

const official = (slug, title) => ({
	href: `/lists/official/${slug}?mode=media`, title, variant: 'official', owner: '@Trakt',
});

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
	const scripts = manifest.content_scripts.find((entry) => entry.matches.includes('https://app.trakt.tv/*') && entry.run_at === 'document_idle').js;
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
		body, scrollingElement: { scrollTop: 0 }, querySelectorAll: () => wrapperReady ? [wrapper] : [],
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
