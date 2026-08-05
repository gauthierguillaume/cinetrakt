const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntime } = require('../dom-runtime.js');

function createEventTarget() {
	const listeners = new Map();
	return {
		addEventListener(type, listener) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type).add(listener);
		},
		removeEventListener(type, listener) {
			listeners.get(type)?.delete(listener);
		},
		dispatch(type) {
			listeners.get(type)?.forEach((listener) => listener());
		},
	};
}

function createEnvironment() {
	const windowEvents = createEventTarget();
	const documentEvents = createEventTarget();
	const timers = new Map();
	let nextTimerId = 1;
	let mutationHandler = null;
	let observerDisconnected = false;
	let settingsListener = null;
	let settingsUnsubscribed = false;

	class MutationObserver {
		constructor(handler) {
			mutationHandler = handler;
		}
		observe() {}
		disconnect() {
			observerDisconnected = true;
		}
	}

	const environment = {
		...windowEvents,
		location: { pathname: '/movies/example', search: '', hash: '' },
		document: {
			...documentEvents,
			documentElement: {},
			body: {},
			visibilityState: 'visible',
		},
		MutationObserver,
		setTimeout(callback) {
			const id = nextTimerId;
			nextTimerId += 1;
			timers.set(id, callback);
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		CineTraktSettings: {
			onChange(listener) {
				settingsListener = listener;
				return () => {
					settingsUnsubscribed = true;
				};
			},
		},
	};

	return {
		environment,
		mutate(mutations) {
			mutationHandler(mutations);
		},
		notifySettings() {
			settingsListener();
		},
		async runNextTimer() {
			const next = timers.entries().next().value;
			assert.ok(next, 'a scheduled update was expected');
			const [id, callback] = next;
			timers.delete(id);
			await callback();
		},
		get timerCount() {
			return timers.size;
		},
		get observerDisconnected() {
			return observerDisconnected;
		},
		get settingsUnsubscribed() {
			return settingsUnsubscribed;
		},
	};
}

function element(className) {
	return { nodeType: 1, id: '', classList: className ? [className] : [] };
}

test('shared DOM runtime ignores owned mutations and reacts to native or route changes', async () => {
	const harness = createEnvironment();
	const updates = [];
	const runtime = createRuntime({
		environment: harness.environment,
		ownedMarker: /^cinetrakt(?:-|$)/,
		subscribeToSettings: true,
	});
	runtime.start(async (context) => updates.push(context));
	await harness.runNextTimer();

	assert.equal(updates.length, 1);
	assert.equal(updates[0].routeChanged, true);
	assert.deepEqual(updates[0].reasons, ['initial']);

	harness.mutate([{ target: element('cinetrakt-owned'), addedNodes: [], removedNodes: [] }]);
	assert.equal(harness.timerCount, 0);

	harness.mutate([{ target: element('native-card'), addedNodes: [], removedNodes: [] }]);
	await harness.runNextTimer();
	assert.equal(updates.at(-1).routeChanged, false);

	harness.environment.location.search = '?season=2';
	harness.mutate([{ target: element('cinetrakt-owned'), addedNodes: [], removedNodes: [] }]);
	await harness.runNextTimer();
	assert.equal(updates.at(-1).routeChanged, true);

	harness.notifySettings();
	await harness.runNextTimer();
	assert.deepEqual(updates.at(-1).reasons, ['settings-change']);

	harness.environment.dispatch('pagehide');
	assert.equal(harness.observerDisconnected, true);
	assert.equal(harness.settingsUnsubscribed, true);
});
