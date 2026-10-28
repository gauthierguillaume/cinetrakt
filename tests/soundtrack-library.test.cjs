const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const library = require('../trakt-soundtrack-library.js');
const protocol = require('../spotify-protocol.js');
const id = n => String(n).padStart(22, '0');
const entry = (data, slug = 'rocky-1976', type = 'movie') => ({
	queryKey: [`query:${type}Soundtrack`, 'schema:abc', `dependency:${slug}`, 'dependency:en'],
	state: { status: 'success', dataUpdatedAt: Date.now(), data },
});
const rawTracks = Array.from({ length: 19 }, (_, i) => ({ title: `Track ${i + 1}`, performer: 'Artist', spotifyId: i < 14 ? id(i + 1) : null, position: i }));

test('shuffle avoids repeats through each complete cycle, including the boundary, and preserves back/forward history', () => {
	const keys = ['a', 'b', 'c', 'd', 'e'];
	const nav = library.createShuffleHistory(keys, () => 0);
	assert.equal(nav.canPrevious, false); nav.select('a');
	const first = ['a', ...Array.from({ length: 4 }, () => nav.next())];
	assert.equal(new Set(first).size, 5);
	const second = Array.from({ length: 5 }, () => nav.next());
	assert.notEqual(second[0], first.at(-1)); assert.equal(new Set(second).size, 5);
	assert.equal(nav.previous(), second[3]); assert.equal(nav.previous(), second[2]);
	assert.equal(nav.next(), second[3]); assert.equal(nav.next(), second[4]);
	assert.notEqual(nav.next(), second[4]);
});

test('resuming a track adds no history, manual selections join the cycle, and empty/single-song lists cannot skip', () => {
	const nav = library.createShuffleHistory(['a', 'b', 'c', 'd'], () => 0);
	nav.select('a'); nav.select('a'); assert.equal(nav.previous(), null);
	nav.next(); nav.next(); nav.previous(); nav.select('d');
	assert.equal(nav.previous(), 'b'); assert.equal(nav.next(), 'd');
	assert.equal(nav.next(), 'a', 'a manual branch retains the cycle history and rolls over only when all choices were used');
	for (const keys of [[], ['only']]) {
		const single = library.createShuffleHistory(keys); single.select('only');
		assert.equal(single.canNext, false); assert.equal(single.canPrevious, false);
		assert.equal(single.next(), null); assert.equal(single.previous(), null);
	}
});

test('the complete soundtrack includes all 14 playable songs, skips unmatched songs and deduplicates Spotify IDs', () => {
	const data = [...rawTracks, rawTracks[0], { title: 'Invalid', spotifyId: '../bad' }];
	const tracks = library.catalogFromEntry(entry(data), '/movies/rocky-1976');
	assert.equal(tracks.length, 14);
	assert.equal(tracks.at(-1).spotifyId, id(14));
	assert.equal(library.catalogFromEntry(entry(data), '/movies/other-1976').length, 0);
	assert.equal(library.catalogFromEntry(entry(data), '/shows/rocky-1976').length, 0);
	assert.equal(library.catalogFromEntry(entry(data), '/movies/rocky-1976', Date.now() + 13 * 3600000).length, 0);
	assert.equal(library.catalogFromEntry(entry(data, 'series', 'show'), '/shows/series').length, 14);
});

function fakeIdb(values) {
	const reads = []; let closed = 0; let mode; let aborted = false;
	const db = { close() { closed++; }, objectStoreNames: { contains: name => name === 'query-cache' },
		transaction(name, requestedMode) {
			assert.equal(name, 'query-cache'); mode = requestedMode;
			const transaction = { objectStore() { return {
				getAllKeys() { const request = { result: Object.keys(values) }; queueMicrotask(() => {
					request.onsuccess(); queueMicrotask(() => transaction.oncomplete());
				}); return request; },
				get(key) { reads.push(key); const request = { result: values[key] }; queueMicrotask(() => request.onsuccess()); return request; },
			}; }, abort() { aborted = true; } };
			return transaction;
		},
	};
	return { reads, closed: () => closed, mode: () => mode, aborted: () => aborted,
		open(name) { assert.equal(name, 'trakt-query'); const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
}

test('catalog loading reads only the current native soundtrack query and never writes to Trakt storage', async () => {
	const values = { unrelated: { private: 'not read' } };
	const soundtrack = entry(rawTracks); const key = `tanstack-query-${JSON.stringify(soundtrack.queryKey)}`;
	values[key] = soundtrack;
	values[`tanstack-query-${JSON.stringify(entry(rawTracks, 'other').queryKey)}`] = entry(rawTracks, 'other');
	const db = fakeIdb(values);
	assert.equal((await library.readCatalog('/movies/rocky-1976', db)).length, 14);
	assert.deepEqual(db.reads, [key]); assert.equal(db.mode(), 'readonly'); assert.equal(db.closed(), 1);
	assert.deepEqual(await library.readCatalog('/movies/rocky-1976', null), []);
});

class Element {
	constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.children = []; this.attrs = new Map(); this.dataset = {}; this.style = {}; this.listeners = new Map(); this.textContent = ''; }
	get className() { return this.attrs.get('class') || ''; } set className(v) { this.attrs.set('class', v); }
	get classList() { return { contains: c => this.className.split(' ').includes(c), remove: c => this.classList.toggle(c, false), add: c => this.classList.toggle(c, true), toggle: (c, on) => {
		const values = new Set(this.className.split(' ').filter(Boolean)); on ? values.add(c) : values.delete(c); this.className = [...values].join(' ');
	} }; }
	get isConnected() { return this === this.ownerDocument.body || !!this.parentElement?.isConnected; }
	get src() { return this.getAttribute('src') || ''; }
	set src(value) { this.setAttribute('src', value); }
	get previousElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null; }
	getAttribute(n) { return this.attrs.get(n) ?? null; }
	hasAttribute(n) { return this.attrs.has(n); }
	setAttribute(n, v) { this.attrs.set(n, v); if (n === 'src') this.srcWrites = (this.srcWrites || 0) + 1; }
	removeAttribute(n) { this.attrs.delete(n); }
	appendChild(node) { if (node.tagName === 'iframe') node.insertedSrc = node.src; node.remove(); this.children.push(node); node.parentElement = this; return node; }
	append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
	insertBefore(node, ref) { node.remove(); const index = this.children.indexOf(ref); this.children.splice(index < 0 ? this.children.length : index, 0, node); node.parentElement = this; }
	remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
	contains(node) { return node === this || this.children.some(n => n.contains(node)); }
	matches(selector) {
		if (selector.startsWith('section.trakt-soundtrack-section ')) return this.matches(selector.slice(selector.indexOf(' ') + 1))
			&& !!this.parentElement?.closest('section.trakt-soundtrack-section');
		if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
		if (selector.startsWith('svg') || selector.startsWith(':scope')) return false;
		const tag = selector.match(/^[a-z]+/)?.[0]; if (tag && tag !== this.tagName) return false;
		for (const c of selector.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(c[1])) return false;
		if (selector.includes('[type="button"]') && this.type !== 'button') return false;
		if (selector.includes('src*=')) return this.src.includes('open.spotify.com/embed/');
		return true;
	}
	closest(s) { return this.matches(s) ? this : this.parentElement?.closest(s) || null; }
	querySelectorAll(s) { if (s.startsWith(':scope > ')) return this.children.filter(n => n.matches(s.slice(9)));
		return this.children.flatMap(n => [...(n.matches(s) ? [n] : []), ...n.querySelectorAll(s)]); }
	querySelector(s) { return this.querySelectorAll(s)[0] || null; }
	getClientRects() { return this.isConnected ? [{}] : []; }
	addEventListener(n, fn) { this.listeners.set(n, fn); }
	removeEventListener(n, fn) { if (this.listeners.get(n) === fn) this.listeners.delete(n); }
	click(trusted = false) {
		let stopped = false;
		const event = { target: this, isTrusted: trusted, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; } };
		for (const fn of this.ownerDocument.events.get('click') || []) { fn(event); if (stopped) return; }
		this.listeners.get('click')?.(event);
	}
}
function playerFixture({ readCatalog, withSidebar = false } = {}) {
	const events = new Map(); const messages = []; let nativeClicks = 0; let now = 1000; let serial = 0;
	const timers = new Map();
	const doc = { events, visibilityState: 'visible', addEventListener(name, fn) { (events.get(name) || events.set(name, []).get(name)).push(fn); },
		querySelectorAll: s => doc.body.querySelectorAll(s), querySelector: s => doc.body.querySelector(s),
		getElementById: id => doc.head.children.find(n => n.id === id) || null,
		createElement(tag) { const e = new Element(tag, doc); if (tag === 'iframe') e.contentWindow = {
			get location() { throw Object.assign(new Error('Cross-origin Spotify frame'), { name: 'SecurityError' }); },
			postMessage: (m, origin) => { assert.equal(origin, protocol.SPOTIFY_ORIGIN); messages.push(m); },
		}; return e; } };
	doc.body = new Element('body', doc);
	doc.head = new Element('head', doc);
	if (withSidebar) {
		const sidebar = doc.createElement('div'); sidebar.className = 'trakt-side-navbar'; doc.body.appendChild(sidebar);
		const top = doc.createElement('div'); top.className = 'trakt-side-navbar-top is-expanded';
		const content = doc.createElement('div'); content.className = 'trakt-side-navbar-content'; sidebar.append(top, content);
	}
	const section = doc.createElement('section'); section.className = 'trakt-soundtrack-section'; doc.body.appendChild(section);
	function nativeRow(parent, number) {
		const row = doc.createElement('li'); row.className = 'trakt-soundtrack-row'; parent.appendChild(row);
		for (const [c, text] of [['row-position', String(number)], ['row-title', `Track ${number}`], ['row-performer', 'Artist']]) {
			const span = doc.createElement('span'); span.className = c; span.textContent = text; row.appendChild(span);
		}
		const button = doc.createElement('button'); button.className = 'row-action'; button.type = 'button'; button.setAttribute('aria-label', `Play Track ${number}`);
		button.addEventListener('click', () => nativeClicks++); row.appendChild(button); return { row, button };
	}
	nativeRow(section, 1);
	const window = { location: { pathname: '/movies/rocky-1976' }, addEventListener() {},
		setTimeout(fn, ms = 0) { const id = ++serial; timers.set(id, { fn, at: now + ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
	let handoff;
	const settings = { autoplay: true };
	const context = vm.createContext({ document: doc, window, URL, Date: { now: () => now },
		Image: class { set src(value) { queueMicrotask(() => this.onload?.()); } },
		Math: { floor: Math.floor, random: () => 0.999 }, MutationObserver: class { observe() {} disconnect() {} },
		CineTraktSpotifyProtocol: protocol, CineTraktExtensionProtocol: require('../extension-protocol.js'),
		CineTraktSettings: { isEnabled: key => key !== 'traktSoundtrackAutoplay' || settings.autoplay },
		chrome: { runtime: { onMessage: { addListener(fn) { handoff = fn; } }, sendMessage(m, cb) { cb({ ok: true }); } } },
		CineTraktSoundtrackLibrary: { ...library, readCatalog: readCatalog || (() => Promise.resolve(library.catalogFromEntry(entry(rawTracks), '/movies/rocky-1976'))) },
	});
	vm.runInContext(fs.readFileSync(require.resolve('../trakt-soundtrack.js'), 'utf8'), context);
	const api = context.CineTraktTraktSoundtrack;
	return { api, doc, window, messages, section, settings, nativeRow, nativeClicks: () => nativeClicks,
		hide() { doc.visibilityState = 'hidden'; for (const fn of events.get('visibilitychange')) fn(); },
		show() { doc.visibilityState = 'visible'; for (const fn of events.get('visibilitychange')) fn(); },
		handoff() { handoff({ type: require('../extension-protocol.js').MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK }); },
		advance(ms) {
			const end = now + ms;
			for (let i = 0; i < 100; i++) {
				const timer = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= end);
				if (!timer) break; timers.delete(timer[0]); now = timer[1].at; timer[1].fn();
			} now = end;
		},
		frame: () => doc.querySelector('iframe'),
		message(type, playbackState) { const frame = doc.querySelector('iframe'); api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN,
			source: frame.contentWindow, data: { type, playbackState, embedUrl: frame.src } }); },
		async metadata(title) { const frame = doc.querySelector('iframe'); api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN,
			source: frame.contentWindow, data: { type: protocol.MESSAGE_TYPES.METADATA, embedUrl: frame.src,
				title, artist: 'Artist', coverUrl: 'https://i.scdn.co/image/cover' } }); await Promise.resolve(); await Promise.resolve(); },
	};
}

test('autoplay chooses beyond the five summary rows and the same player survives drawer selection and closing', async () => {
	const f = playerFixture(); f.api.update(); await Promise.resolve(); f.advance(450); f.api.update();
	const frame = f.frame(); assert.ok(frame); assert.match(frame.src, new RegExp(id(14)));
	assert.equal(frame.insertedSrc, frame.src, 'the first live iframe already targets Spotify, rather than an inherited blank page');
	assert.equal(f.nativeClicks(), 0, 'autoplay uses the persistent player, not a temporary drawer controller');
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.ok(f.messages.some(m => m.type === protocol.MESSAGE_TYPES.PLAY_REQUEST));
	const drawer = f.doc.createElement('div'); drawer.className = 'trakt-drawer'; f.doc.body.appendChild(drawer);
	const choice = f.nativeRow(drawer, 7); choice.button.click(true);
	assert.equal(f.frame(), frame); assert.match(frame.src, new RegExp(id(7)));
	assert.equal(f.nativeClicks(), 0, 'native drawer playback must not create a second audio player');
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const writes = frame.srcWrites; const requests = f.messages.length;
	drawer.remove(); f.api.update();
	assert.equal(frame.isConnected, true); assert.equal(frame.srcWrites, writes);
	assert.equal(f.messages.length, requests, 'closing the drawer neither pauses nor reloads the active player');
	f.api.cleanup(); assert.equal(frame.isConnected, false);
});

test('a drawer pause stays paused after the drawer closes and page clicks do not restart it', async () => {
	const f = playerFixture(); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const drawer = f.doc.createElement('div'); drawer.className = 'trakt-drawer'; f.doc.body.appendChild(drawer);
	const choice = f.nativeRow(drawer, 14); f.api.update(); choice.button.click(true);
	assert.equal(f.messages.at(-1).type, protocol.MESSAGE_TYPES.PAUSE_REQUEST);
	const count = f.messages.length; drawer.remove(); f.api.update(); f.advance(40000);
	assert.equal(f.messages.length, count); assert.equal(f.nativeClicks(), 0);
});

test('persistent music keeps playing on other sites, resumes after handoff and preserves deliberate pauses', async () => {
	const f = playerFixture(); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const frame = f.frame(); const writes = frame.srcWrites; const before = f.messages.length;
	f.hide(); f.advance(5000); assert.equal(f.messages.length, before);
	f.handoff(); assert.equal(f.messages.at(-1).type, protocol.MESSAGE_TYPES.PAUSE_REQUEST);
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'paused');
	f.show(); f.advance(450);
	assert.equal(f.messages.at(-1).type, protocol.MESSAGE_TYPES.PLAY_REQUEST);
	assert.equal(frame.srcWrites, writes, 'returning resumes the same mounted track');
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const drawer = f.doc.createElement('div'); f.doc.body.appendChild(drawer);
	f.nativeRow(drawer, 14).button.click(true);
	const plays = () => f.messages.filter(m => m.type === protocol.MESSAGE_TYPES.PLAY_REQUEST).length;
	const paused = plays(); f.hide(); f.show(); f.advance(10000);
	assert.equal(plays(), paused);
});

test('disabled autoplay loads the catalog without starting music; manual choice still works', async () => {
	const f = playerFixture(); f.settings.autoplay = false; f.api.update(); await Promise.resolve(); f.advance(10000);
	assert.equal(f.frame(), null); assert.equal(f.nativeClicks(), 0);
	f.section.querySelector('button').click(true);
	assert.ok(f.frame()); assert.match(f.frame().src, new RegExp(id(1)));
});

test('a catalog response from the previous fiche or after cleanup cannot mount an obsolete player', async () => {
	const pending = [];
	const f = playerFixture({ readCatalog: () => new Promise(resolve => pending.push(resolve)) });
	f.api.update(); f.window.location.pathname = '/movies/other'; f.api.update();
	pending[0](library.catalogFromEntry(entry(rawTracks), '/movies/rocky-1976')); await Promise.resolve();
	assert.equal(f.doc.querySelector('.cinetrakt-soundtrack-player'), null);
	f.api.cleanup(); pending[1](library.catalogFromEntry(entry(rawTracks), '/movies/rocky-1976')); await Promise.resolve();
	assert.equal(f.doc.querySelector('.cinetrakt-soundtrack-player'), null);
});

test('late native iframe messages cannot overwrite the persistent player’s state', async () => {
	const f = playerFixture(); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const native = f.nativeRow(f.section, 14); f.api.update();
	assert.equal(native.button.getAttribute('aria-label'), 'Pause Track 14');
	const obsolete = f.doc.createElement('iframe'); obsolete.setAttribute('src', f.frame().src); f.section.appendChild(obsolete);
	f.api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN, source: obsolete.contentWindow,
		data: { type: protocol.MESSAGE_TYPES.PLAYBACK_STATE, playbackState: 'paused', embedUrl: obsolete.src } });
	assert.equal(native.button.getAttribute('aria-label'), 'Pause Track 14');
});

test('cover controls keep play/pause separate from skip, preserve the card while loading, and traverse real playback history', async () => {
	const f = playerFixture({ withSidebar: true }); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing'); await f.metadata('Track 14');
	const cover = f.doc.querySelector('.cinetrakt-soundtrack-cover-button');
	const next = f.doc.querySelector('.cinetrakt-soundtrack-next'); const previous = f.doc.querySelector('.cinetrakt-soundtrack-previous');
	const indicator = f.doc.querySelector('.cinetrakt-soundtrack-playback-icon');
	const card = f.doc.querySelector('.cinetrakt-soundtrack-card'); const artwork = f.doc.querySelector('.cinetrakt-soundtrack-artwork');
	assert.equal(cover.contains(next), false); assert.equal(cover.contains(previous), false, 'buttons cannot be nested inside the cover button');
	assert.equal(next.parentElement, cover.parentElement);
	assert.equal(previous.disabled, true); assert.equal(next.disabled, false); assert.equal(card.hidden, false);
	assert.equal(indicator.getAttribute('data-playing'), 'true');
	const first = f.frame().src; const pauses = () => f.messages.filter(m => m.type === protocol.MESSAGE_TYPES.PAUSE_REQUEST).length;
	const before = pauses(); next.click(true); const second = f.frame().src;
	assert.notEqual(first, second); assert.equal(pauses(), before, 'Next must not also trigger the cover pause handler');
	f.api.update(); assert.equal(card.hidden, false); assert.equal(artwork.hasAttribute('data-track-loading'), true);
	previous.click(true); assert.equal(f.frame().src, first); assert.equal(previous.disabled, true);
	assert.equal(artwork.hasAttribute('data-track-loading'), false, 'returning before new artwork arrives must not leave the cover dimmed');
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	cover.click(true); assert.equal(pauses(), before + 1); assert.equal(indicator.getAttribute('data-playing'), 'false');
	assert.equal(f.frame().src, first); assert.equal(cover.getAttribute('aria-label'), 'Play soundtrack');
	cover.click(true); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.equal(indicator.getAttribute('data-playing'), 'true');
	next.click(true); assert.equal(f.frame().src, second, 'Next revisits forward history before drawing a new song');
	f.api.cleanup(); assert.equal(card.isConnected, false);
});

test('manual drawer selections enter the same history and a one-song soundtrack disables both arrows', async () => {
	const f = playerFixture({ withSidebar: true }); f.api.update(); await Promise.resolve(); f.advance(450);
	const first = f.frame().src;
	const drawer = f.doc.createElement('div'); f.doc.body.appendChild(drawer); f.nativeRow(drawer, 7).button.click(true);
	assert.match(f.frame().src, new RegExp(id(7)));
	f.doc.querySelector('.cinetrakt-soundtrack-previous').click(true); assert.equal(f.frame().src, first);
	const only = playerFixture({ withSidebar: true, readCatalog: () => Promise.resolve(library.catalogFromEntry(entry([rawTracks[0]]), '/movies/rocky-1976')) });
	only.api.update(); await Promise.resolve(); only.advance(450);
	assert.equal(only.doc.querySelector('.cinetrakt-soundtrack-next').disabled, true);
	assert.equal(only.doc.querySelector('.cinetrakt-soundtrack-previous').disabled, true);
});

test('natural completion advances once with the same shuffle history, including forward history after Previous', async () => {
	const f = playerFixture({ withSidebar: true }); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const frame = f.frame(); const first = frame.src;
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); const second = frame.src;
	assert.notEqual(second, first); assert.equal(f.doc.querySelector('.cinetrakt-soundtrack-previous').disabled, false);
	const writes = frame.srcWrites;
	f.api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN, source: frame.contentWindow,
		data: { type: protocol.MESSAGE_TYPES.METADATA, playbackState: 'ended', embedUrl: first } });
	assert.equal(frame.srcWrites, writes, 'duplicate outgoing-track completion cannot skip the new song');
	f.doc.querySelector('.cinetrakt-soundtrack-previous').click(true); assert.equal(frame.src, first);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); assert.equal(frame.src, second);
});

test('automatic completion continues an authorized background playlist but cannot undo pause or handoff', async () => {
	const f = playerFixture({ withSidebar: true }); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const frame = f.frame(); const first = frame.src;
	f.hide(); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended');
	assert.notEqual(frame.src, first);
	f.message(protocol.MESSAGE_TYPES.READY);
	assert.equal(f.messages.at(-1).continueInBackground, true);
	f.handoff(); const afterHandoff = frame.srcWrites;
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); assert.equal(frame.srcWrites, afterHandoff);
	f.show(); f.advance(450); f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	f.doc.querySelector('.cinetrakt-soundtrack-cover-button').click(true);
	const afterPause = frame.srcWrites;
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); assert.equal(frame.srcWrites, afterPause);
	const visibleHandoff = playerFixture(); visibleHandoff.api.update(); await Promise.resolve(); visibleHandoff.advance(450);
	visibleHandoff.message(protocol.MESSAGE_TYPES.READY); visibleHandoff.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	visibleHandoff.handoff(); const visibleWrites = visibleHandoff.frame().srcWrites;
	visibleHandoff.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); assert.equal(visibleHandoff.frame().srcWrites, visibleWrites);
});

test('a single-song ending stops safely and an old fiche cannot advance during navigation', async () => {
	const only = playerFixture({ readCatalog: () => Promise.resolve(library.catalogFromEntry(entry([rawTracks[0]]), '/movies/rocky-1976')) });
	only.api.update(); await Promise.resolve(); only.advance(450);
	only.message(protocol.MESSAGE_TYPES.READY); only.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const writes = only.frame().srcWrites; only.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended');
	assert.equal(only.frame().srcWrites, writes);
	const f = playerFixture(); f.api.update(); await Promise.resolve(); f.advance(450);
	f.message(protocol.MESSAGE_TYPES.READY); f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	const before = f.frame().srcWrites; f.window.location.pathname = '/movies/other';
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'ended'); assert.equal(f.frame().srcWrites, before);
});
