const test = require('node:test');
const assert = require('node:assert/strict');

const urlHelpers = require('../stremio-url.js');
const {
	NATIVE_RETRY_DELAYS,
	createStremioOpener,
	getCurrentScreenBounds,
} = require('../stremio-open.js');

function createEnvironment() {
	const messages = [];
	const delays = [];
	const links = [];
	const createdLinks = [];
	const runtime = {
		id: 'cinetrakt-test',
		lastError: null,
		sendMessage(message, callback) {
			messages.push(message);
			callback?.({ ok: true });
		},
	};
	const body = {
		appendChild(link) {
			links.push(link);
		},
		removeChild(link) {
			const index = links.indexOf(link);
			if (index >= 0) links.splice(index, 1);
		},
	};
	const environment = {
		CineTraktStremioUrls: urlHelpers,
		chrome: { runtime },
		document: {
			body,
			createElement() {
				const link = {
					dataset: {},
					style: {},
					clickCount: 0,
					click() {
						this.clickCount += 1;
					},
				};
				createdLinks.push(link);
				return link;
			},
		},
		screen: {
			availLeft: -1920,
			availTop: 0,
			availWidth: 1920,
			availHeight: 1080,
		},
		window: { outerWidth: 1600, outerHeight: 900 },
		setTimeout(callback, delay) {
			delays.push({ callback, delay });
			return delays.length;
		},
	};

	return { environment, messages, delays, links, createdLinks };
}

function createMouseEvent({ type = 'click', button = 0 } = {}) {
	const calls = [];
	return {
		type,
		button,
		calls,
		preventDefault() { calls.push('preventDefault'); },
		stopPropagation() { calls.push('stopPropagation'); },
		stopImmediatePropagation() { calls.push('stopImmediatePropagation'); },
	};
}

test('screen bounds preserve the exact monitor geometry sent to the background', () => {
	const { environment } = createEnvironment();
	assert.deepEqual(getCurrentScreenBounds(environment), {
		availLeft: -1920,
		availTop: 0,
		availWidth: 1920,
		availHeight: 1080,
	});
});

test('left click sends one Stremio Web request and suppresses the native Trakt click', () => {
	const { environment, messages } = createEnvironment();
	const opener = createStremioOpener(environment);
	const event = createMouseEvent();

	assert.equal(opener.openFromMouseEvent('stremio:///detail/movie/tt1160419', event), true);
	assert.deepEqual(event.calls, ['preventDefault', 'stopPropagation', 'stopImmediatePropagation']);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].type, 'WATCH_ON_STREMIO_OPEN_WEB');
	assert.match(messages[0].url, /^https:\/\/web\.stremio\.com\/\?wos_stream_panel=1&wos_t=\d+#\/detail\/movie\/tt1160419$/);
	assert.deepEqual(messages[0].screenBounds, getCurrentScreenBounds(environment));
});

test('context menu keeps the existing native protocol attempts and sends no web request', () => {
	const { environment, messages, delays, links, createdLinks } = createEnvironment();
	const opener = createStremioOpener(environment);
	const event = createMouseEvent({ type: 'contextmenu', button: 2 });

	assert.equal(opener.openFromMouseEvent('stremio:///detail/series/tt14688458', event), true);
	assert.equal(messages.length, 0);
	assert.deepEqual(delays.map(({ delay }) => delay), NATIVE_RETRY_DELAYS);
	assert.equal(createdLinks.length, 1);
	assert.equal(createdLinks[0].clickCount, 1);
	assert.equal(createdLinks[0].href, 'stremio:///detail/series/tt14688458');
	delays.forEach(({ callback }) => callback());
	assert.equal(createdLinks.length, 3);
	assert.ok(createdLinks.every((link) => link.clickCount === 1));
	assert.equal(links.length, 0);
});

test('missing extension runtime fails quietly without opening a browser fallback', () => {
	const { environment, messages } = createEnvironment();
	environment.chrome.runtime.id = '';
	const opener = createStremioOpener(environment);

	assert.equal(opener.openWeb('stremio:///detail/movie/tt1160419'), false);
	assert.equal(messages.length, 0);
});
