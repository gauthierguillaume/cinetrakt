const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../tmdb-artwork.js');
globalThis.CineTraktTmdbUtils = require('../tmdb-utils.js');
const resolver = require('../trakt-imdb-resolver.js');
const picture = (file_path, iso_639_1) => ({ file_path, iso_639_1 });

test('posters retain the original Latin-script language, and use English for other scripts', () => {
	for (const [title, language] of [['Amélie', 'fr'], ['Das Leben der Anderen', 'de'], ['La vita è bella', 'it'], ['Supernatural', 'en']])
		assert.equal(api.posterLanguage({ original_title: title, original_language: language }), language);
	for (const title of ['千と千尋の神隠し', '기생충', 'Брат', 'العنوان'])
		assert.equal(api.posterLanguage({ original_title: title, original_language: 'xx' }), 'en');
	assert.equal(api.posterLanguage({ original_name: 'Dix pour cent', original_language: 'fr' }), 'fr');
});

test('catalogs exclude translated posters, language-tagged backdrops and invalid or duplicate image paths', () => {
	const result = api.catalogFromDetails({ original_title: 'Amélie', original_language: 'fr', images: {
		posters: [picture('/fr.jpg', 'fr'), picture('/en.jpg', 'en'), picture('/fr.jpg', 'fr'), picture('/textless.jpg', null)],
		backdrops: [picture('/clean.jpg', null), picture('/title.jpg', 'en'), picture('/unclassified.jpg', undefined),
			picture('//evil.test/image.jpg', null), picture('/private.jpg?token=x', null), picture('/clean.jpg', null)],
	} });
	assert.deepEqual(result, { language: 'fr', posters: ['/fr.jpg'], backdrops: ['/clean.jpg'] });
	assert.deepEqual(api.catalogFromDetails({}).posters, []);
});

test('random pools visit every image before recycling and never immediately repeat the current image', () => {
	const pool = api.createPool(['/a.jpg', '/b.jpg', '/c.jpg', '/a.jpg'], () => .5);
	const selected = []; let last = '';
	for (let i = 0; i < 12; i++) {
		const next = pool.next(last); assert.notEqual(next, last); selected.push(next); last = next;
	}
	for (let i = 0; i < 12; i += 3) assert.equal(new Set(selected.slice(i, i + 3)).size, 3);
	assert.equal(api.createPool([]).next(), '');
	assert.equal(api.createPool(['/only.jpg']).next('/only.jpg'), '');
});

function loaderFixture({ credential = 'api-key', fetch } = {}) {
	let saved = credential, enabled = true, now = 0; const calls = [];
	const loader = api.createLoader({ settings: { ready: Promise.resolve(), getTmdbCredential: () => saved, isEnabled: () => enabled }, resolver,
		now: () => now, fetch: async (url, options) => {
			calls.push({ url, options });
			if (fetch) return fetch(url, options);
			return { ok: true, json: async () => url.startsWith('https://api.trakt.tv/') ? { ids: { tmdb: 1622 } }
				: { id: 1622, original_name: 'Supernatural', original_language: 'en', images: { posters: [picture('/poster.jpg', 'en')] } } };
		} });
	return { loader, calls, setCredential: value => { saved = value; }, disable: () => { enabled = false; }, advance: value => { now += value; } };
}

test('artwork is requested only on demand, by exact TMDB series ID, with no season endpoints or credentials on Trakt', async () => {
	const f = loaderFixture(); assert.equal(f.calls.length, 0);
	const [a, b] = await Promise.all([f.loader('/shows/supernatural'), f.loader('/shows/supernatural')]);
	assert.equal(a.ok, true); assert.deepEqual(a, b); assert.equal(f.calls.length, 2);
	assert.equal(f.calls[0].url, resolver.getTraktApiMediaUrl('/shows/supernatural'));
	assert.equal(f.calls[0].options.headers.Authorization, undefined);
	const tmdb = new URL(f.calls[1].url);
	assert.equal(tmdb.pathname, '/3/tv/1622'); assert.equal(tmdb.searchParams.get('append_to_response'), 'images');
	assert.equal(tmdb.searchParams.get('api_key'), 'api-key'); assert.equal(tmdb.searchParams.has('language'), false);
	assert.ok(f.calls.every(call => call.options.credentials === 'omit' && !call.options.signal.aborted));
	assert.equal(JSON.stringify(a).includes('api-key'), false);
	await f.loader('/shows/supernatural'); assert.equal(f.calls.length, 2);
	f.advance(6 * 3600000 + 1); await f.loader('/shows/supernatural'); assert.equal(f.calls.length, 4);
	f.setCredential('eyJ' + 'a'.repeat(90)); await f.loader('/shows/supernatural');
	assert.equal(new URL(f.calls.at(-1).url).searchParams.has('api_key'), false);
	assert.match(f.calls.at(-1).options.headers.Authorization, /^Bearer eyJ/);
});

test('invalid routes, absent credentials, disabled settings and missing IDs do not cause a TMDB search', async () => {
	const f = loaderFixture();
	assert.equal((await f.loader('/shows/supernatural/seasons/4')).ok, false); assert.equal(f.calls.length, 0);
	f.setCredential(''); assert.equal((await f.loader('/movies/test')).error, 'missing-credential'); assert.equal(f.calls.length, 0);
	f.setCredential('key'); f.disable(); assert.equal((await f.loader('/movies/test')).ok, false); assert.equal(f.calls.length, 0);
	const missing = loaderFixture({ fetch: async () => ({ ok: true, json: async () => ({ ids: { imdb: 'tt123' } }) }) });
	assert.equal((await missing.loader('/movies/test')).error, 'no-id'); assert.equal(missing.calls.length, 1);
	const refused = loaderFixture({ fetch: async () => ({ ok: false, status: 401 }) });
	assert.deepEqual(await refused.loader('/movies/test'), { ok: false, error: 'credential' });
	assert.equal(JSON.stringify(await refused.loader('/movies/test')).includes('api-key'), false);
});

test('movie catalogs use the exact movie endpoint and preserve French original-language posters', async () => {
	const f = loaderFixture({ fetch: async url => ({ ok: true, json: async () => url.startsWith('https://api.trakt.tv/')
		? { ids: { tmdb: 194 } } : { id: 194, original_title: "Le Fabuleux Destin d’Amélie Poulain", original_language: 'fr',
			images: { posters: [picture('/french.jpg', 'fr'), picture('/english.jpg', 'en')] } } }) });
	const result = await f.loader('/movies/amelie-2001');
	assert.equal(new URL(f.calls[1].url).pathname, '/3/movie/194');
	assert.deepEqual(result.posters, ['/french.jpg']);
	assert.equal(result.language, 'fr');
});

test('only the same top-level Trakt fiche can request artwork, including SPA navigation', () => {
	assert.equal(api.isAllowedRequest('/shows/silo', { frameId: 0, tab: { url: 'https://app.trakt.tv/shows/silo?season=4' }, url: 'https://app.trakt.tv/home' }), true);
	for (const sender of [{ frameId: 1, url: 'https://app.trakt.tv/shows/silo' },
		{ frameId: 0, url: 'https://evil.example/shows/silo' }, { frameId: 0, url: 'https://app.trakt.tv/shows/other' }])
		assert.equal(api.isAllowedRequest('/shows/silo', sender), false);
});

function uiFixture() {
	const messages = [], images = [], timers = new Map(); let timerId = 0;
	const location = { pathname: '/shows/silo' };
	function node(tag) {
		const n = { tag, isConnected: true, children: [], style: {}, attributes: {}, listeners: {},
			setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; if (k === 'src') this.src = ''; },
			appendChild(child) { this.children.push(child); child.parent = this; },
			addEventListener(name, fn) { this.listeners[name] = fn; }, remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); } };
		if (tag === 'img') images.push(n); return n;
	}
	const poster = node('div'); const overrides = [];
	const context = vm.createContext({ window: { location }, Set, Promise,
		setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
		document: { getElementById: () => true, createElement: node, querySelector: () => poster, documentElement: { classList: { contains: () => false } } },
		CineTraktTmdbArtwork: api, CineTraktExtensionProtocol: require('../extension-protocol.js'),
		CineTraktTraktFanart: { setOverride(route, image) { overrides.push({ route, image }); return true; }, cleanup() {}, update() {} },
		chrome: { runtime: { sendMessage(message, respond) { messages.push({ message, respond }); } } },
	});
	vm.runInContext(fs.readFileSync(require.resolve('../trakt-artwork.js'), 'utf8'), context);
	return { api: context.CineTraktTraktArtwork, poster, messages, images, overrides, location, timers,
		click(index) { return poster.children.find(n => n.className === 'cinetrakt-artwork-tools').children[index].listeners.click({ preventDefault() {}, stopPropagation() {} }); } };
}
const settle = () => new Promise(setImmediate);

test('artwork controls fetch nothing until clicked, preserve the native poster and cancel late navigation results', async () => {
	const f = uiFixture(); f.api.update(true); assert.equal(f.messages.length, 0);
	f.click(0); assert.equal(f.messages.length, 1);
	f.messages[0].respond({ ok: true, language: 'en', posters: ['/a.jpg', '/b.jpg'], backdrops: ['/bg.jpg'] }); await settle();
	f.images[0].onload(); await settle();
	assert.equal(f.poster.children.some(n => n.className === 'cinetrakt-poster-variant'), true);
	f.click(1); await settle(); assert.equal(f.messages.length, 1, 'both controls share a catalog');
	f.images[1].onload(); await settle(); assert.equal(f.overrides.length, 1);
	f.click(0); await settle();
	const lateImage = f.images.at(-1); f.location.pathname = '/shows/other'; f.api.update(true);
	assert.equal(lateImage.src, '', 'dispose cancels outstanding image loads'); await settle();
	assert.equal(f.poster.children.some(n => n.className === 'cinetrakt-poster-variant'), false);
	f.api.update(false); assert.equal(f.poster.children.length, 0); assert.equal(f.timers.size, 0);
});
