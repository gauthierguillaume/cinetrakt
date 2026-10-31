const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fanart = require('../trakt-fanart.js');
const url = 'https://media.trakt.tv/images/shows/000/155/534/fanarts/medium/d5270246b5.jpg.webp';
const entry = (image = url, query = 'showSummary:v2', slug = 'slow-horses') => ({
	queryKey: [`query:${query}`, `dependency:${slug}`],
	state: { status: 'success', dataUpdatedAt: Date.now(), data: { cover: { url: { medium: image } } } },
});

test('fanart is tied to the exact film or show and accepts only its official landscape artwork', () => {
	assert.equal(fanart.fanartFromEntry(entry(), '/shows/slow-horses'), url);
	const movie = url.replace('/shows/', '/movies/');
	assert.equal(fanart.fanartFromEntry(entry(movie, 'movieSummary:v2', 'rocky-1976'), '/movies/rocky-1976'), movie);
	for (const route of ['/shows/another-show', '/movies/slow-horses', '/shows/slow-horses/seasons/1', '/home'])
		assert.equal(fanart.fanartFromEntry(entry(), route), '');
	for (const image of [url.replace('media.trakt.tv', 'other.test'), url.replace('/fanarts/', '/posters/'),
		url + '?token=private', url + '#fragment', 'javascript:alert(1)'])
		assert.equal(fanart.fanartFromEntry(entry(image), '/shows/slow-horses'), '');
	assert.equal(fanart.fanartFromEntry(entry(url.replace('/medium/', '/thumb/')), '/shows/slow-horses'), url);
});

test('public artwork remains usable from an older successful summary while Trakt refreshes it', async () => {
	const cached = entry(); const now = cached.state.dataUpdatedAt;
	assert.equal(fanart.fanartFromEntry(cached, '/shows/slow-horses', now + 4 * 3600000), url);
	cached.state.status = 'pending'; assert.equal(fanart.fanartFromEntry(cached, '/shows/slow-horses'), '');
	assert.equal(fanart.fanartFromEntry(entry('https://app.trakt.tv/placeholder.webp'), '/shows/slow-horses'), '');
	assert.equal(fanart.fanartFromEntry(null, '/shows/slow-horses'), '');
	assert.equal(await fanart.readFanart('/shows/slow-horses', null), '');
});

function fixture() {
	const pending = [], nodes = [], timers = new Map(); let nextTimer = 0;
	let posterRight = 738;
	const main = { isConnected: true, children: [], classes: new Set(), appendChild(e) { this.children.push(e); },
		querySelector: () => ({ getBoundingClientRect: () => ({ right: posterRight }) }),
		classList: { add: c => main.classes.add(c), remove: c => main.classes.delete(c) } };
	const body = { children: [], classes: new Set(), appendChild(e) { this.children.push(e); },
		classList: { add: c => body.classes.add(c), remove: c => body.classes.delete(c) } };
	const location = { pathname: '/shows/slow-horses' };
	const context = vm.createContext({ URL, Date, Promise, readTestFanart: () => new Promise(resolve => pending.push(resolve)),
		window: { location, setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) },
		document: { body, head: { appendChild() {} }, getElementById: () => true, querySelector: () => main,
			createElement(tag) { const n = { tag, style: {}, listeners: {}, children: [], removed: false, setAttribute() {}, removeAttribute() {},
					addEventListener(type, fn) { this.listeners[type] = fn; }, appendChild(c) { this.children.push(c); },
					replaceChildren(...children) { this.children = children; }, remove() { this.removed = true; } };
				nodes.push(n); return n; },
		} });
	const source = fs.readFileSync(require.resolve('../trakt-fanart.js'), 'utf8').replace('await readFanart(state.route)', 'await readTestFanart(state.route)');
	vm.runInContext(source, context);
	return { api: context.CineTraktTraktFanart, pending, nodes, timers, main, body, location,
		setPosterRight(value) { posterRight = value; } };
}

test('fanart loads before poster placement, but only appears once the correct content boundary exists', async () => {
	const f = fixture(); f.setPosterRight(Number.NaN);
	f.api.update(true); assert.equal(f.pending.length, 1);
	f.pending[0](url); await new Promise(setImmediate);
	const image = f.nodes.find(n => n.tag === 'img'); image.listeners.load();
	assert.equal(f.body.children.length, 0, 'the backdrop must not flash over the sidebar or poster');
	f.setPosterRight(738); f.api.update(true); f.api.update(true);
	assert.equal(f.body.children.length, 1); assert.equal(f.pending.length, 1);
	assert.equal(f.body.children[0].style.left, '666px', 'the 72px fade ends at the poster edge, before the text');
	assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), true);
});

test('a preloaded TMDB override survives a late native cache result and never touches the native color background', async () => {
	const f = fixture(); f.api.update(true);
	const image = { src: 'https://image.tmdb.org/t/p/original/backdrop.jpg', complete: true, naturalWidth: 3840, removeAttribute() {} };
	assert.equal(f.api.setOverride('/shows/other', image), false);
	assert.equal(f.api.setOverride('/shows/slow-horses', { ...image, src: 'https://evil.test/image.jpg' }), false);
	assert.equal(f.api.setOverride('/shows/slow-horses', image), true);
	assert.equal(f.body.children.length, 1); assert.equal(f.body.children[0].children[0], image);
	f.pending[0](url); await new Promise(setImmediate);
	assert.equal(f.body.children[0].children[0], image, 'the native query must not replace a user-selected backdrop');
	f.api.update(true); assert.equal(f.pending.length, 1);
	f.api.cleanup(); assert.equal(f.body.classes.size, 0);
});

test('an old native image error cannot remove a newer TMDB backdrop', async () => {
	const f = fixture(); f.api.update(true); f.pending[0](url); await new Promise(setImmediate);
	const old = f.nodes.find(n => n.tag === 'img');
	const image = { src: 'https://image.tmdb.org/t/p/original/new.jpg', complete: true, naturalWidth: 1920, removeAttribute() {} };
	assert.equal(f.api.setOverride('/shows/slow-horses', image), true);
	old.listeners.error(); old.listeners.load();
	assert.equal(f.body.children[0].children[0], image);
	assert.equal(f.body.children[0].removed, false);
});

test('late image loads cannot put the previous film behind a new fiche, and disabling removes the artwork', async () => {
	const f = fixture(); f.api.update(true); f.pending[0](url); await new Promise(setImmediate);
	const oldImage = f.nodes.find(n => n.tag === 'img');
	assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), false, 'the native gradient stays until the image loads');
	f.location.pathname = '/movies/rocky-1976'; f.api.update(true);
	oldImage.listeners.load(); assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), false);
	f.pending[1](url.replace('/shows/', '/movies/')); await new Promise(setImmediate);
	const image = f.nodes.filter(n => n.tag === 'img').at(-1); image.listeners.load();
	assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), true);
	assert.equal(f.main.children.length, 0, 'layout containment must not anchor the fixed image to the scrolling content');
	assert.equal(f.body.children.length, 1);
	assert.equal(f.body.children[0].style.left, '666px');
	f.api.update(false);
	assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), false);
	assert.equal(f.body.classes.size, 0);
	assert.ok(f.nodes.filter(n => n.className === 'cinetrakt-detail-fanart').every(n => n.removed));
});

test('image failures settle on the native background and metadata retries are bounded and cancelled', async () => {
	const failed = fixture(); failed.api.update(true); failed.pending[0](url); await new Promise(setImmediate);
	failed.nodes.find(n => n.tag === 'img').listeners.error(); failed.api.update(true);
	assert.equal(failed.pending.length, 1); assert.equal(failed.main.classes.size, 0);
	const f = fixture(); f.api.update(true); f.pending[0](''); await new Promise(setImmediate);
	assert.equal(f.timers.size, 1); f.api.cleanup(); assert.equal(f.timers.size, 0);
	f.api.update(true); f.api.update(true); assert.equal(f.pending.length, 2, 'native mutations never duplicate in-flight reads');
	f.api.cleanup(); f.pending[1](url); await new Promise(setImmediate); assert.equal(f.main.classes.size, 0);
});

test('a summary persisted after the first retries still loads, and a missing image eventually stops polling', async () => {
	const f = fixture(); f.api.update(true);
	for (let i = 0; i < 5; i++) {
		f.pending[i](''); await new Promise(setImmediate);
		const [id, callback] = f.timers.entries().next().value;
		f.timers.delete(id); callback();
	}
	f.pending[5](url); await new Promise(setImmediate);
	f.nodes.find(n => n.tag === 'img').listeners.load();
	assert.equal(f.main.classes.has('cinetrakt-fanart-ready'), true);
	assert.equal(f.timers.size, 0);
	const absent = fixture(); absent.api.update(true);
	for (let i = 0; i < 15; i++) {
		absent.pending[i](''); await new Promise(setImmediate);
		if (i < 14) {
			const [id, callback] = absent.timers.entries().next().value;
			absent.timers.delete(id); callback();
		}
	}
	assert.equal(absent.pending.length, 15); assert.equal(absent.timers.size, 0);
	absent.api.update(true); assert.equal(absent.pending.length, 15);
});
