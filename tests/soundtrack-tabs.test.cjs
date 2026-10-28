const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const protocol = require('../spotify-protocol.js');
const extensionProtocol = require('../extension-protocol.js');
const HANDOFF = extensionProtocol.MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK;

function soundtrackRelay() {
	const tabs = new Map();
	let serial = 0; let held = false; const pending = [];
	return {
		hold() { held = true; },
		flush() { held = false; for (const job of pending.splice(0)) job(); },
		register(token) {
			const listeners = new Set(); tabs.set(token, listeners);
			return { runtime: {
				onMessage: { addListener: (listener) => listeners.add(listener) },
				sendMessage(message, callback) {
					const claimSerial = ++serial;
					for (const [other, handlers] of tabs) if (other !== token) for (const handler of handlers) handler({ ...message, claimSerial });
					const reply = () => callback({ ok: claimSerial === serial, claimSerial });
					if (held) pending.push(reply); else reply();
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

function soundtrackTab(visibility = 'visible', relay = soundtrackRelay(), { autoConfirm = true, managed = false } = {}) {
	const clock = timers(); const sent = []; const settings = { autoplay: true, enabled: true };
	let hasTracks = true; let receiveHandoff;
	let playing = false; let clicks = 0; let iframeReloads = 0;
	let api; let receiveCatalog;
	const report = (state, userInitiated = false) => api?.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN,
		source: iframe.contentWindow, data: { type: protocol.MESSAGE_TYPES.PLAYBACK_STATE, playbackState: state, userInitiated, embedUrl: iframe.src } });
	const control = {
		isConnected: true,
		closest: selector => selector === 'button' ? control : selector === '.trakt-soundtrack-row' ? row : null,
		getAttribute: (name) => name === 'aria-label' ? playing ? 'Pause' : 'Play' : null,
		querySelector: () => null,
		click() { clicks++; playing = !playing; if (autoConfirm) report(playing ? 'playing' : 'paused', !playing); },
	};
	const attributes = new Map([['loading', 'lazy'], ['allow', '']]);
	const iframe = { isConnected: true, src: 'https://open.spotify.com/embed/track/current', contentWindow: { postMessage: (message) => {
		sent.push(message.type);
		if (message.type === protocol.MESSAGE_TYPES.PAUSE_REQUEST) { playing = false; if (autoConfirm) report('paused'); }
		if (message.type === protocol.MESSAGE_TYPES.PLAY_REQUEST && autoConfirm) { playing = true; report('playing'); }
	} },
		getAttribute: name => attributes.get(name) || '', setAttribute(name, value) { attributes.set(name, value); if (name === 'src') iframeReloads++; } };
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
		...(managed ? { CineTraktSoundtrackLibrary: {
			readCatalog: () => ({ then(receive) { receiveCatalog = receive; } }),
			createPlayer: () => ({ tracks: [{ key: '1|Chosen soundtrack|Composer', row, control }], iframe,
				root: { isConnected: true }, update() {}, cleanup() {}, matchRow: () => null, select() {} }),
		} } : {}),
	});
	vm.runInContext(fs.readFileSync(require.resolve('../trakt-soundtrack.js'), 'utf8'), context);
	api = context.CineTraktTraktSoundtrack;
	return { api, clock, control, sent, settings, iframe,
		manualClick() { document.emit('click', { isTrusted: true, target: control, preventDefault() {}, stopImmediatePropagation() {} }); },
		interact(isTrusted = true) { document.emit('click', { isTrusted, target: { closest: () => null } }); },
		removeTracks() { hasTracks = false; }, handoff(claimSerial) { receiveHandoff({ type: HANDOFF, claimSerial }); },
		playing: () => playing, clicks: () => clicks,
		interrupt() { playing = false; report('paused'); },
		iframeReloads: () => iframeReloads,
		show() { document.visibilityState = 'visible'; document.emit('visibilitychange'); },
		hide() { document.visibilityState = 'hidden'; document.emit('visibilitychange'); },
		start() { api.update(); if (managed) receiveCatalog([{}]); clock.advance(450); api.update(); },
		message(type, playbackState, extra = {}) { api.handleEmbedMessage({ origin: protocol.SPOTIFY_ORIGIN, source: iframe.contentWindow, data: { type, playbackState, embedUrl: iframe.src, ...extra } }); },
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

test('rapid tab returns ignore stale grants and late reports from the previous soundtrack', () => {
	const relay = soundtrackRelay(); const first = soundtrackTab('visible', relay);
	const second = soundtrackTab('hidden', relay); first.start(); second.api.update();
	relay.hold(); first.hide(); second.show(); second.clock.advance(450);
	assert.equal(first.playing(), false, 'the outgoing tab pauses before a new start is granted');
	assert.equal(second.playing(), false, 'the incoming tab waits for the pause acknowledgement');
	second.hide(); first.show(); first.clock.advance(450); relay.flush();
	assert.equal(first.playing(), true); assert.equal(second.playing(), false);
	first.handoff(1);
	assert.equal(first.playing(), true, 'an older handoff cannot pause a newer playback owner');
	second.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.equal(first.playing(), true); assert.equal(second.playing(), false);
});

test('manual pause and route cleanup cancel a start whose ownership grant is still pending', () => {
	for (const cleanup of [false, true]) {
		const relay = soundtrackRelay(); relay.hold(); const tab = soundtrackTab('visible', relay); tab.start();
		if (cleanup) tab.api.cleanup();
		else tab.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'paused', { userInitiated: true });
		relay.flush(); tab.clock.advance(5000);
		assert.equal(tab.playing(), false); assert.equal(tab.clicks(), 0);
	}
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

test('a transient Spotify pause during a tab switch resumes only the soundtrack that still owns playback', () => {
	for (const beforeHide of [true, false]) {
		const music = soundtrackTab(); music.start();
		if (beforeHide) music.interrupt();
		music.hide();
		if (!beforeHide) music.interrupt();
		assert.equal(music.playing(), true, 'a non-user pause must not revoke established background playback');
		music.handoff(); music.interrupt(); music.clock.advance(5000);
		assert.equal(music.playing(), false, 'another playing Trakt tab keeps ownership');
	}
	const paused = soundtrackTab(); paused.start(); paused.control.click(); paused.hide(); paused.interrupt();
	assert.equal(paused.playing(), false, 'manual pauses are never recovered');
});

test('background pause recovery is bounded and renewed only after a foreground visit', () => {
	const music = soundtrackTab(); music.start(); music.hide();
	const before = music.sent.filter(type => type === protocol.MESSAGE_TYPES.PLAY_REQUEST).length;
	for (let count = 0; count < 6; count++) music.interrupt();
	assert.equal(music.sent.filter(type => type === protocol.MESSAGE_TYPES.PLAY_REQUEST).length - before, 2);
	assert.equal(music.playing(), false, 'persistent failures cannot create an endless play loop');
	music.show(); music.clock.advance(500); music.api.update(); music.hide(); music.interrupt();
	assert.equal(music.playing(), true);
});

test('a ready Spotify start requested in the foreground survives a switch before its first progress report', () => {
	const music = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false, managed: true }); music.start();
	music.message(protocol.MESSAGE_TYPES.READY);
	music.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'buffering');
	const pauses = music.sent.filter(type => type === protocol.MESSAGE_TYPES.PAUSE_REQUEST).length;
	music.hide(); music.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.equal(music.sent.filter(type => type === protocol.MESSAGE_TYPES.PAUSE_REQUEST).length, pauses);
	music.handoff(); music.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.ok(music.sent.filter(type => type === protocol.MESSAGE_TYPES.PAUSE_REQUEST).length > pauses);
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
	manual.manualClick(); manual.api.update(); manual.hide(); manual.show(); manual.clock.advance(6000);
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

test('a managed soundtrack prepares its embed, then pauses the old tab before requesting Spotify playback', () => {
	const relay = soundtrackRelay(); const old = soundtrackTab('visible', relay); old.start(); old.hide();
	const next = soundtrackTab('visible', relay, { autoConfirm: false, managed: true }); next.start();
	assert.equal(next.iframe.getAttribute('loading'), 'eager');
	assert.match(next.iframe.getAttribute('allow'), /autoplay/);
	assert.equal(old.playing(), true, 'preparing an unready embed must not interrupt existing audio');
	next.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing', { embedUrl: 'https://open.spotify.com/embed/track/previous' });
	assert.equal(old.playing(), true, 'late playback from the outgoing entity is ignored');
	next.message(protocol.MESSAGE_TYPES.READY);
	assert.equal(old.playing(), false, 'the old tab pauses before the new track starts, not after a progress tick');
	next.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'playing');
	assert.equal(old.playing(), false);
});

test('stalled playback gets at most two recovery requests and a deliberate pause prevents further attempts', () => {
	const f = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false }); f.start();
	for (let attempt = 0; attempt < 3; attempt++) f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'stalled');
	assert.equal(f.sent.filter(type => type === protocol.MESSAGE_TYPES.PLAY_REQUEST).length, 2);
	assert.equal(f.playing(), false);
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'paused', { userInitiated: true });
	f.clock.advance(45000); f.api.update();
	f.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'stalled');
	assert.equal(f.sent.filter(type => type === protocol.MESSAGE_TYPES.PLAY_REQUEST).length, 2);
});

test('an embed that never becomes ready is reloaded once; readiness and manual pause cancel that reload', () => {
	const stuck = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false }); stuck.start();
	stuck.clock.advance(9000);
	assert.equal(stuck.iframeReloads(), 1);
	stuck.clock.advance(40000); stuck.api.update();
	assert.equal(stuck.iframeReloads(), 1, 'a blank frame cannot cause an endless refresh loop');
	for (const type of [protocol.MESSAGE_TYPES.READY, protocol.MESSAGE_TYPES.PLAYBACK_STATE]) {
		const ready = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false }); ready.start();
		ready.message(type, 'paused', { userInitiated: type === protocol.MESSAGE_TYPES.PLAYBACK_STATE });
		ready.clock.advance(12000);
		assert.equal(ready.iframeReloads(), 0);
	}
});

function spotifyFrame(visibility = 'visible', ready = true, { acceptPlayAfter = 0 } = {}) {
	const clock = timers(); let playing = false; let clicks = 0; let mutation;
	const acceptPlayAt = clock.now() + acceptPlayAfter;
	const messages = []; const progress = { value: '0', max: '180000' };
	const control = { getAttribute: () => playing ? 'Pause' : 'Play', closest: () => control,
		click() { clicks++; if (playing || clock.now() >= acceptPlayAt) playing = !playing; } };
	const document = Object.assign(events(), { visibilityState: visibility, images: [], documentElement: {},
		querySelector: selector => selector.startsWith('input') ? progress : ready ? control : null, querySelectorAll: () => [] });
	const top = { postMessage: message => messages.push(message) };
	const window = Object.assign(events(), clock, { top, location: { href: 'https://open.spotify.com/embed/track/example' } });
	vm.runInNewContext(fs.readFileSync(require.resolve('../spotify-embed.js'), 'utf8'), {
		document, window, CineTraktSpotifyProtocol: protocol,
		CineTraktSpotifyPlayback: require('../spotify-playback.js'), Date: { now: clock.now },
		CineTraktSettings: { ready: { then: (fn) => fn() }, isEnabled: () => true },
		MutationObserver: class { constructor(fn) { mutation = fn; } observe() {} },
	});
	return { clock, messages, playing: () => playing, clicks: () => clicks,
		progress(value) { progress.value = String(value); mutation(); clock.advance(100); },
		finish() { playing = false; progress.value = '0'; mutation(); clock.advance(100); },
		manualClick() { document.emit('click', { isTrusted: true, target: control }); control.click(); mutation(); clock.advance(100); },
		ready() { ready = true; mutation(); clock.advance(100); },
		request(type, origin = protocol.TRAKT_ORIGIN, source = top, extra = {}) { window.emit('message', { origin, source, data: { type, ...extra } }); },
		hide() { document.visibilityState = 'hidden'; document.emit('visibilitychange'); },
		show() { document.visibilityState = 'visible'; document.emit('visibilitychange'); },
		systemPause() { playing = false; },
		lateStart() { playing = true; mutation(); clock.advance(100); },
	};
}

test('Spotify ignores delayed play requests in a hidden frame and pauses a late playback start', () => {
	const frame = spotifyFrame('hidden'); frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	assert.equal(frame.clicks(), 0);
	frame.lateStart(); assert.equal(frame.playing(), false); assert.equal(frame.clicks(), 1);
});

test('a hidden Spotify frame plays only an explicitly authorized continuation from its Trakt parent', () => {
	const f = spotifyFrame('hidden');
	f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST, 'https://other.example', undefined, { continueInBackground: true });
	assert.equal(f.playing(), false);
	f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST, protocol.TRAKT_ORIGIN, undefined, { continueInBackground: true });
	assert.equal(f.playing(), true);
	f.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); assert.equal(f.playing(), false);
	f.lateStart(); assert.equal(f.playing(), false);
});

test('the Spotify bridge reports real completion but explicit pauses near EOF remain pauses', () => {
	const natural = spotifyFrame(); natural.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	natural.progress(170000); natural.clock.advance(5000); natural.progress(175000);
	natural.clock.advance(5000); natural.finish();
	assert.ok(natural.messages.some(m => m.playbackState === 'ended'));
	for (const manual of [false, true]) {
		const f = spotifyFrame(); f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
		f.progress(170000); f.clock.advance(5000); f.progress(175000); f.clock.advance(5000);
		if (manual) f.manualClick(); else f.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST);
		f.finish(); assert.equal(f.messages.some(m => m.playbackState === 'ended'), false);
	}
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

test('visibility changes preserve an authorized Spotify continuation despite a transient native pause', () => {
	const frame = spotifyFrame(); frame.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	frame.systemPause(); frame.hide(); frame.lateStart();
	assert.equal(frame.playing(), true);
	frame.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); frame.lateStart();
	assert.equal(frame.playing(), false, 'a newer explicit pause still revokes continuation');
});

test('Spotify reports buffering and stalls instead of trusting the Pause icon; progress confirms playback', () => {
	const f = spotifyFrame(); f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); f.clock.advance(14000);
	const reports = f.messages.filter(message => message.type === protocol.MESSAGE_TYPES.PLAYBACK_STATE);
	assert.ok(reports.some(message => message.playbackState === 'buffering'));
	assert.ok(reports.some(message => message.playbackState === 'stalled'));
	assert.equal(reports.some(message => message.playbackState === 'playing'), false);
	f.progress(1000);
	assert.equal(f.messages.at(-1).playbackState, 'playing');
});

test('a stalled Spotify restart is cancelled by pause and manual resume remains available', () => {
	const f = spotifyFrame(); f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); f.clock.advance(14000);
	f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	assert.equal(f.playing(), false, 'recovery first pauses the stalled player');
	f.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); f.clock.advance(2000);
	assert.equal(f.playing(), false, 'a pending restart cannot undo a newer pause');
	f.manualClick();
	assert.ok(f.messages.some(message => message.userInitiated && message.playbackState === 'buffering'));
	f.progress(1000); f.progress(2000);
	assert.equal(f.messages.at(-1).playbackState, 'playing');
});

test('a frozen hidden Spotify progress display cannot stop authorized audio or trigger a restart', () => {
	const f = spotifyFrame(); f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	f.progress(1000); f.progress(2000);
	const before = f.clicks(); f.hide(); f.clock.advance(30000);
	f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST, protocol.TRAKT_ORIGIN, undefined, { continueInBackground: true });
	assert.equal(f.playing(), true);
	assert.equal(f.clicks(), before, 'background visual throttling is not a playback failure');
	assert.equal(f.messages.at(-1).playbackState, 'playing');
	f.show(); f.clock.advance(100);
	assert.notEqual(f.messages.at(-1).playbackState, 'stalled', 'foreground monitoring starts a fresh grace period');
	f.progress(3000); f.clock.advance(14000);
	assert.equal(f.messages.at(-1).playbackState, 'stalled', 'genuine visible stalls are still detected');
	f.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); f.clock.advance(1000);
	assert.equal(f.playing(), false);
});

test('a play request waits for Spotify controls to mount and a newer pause cancels it', () => {
	const delayed = spotifyFrame('visible', false);
	delayed.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); delayed.clock.advance(20000);
	assert.equal(delayed.clicks(), 0);
	delayed.ready();
	assert.equal(delayed.playing(), true);
	assert.equal(delayed.clicks(), 1);
	const cancelled = spotifyFrame('visible', false);
	cancelled.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	cancelled.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); cancelled.ready();
	assert.equal(cancelled.clicks(), 0);
});

test('autoplay survives mounted Spotify controls that ignore early commands, without rapid or endless retries', () => {
	const slow = spotifyFrame('visible', true, { acceptPlayAfter: 6000 });
	slow.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	for (let attempt = 0; attempt < 3; attempt++) {
		slow.clock.advance(100); slow.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	}
	assert.equal(slow.clicks(), 1, 'duplicate parent messages must not consume the delayed retry budget');
	slow.clock.advance(8000);
	assert.equal(slow.playing(), true, 'loading must not require a manual click when the early command was ignored');
	assert.equal(slow.clicks(), 4);
	const blocked = spotifyFrame('visible', true, { acceptPlayAfter: Infinity });
	blocked.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); blocked.clock.advance(30000);
	blocked.request(protocol.MESSAGE_TYPES.PLAY_REQUEST); blocked.clock.advance(30000);
	assert.equal(blocked.clicks(), 4, 'a persistent playback refusal must not create an endless click loop');
});

test('pausing while Spotify is still refusing playback cancels every delayed start', () => {
	const f = spotifyFrame('visible', true, { acceptPlayAfter: 6000 });
	f.request(protocol.MESSAGE_TYPES.PLAY_REQUEST);
	f.request(protocol.MESSAGE_TYPES.PAUSE_REQUEST); f.clock.advance(20000);
	assert.equal(f.clicks(), 1);
	assert.equal(f.playing(), false);
});

test('pausing through the native Trakt row also cancels the embed’s queued autoplay', () => {
	const f = soundtrackTab(); f.start();
	f.manualClick();
	assert.ok(f.sent.includes(protocol.MESSAGE_TYPES.PAUSE_REQUEST));
	f.message(protocol.MESSAGE_TYPES.READY); f.clock.advance(20000);
	assert.equal(f.playing(), false);
});

test('clicking elsewhere on the page never restarts a refused or deliberately paused soundtrack', () => {
	const f = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false }); f.start();
	f.message(protocol.MESSAGE_TYPES.READY); f.clock.advance(40000);
	const before = f.sent.length;
	f.interact(false); assert.equal(f.sent.length, before, 'synthetic clicks cannot unlock playback');
	f.interact(); assert.equal(f.sent.length, before, 'plain clicks must not act as playback controls');
	const paused = soundtrackTab('visible', soundtrackRelay(), { autoConfirm: false }); paused.start();
	paused.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'paused', { userInitiated: true });
	const pausedBefore = paused.sent.length;
	paused.interact(); paused.clock.advance(40000);
	assert.equal(paused.sent.length, pausedBefore);
	const disabled = soundtrackTab(); disabled.settings.autoplay = false; disabled.start(); disabled.interact();
	assert.equal(disabled.clicks(), 0);
	assert.equal(disabled.sent.includes(protocol.MESSAGE_TYPES.PLAY_REQUEST), false);
	const finished = soundtrackTab(); finished.start();
	finished.message(protocol.MESSAGE_TYPES.PLAYBACK_STATE, 'paused');
	const finishedBefore = finished.sent.length;
	finished.interact(); assert.equal(finished.sent.length, finishedBefore, 'an already played song must not restart on a page click');
});

test('background relays handoff only from an active Trakt detail tab to other Trakt detail tabs', () => {
	const sent = []; let handler; let queries = 0; let holdAcks = false; const acknowledgements = [];
	vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), {
		importScripts() {}, URL, CineTraktExtensionProtocol: extensionProtocol,
		CineTraktImdbEpisodeLoader: { start() {} },
		CineTraktStremioUrls: require('../stremio-url.js'), CineTraktWindowLayout: {}, CineTraktTraktImdbResolver: {},
		CineTraktSeasonRatings: require('../season-rating-utils.js'),
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
				sendMessage(id, message, options, callback) {
					sent.push({ id, type: message.type, frameId: options.frameId });
					if (holdAcks) acknowledgements.push(callback); else callback();
				},
			},
		},
	});
	const sender = { frameId: 0, tab: { id: 1, active: true, url: 'https://app.trakt.tv/movies/first' } };
	for (const invalid of [
		{ ...sender, frameId: 1 }, { ...sender, tab: { ...sender.tab, active: false } },
		{ ...sender, tab: { ...sender.tab, url: 'https://app.trakt.tv.evil.example/movies/first' } },
		{ ...sender, tab: { ...sender.tab, url: 'https://app.trakt.tv/home' } },
	]) handler({ type: HANDOFF }, invalid, () => {});
	assert.equal(queries, 0);
	let granted;
	handler({ type: HANDOFF }, sender, response => { granted = response.ok; });
	assert.deepEqual(sent, [{ id: 2, type: HANDOFF, frameId: 0 }]);
	assert.equal(granted, true);
	holdAcks = true; const grants = [];
	assert.equal(handler({ type: HANDOFF }, sender, response => grants.push(['old', response.ok])), true);
	handler({ type: HANDOFF }, { frameId: 0, tab: { id: 2, active: true, url: 'https://app.trakt.tv/shows/second' } },
		response => grants.push(['new', response.ok]));
	assert.deepEqual(grants, [], 'the new player waits until other tabs process their pause');
	acknowledgements[1](); acknowledgements[0]();
	assert.deepEqual(grants, [['new', true], ['old', false]], 'only the latest request can start, regardless of callback order');
});
