const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const protocol = require('../spotify-protocol.js');
const extensionProtocol = require('../extension-protocol.js');
const HANDOFF = extensionProtocol.MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK;

function soundtrackRelay() {
	const tabs = new Map();
	return {
		register(token) {
			const listeners = new Set(); tabs.set(token, listeners);
			return { runtime: {
				onMessage: { addListener: (listener) => listeners.add(listener) },
				sendMessage(message, callback) {
					for (const [other, handlers] of tabs) if (other !== token) for (const handler of handlers) handler(message);
					callback();
				},
			} };
		},
	};
}

function events() {
	const listeners = new Map();
	return {
		addEventListener(type, listener) { (listeners.get(type) || listeners.set(type, new Set()).get(type)).add(listener); },
		emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener(event); },
	};
}

function timers() {
	let now = 1000; let nextId = 0;
	const pending = new Map();
	return {
		now: () => now,
		setTimeout(fn, delay = 0) { pending.set(++nextId, { fn, at: now + delay }); return nextId; },
		clearTimeout(id) { pending.delete(id); },
		advance(ms) {
			const end = now + ms;
			for (let attempts = 0; attempts < 100; attempts++) {
				const next = [...pending].sort((a, b) => a[1].at - b[1].at).find(([, timer]) => timer.at <= end);
				if (!next) break;
				pending.delete(next[0]); now = next[1].at; next[1].fn();
			}
			now = end;
		},
	};
}

function soundtrackTab(visibility = 'visible', relay = soundtrackRelay()) {
	const clock = timers(); const sent = []; const settings = { autoplay: true, enabled: true };
	let hasTracks = true; let receiveHandoff;
	let playing = false; let clicks = 0;
	const control = {
		isConnected: true,
		getAttribute: (name) => name === 'aria-label' ? playing ? 'Pause' : 'Play' : null,
		querySelector: () => null,
		click() { clicks++; playing = !playing; },
	};
	const iframe = { contentWindow: { postMessage: (message) => sent.push(message.type) },
		getAttribute: () => '', setAttribute() {} };
	const section = { isConnected: true, closest: () => null, querySelectorAll: () => [row], querySelector: () => iframe, contains: (element) => element === iframe };
	const row = {
		hidden: false, getAttribute: () => null, getClientRects: () => [{}],
		closest: (selector) => selector === 'section.trakt-soundtrack-section' ? section : null,
		classList: { contains: () => false },
		querySelector(selector) {
			if (selector === '.row-position') return { textContent: '1' };
			if (selector === '.row-title') return { textContent: 'Chosen soundtrack' };
			if (selector === '.row-performer') return { textContent: 'Composer' };
			return selector === 'button.row-action[type="button"]' ? control : null;
		},
	};
	const document = Object.assign(events(), {
		visibilityState: visibility,
		querySelector: () => null,
		querySelectorAll(selector) {
			if (selector === 'section.trakt-soundtrack-section') return hasTracks ? [section] : [];
			if (selector === '.trakt-soundtrack-row') return hasTracks ? [row] : [];
			if (selector.includes('iframe')) return [iframe];
			return [];
		},
	});
	const window = Object.assign(events(), clock, { location: { pathname: '/movies/example-2000' } });
	const chrome = relay.register({});
	const register = chrome.runtime.onMessage.addListener;
	chrome.runtime.onMessage.addListener = (handler) => { receiveHandoff = handler; register(handler); };
	const context = vm.createContext({ document, window, URL, Date: { now: clock.now },
		Math: { floor: Math.floor, random: () => 0 }, MutationObserver: class { observe() {} disconnect() {} },
		CineTraktSpotifyProtocol: protocol,
		CineTraktExtensionProtocol: extensionProtocol, chrome,
		CineTraktSettings: { isEnabled: (key) => key === 'traktSoundtrackAutoplay' ? settings.autoplay : settings.enabled },
	});
	vm.runInContext(fs.readFileSync(require.resolve('../trakt-soundtrack.js'), 'utf8'), context);
	const api = context.CineTraktTraktSoundtrack;
	return { api, clock, control, sent, settings,
		removeTracks() { hasTracks = false; }, handoff() { receiveHandoff({ type: HANDOFF }); },
		playing: () => playing, clicks: () => clicks,
		show() { document.visibilityState = 'visible'; document.emit('visibilitychange'); },
		hide() { document.visibilityState = 'hidden'; document.emit('visibilitychange'); },
		start() { api.update(); clock.advance(450); api.update(); },
		message(type, playbackState) { api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN, source: iframe.contentWindow, data: { type, playbackState } }); },
	};
}

test('opening a background media tab cannot interrupt the currently playing tab', () => {
	const foreground = soundtrackTab(); foreground.start();
	assert.equal(foreground.playing(), true);
	const background = soundtrackTab('hidden'); background.api.update();
	background.message(protocol.MESSAGE_TYPES.READY);
	background.clock.advance(6000); background.api.update();
	assert.equal(background.clicks(), 0);
	assert.equal(background.sent.includes(protocol.MESSAGE_TYPES.PLAY_REQUEST), false);
	assert.equal(foreground.playing(), true);
	background.show(); background.clock.advance(450); background.api.update();
	assert.equal(background.playing(), true);
});

test('a new playing soundtrack takes over and returning resumes the old one, repeatedly', () => {
	const relay = soundtrackRelay();
	const first = soundtrackTab('visible', relay); const second = soundtrackTab('hidden', relay); first.start(); second.api.update();
	for (let count = 0; count < 3; count++) {
		first.hide(); second.show();
		assert.equal(first.playing(), true, 'keep the previous soundtrack until the replacement starts');
		second.clock.advance(450); second.api.update();
		assert.equal(first.playing(), false); assert.equal(second.playing(), true);
		second.hide(); first.show(); first.clock.advance(450); first.api.update();
		assert.equal(second.playing(), false); assert.equal(first.playing(), true);
	}
	assert.ok(first.sent.includes(protocol.MESSAGE_TYPES.PAUSE_REQUEST));
});

test('other sites and Trakt pages with no soundtrack keep the existing music playing', () => {
	const relay = soundtrackRelay(); const music = soundtrackTab('visible', relay); music.start(); music.hide();
	music.clock.advance(10000); music.api.update();
	assert.equal(music.playing(), true, 'an unrelated site sends no handoff');
	const silent = soundtrackTab('hidden', relay); silent.removeTracks(); silent.show(); silent.clock.advance(40000); silent.api.update();
	assert.equal(music.playing(), true); assert.equal(silent.clicks(), 0);
	music.show(); music.clock.advance(1000); music.api.update();
	assert.equal(music.clicks(), 1, 'returning to already playing music must not restart it');
});

test('returning to a deliberately paused tab leaves both its pause and the other soundtrack intact', () => {
	const relay = soundtrackRelay();
	const paused = soundtrackTab('visible', relay); const music = soundtrackTab('hidden', relay);
	paused.start(); paused.control.click(); paused.hide(); music.show(); music.start();
	assert.equal(music.playing(), true);
	music.hide(); paused.show(); paused.clock.advance(6000); paused.api.update();
	assert.equal(paused.playing(), false); assert.equal(music.playing(), true);
});

test('pending autoplay and late Spotify readiness remain suspended until the tab is visible', () => {
	const tab = soundtrackTab(); tab.api.update(); tab.hide();
	tab.message(protocol.MESSAGE_TYPES.READY); tab.clock.advance(40000);
	assert.equal(tab.clicks(), 0);
	tab.show(); tab.clock.advance(450); tab.api.update();
	assert.equal(tab.playing(), true);
	tab.hide(); tab.handoff(); tab.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing'); tab.clock.advance(5000);
	assert.equal(tab.playing(), false);
	assert.equal(tab.sent.includes(protocol.MESSAGE_TYPES.PLAY_REQUEST), false);
});

test('a deliberate pause or disabled autoplay is respected when returning to a tab', () => {
	const tab = soundtrackTab(); tab.start(); tab.control.click();
	const before = tab.clicks(); tab.hide(); tab.show(); tab.clock.advance(6000); tab.api.update();
	assert.equal(tab.clicks(), before); assert.equal(tab.playing(), false);
	const manual = soundtrackTab(); manual.settings.autoplay = false; manual.api.update();
	manual.clock.advance(6000); assert.equal(manual.clicks(), 0);
	manual.control.click(); manual.api.update(); manual.hide(); manual.show(); manual.clock.advance(6000);
	assert.equal(manual.playing(), true, 'manual playback also continues on other sites');
});

test('cleanup cancels pending playback and a new route is discovered only when visible', () => {
	const tab = soundtrackTab(); tab.api.update(); tab.api.cleanup(); tab.clock.advance(6000);
	assert.equal(tab.clicks(), 0);
	tab.hide(); tab.api.update(); tab.clock.advance(40000);
	assert.equal(tab.clicks(), 0);
	tab.show(); tab.clock.advance(450); tab.api.update();
	assert.equal(tab.playing(), true);
});

function spotifyFrame(visibility = 'visible') {
	const clock = timers(); let playing = false; let clicks = 0; let mutation;
	const control = { getAttribute: () => playing ? 'Pause' : 'Play', click() { clicks++; playing = !playing; } };
	const document = Object.assign(events(), { visibilityState: visibility, images: [], documentElement: {},
		querySelector: () => control, querySelectorAll: () => [] });
	const top = { postMessage() {} };
	const window = Object.assign(events(), clock, { top, location: { href: 'https://open.spotify.com/embed/track/example' } });
	vm.runInNewContext(fs.readFileSync(require.resolve('../spotify-embed.js'), 'utf8'), {
		document, window, CineTraktSpotifyProtocol: protocol,
		CineTraktSettings: { ready: { then: (fn) => fn() }, isEnabled: () => true },
		MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} },
	});
	return { clock, playing: () => playing, clicks: () => clicks,
		request(type, origin = protocol.TRAKT_ORIGIN, source = top) { window.emit('message', { origin, source, data: { type } }); },
		hide() { document.visibilityState = 'hidden'; document.emit('visibilitychange'); },
		lateStart() { playing = true; mutation(); clock.advance(100); },
	};
}

test('Spotify ignores delayed play requests in a hidden frame and pauses a late playback start', () => {
	const frame = spotifyFrame('hidden'); frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	assert.equal(frame.clicks(), 0);
	frame.lateStart(); assert.equal(frame.playing(), false); assert.equal(frame.clicks(), 1);
});

test('Spotify keeps existing background music until a trusted pause request and rejects delayed restarts', () => {
	const frame = spotifyFrame();
	frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST, 'https://other.example');
	frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST, protocol.TRAKT_ORIGIN, {});
	assert.equal(frame.clicks(), 0);
	frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); assert.equal(frame.playing(), true);
	frame.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); frame.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST);
	assert.equal(frame.clicks(), 2); assert.equal(frame.playing(), false);
	frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); frame.hide();
	assert.equal(frame.playing(), true);
	frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); assert.equal(frame.playing(), true);
	frame.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); frame.lateStart();
	assert.equal(frame.playing(), false);
});

test('background relays handoff only from an active Trakt detail tab to other Trakt detail tabs', () => {
	const sent = []; let handler; let queries = 0;
	vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), {
		importScripts() {}, URL, CineTraktExtensionProtocol: extensionProtocol,
		CineTraktStremioUrls: require('../stremio-url.js'), CineTraktWindowLayout: {}, CineTraktTraktImdbResolver: {},
		chrome: {
			runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
			windows: { onRemoved: { addListener() {} } },
			tabs: {
				query(filter, callback) {
					queries++; assert.equal(filter.url, 'https://app.trakt.tv/*');
					callback([{ id: 1, url: 'https://app.trakt.tv/movies/first' },
						{ id: 2, url: 'https://app.trakt.tv/shows/second?season=1' },
						{ id: 3, url: 'https://other.example/' }, { id: 4, url: 'https://app.trakt.tv/home' }]);
				},
				sendMessage(id, message, options, callback) { sent.push({ id, type: message.type, frameId: options.frameId }); callback(); },
			},
		},
	});
	const sender = { frameId: 0, tab: { id: 1, active: true, url: 'https://app.trakt.tv/movies/first' } };
	for (const invalid of [
		{ ...sender, frameId: 1 }, { ...sender, tab: { ...sender.tab, active: false } },
		{ ...sender, tab: { ...sender.tab, url: 'https://app.trakt.tv.evil.example/movies/first' } },
		{ ...sender, tab: { ...sender.tab, url: 'https://app.trakt.tv/home' } },
	]) handler({ type: HANDOFF }, invalid);
	assert.equal(queries, 0);
	handler({ type: HANDOFF }, sender);
	assert.deepEqual(sent, [{ id: 2, type: HANDOFF, frameId: 0 }]);
});
