const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const HOVER = 'wos-stream-pointer-over';
const { MESSAGE_TYPES } = require('../extension-protocol.js');
function surface() {
	const listeners = new Map();
	return {
		addEventListener(type, handler) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(handler);
		},
		removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
		emit(type, event = {}) { listeners.get(type)?.forEach((handler) => handler(event)); },
	};
}
function card() {
	const classes = new Set();
	const element = { classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) } };
	return { element, child: { closest: () => element }, highlighted: () => classes.has(HOVER) };
}
function setup() {
	const document = Object.assign(surface(), { documentElement: Object.assign(surface(), card().element), querySelectorAll: () => [] });
	const window = surface();
	const incoming = new Set();
	let now = 1000;
	vm.runInNewContext(fs.readFileSync(require.resolve('../stremio.js'), 'utf8'), {
		document, window, URLSearchParams,
		Date: { now: () => now },
		CineTraktExtensionProtocol: { MESSAGE_TYPES },
		chrome: { runtime: { onMessage: { addListener: (handler) => incoming.add(handler), removeListener: (handler) => incoming.delete(handler) } } },
		location: { search: '?wos_stream_panel=1', hash: '#/detail/movie/tt0417741', pathname: '/', hostname: 'web.stremio.com' },
		MutationObserver: class { observe() {} disconnect() {} },
		requestAnimationFrame: () => 1, cancelAnimationFrame() {},
		CineTraktSettings: { ready: { then: (start) => start() }, isEnabled: () => true, onChange() {} },
		CineTraktStreamBadges: { clearAll() {} },
	});
	window.clearTimeout = () => {};
	return { document, window, setTime: (value) => { now = value; }, receive: (message) => incoming.forEach((handler) => handler(message)) };
}

test('stream hover follows descendants, switches cards and clears in the gap', () => {
	const { document } = setup();
	const first = card();
	const second = card();
	document.emit('pointerover', { target: first.child });
	assert.equal(first.highlighted(), true);
	document.emit('pointerout', { relatedTarget: first.child });
	assert.equal(first.highlighted(), true);
	document.emit('pointermove', { target: second.child });
	assert.equal(first.highlighted(), false);
	assert.equal(second.highlighted(), true);
	document.emit('pointermove', { target: { closest: () => null } });
	assert.equal(second.highlighted(), false);
});

test('leaving either window edge clears hover and re-entry restores it', () => {
	const { document, window } = setup();
	const stream = card();
	for (const leave of [
		() => document.emit('pointerout', { relatedTarget: null }),
		() => document.documentElement.emit('pointerleave'),
		() => window.emit('mouseout', { relatedTarget: null }),
		() => window.emit('blur'),
	]) {
		document.emit('pointerover', { target: stream.child });
		assert.equal(stream.highlighted(), true);
		leave();
		assert.equal(stream.highlighted(), false);
	}
});

test('route changes and page cleanup cannot leave a highlighted stream behind', () => {
	const { document, window } = setup();
	const stream = card();
	document.emit('pointerover', { target: stream.child });
	window.emit('hashchange');
	assert.equal(stream.highlighted(), false);
	document.emit('pointermove', { target: stream.child });
	assert.equal(stream.highlighted(), true);
	window.emit('pagehide');
	assert.equal(stream.highlighted(), false);
	document.emit('pointerover', { target: stream.child });
	assert.equal(stream.highlighted(), false);
});

test('Trakt pointer return clears a stuck hover but delayed messages cannot clear a new hover', () => {
	const { document, receive, setTime } = setup();
	const stream = card();
	document.emit('pointerover', { target: stream.child });
	receive({ type: MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER, at: 1100 });
	assert.equal(stream.highlighted(), false);
	setTime(1200);
	document.emit('pointermove', { target: stream.child });
	receive({ type: MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER, at: 1100 });
	assert.equal(stream.highlighted(), true);
	receive({ type: MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER, at: 1300 });
	assert.equal(stream.highlighted(), false);
});

test('background relays pointer returns only from Trakt to the saved compact Stremio window', () => {
	const sent = [];
	let handler;
	vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), {
		importScripts() {}, URL,
		CineTraktExtensionProtocol: { MESSAGE_TYPES },
		CineTraktStremioUrls: require('../stremio-url.js'),
		CineTraktWindowLayout: {}, CineTraktTraktImdbResolver: {},
		chrome: {
			runtime: { onMessage: { addListener: (listener) => { handler = listener; } } },
			storage: { local: { get: (key, callback) => callback({ [key]: 42 }) } },
			windows: {
				onRemoved: { addListener() {} },
				get: (id, options, callback) => {
					assert.equal(id, 42);
					callback({ tabs: [
						{ id: 1, url: 'https://web.stremio.com/?wos_stream_panel=1#/detail/movie/tt0417741' },
						{ id: 2, url: 'https://web.stremio.com/#/detail/movie/tt0417741' },
						{ id: 3, url: 'https://other.example/?wos_stream_panel=1' },
					] });
				},
			},
			tabs: { sendMessage: (id, message, callback) => { sent.push({ id, type: message.type, at: message.at }); callback(); } },
		},
	});
	const message = { type: MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER, at: 1234 };
	for (const url of ['https://other.example/', 'https://app.trakt.tv.evil.example/']) {
		handler(message, { tab: { url } });
	}
	assert.equal(sent.length, 0);
	handler(message, { tab: { url: 'https://app.trakt.tv/movies/example' } });
	assert.deepEqual(sent, [{ id: 1, ...message }]);
});
