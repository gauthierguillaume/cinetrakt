const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { getPopupLayout } = require('../window-layout.js');
const source = fs.readFileSync(require.resolve('../background.js'), 'utf8');
const displayBounds = { left: 0, top: 0, width: 3440, height: 1440 };
const layout = { ...getPopupLayout(displayBounds), displayBounds };
const fitted = getPopupLayout(displayBounds, 516);

function fixture({ state = 'maximized', ignoredBounds = 0, restoringDelay = 250, existing = false, failBounds = false, cachedWidth = 516 } = {}) {
	let now = 0; let nextId = 0; let savedId = existing ? 2 : null;
	const timers = new Map(); const restoring = new Set(); const calls = []; const replies = [];
	const windows = new Map([[1, { id: 1, state, left: 0, top: 0, width: 3440, height: 1440 }]]);
	if (existing) windows.set(2, { id: 2, state: 'normal', left: 0, top: 0, width: 900, height: 900, tabs: [{ id: 20 }] });
	const later = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; };
	const local = { cinetraktStremioMinimumWidth: cachedWidth }; const session = {};
	const storage = (data) => ({
		get(key, callback) { callback({ [key]: data[key] }); },
		set(values, callback) { Object.assign(data, values); callback?.(); },
		remove(key, callback) { delete data[key]; callback?.(); },
	});
	const chrome = { runtime: { lastError: null }, storage: { local: storage(local), session: storage(session) }, windows: {
		get(id, options, callback) {
			if (typeof options === 'function') callback = options;
			callback(windows.has(id) ? { ...windows.get(id) } : undefined);
		},
		update(id, info, callback) {
			calls.push({ kind: 'update', id, info: { ...info } });
			const win = windows.get(id);
			if (!win) { callback(); return; }
			if (info.state === 'normal' && win.state !== 'normal') {
				if (!restoring.has(id)) {
					restoring.add(id); later(() => { win.state = 'normal'; }, restoringDelay);
				}
			} else if ('width' in info) {
				assert.equal(win.state, 'normal', 'bounds must wait until restoration actually finishes');
				assert.equal(info.state, undefined, 'restoring and changing bounds are separate requests');
				if (id === 1 && failBounds) {
					chrome.runtime.lastError = { message: 'Window is still transitioning' };
					callback(); chrome.runtime.lastError = null; return;
				}
				if (id === 1 && ignoredBounds > 0) ignoredBounds--;
				else Object.assign(win, info, { width: Math.max(516, info.width) });
			} else Object.assign(win, info);
			callback({ ...win });
		},
		create(info, callback) {
			calls.push({ kind: 'create', info: { ...info }, sourceState: windows.get(1).state });
			const win = { ...info, id: 2, state: 'normal', width: Math.max(516, info.width), tabs: [{ id: 20 }] };
			windows.set(2, win); callback({ ...win });
		},
	}, tabs: {
		update(id, info, callback) { calls.push({ kind: 'navigate', id, info }); callback(); },
	} };
	const makeContext = () => {
	const context = vm.createContext({ chrome, getPopupLayout, setTimeout: later,
		STREMIO_SOURCE_STATE_KEY: 'cinetraktStremioSourceState', STREMIO_MIN_WIDTH_KEY: 'cinetraktStremioMinimumWidth',
		stremioPlacementJobs: new Map(), stremioClosedDuringPlacement: new Set(),
		saveWindowId: id => { savedId = id; }, getSavedWindowId: callback => callback(savedId),
		forgetWindowId: () => { savedId = null; },
	});
	vm.runInContext(source.slice(source.indexOf('function restoreStremioSourceState('), source.indexOf('function getDisplayBoundsForSource(')), context);
	vm.runInContext(source.slice(source.indexOf('function readLastError('), source.indexOf('const externalRatingsCache = new Map();')), context);
	return context;
	};
	let context = makeContext();
	return { get context() { return context; }, windows, calls, replies, session, local,
		restartWorker() { context = makeContext(); },
		closeWindow(id) { windows.delete(id); context.restoreStremioSourceAfterClose(id); },
		normalize(bounds = fitted.trakt) { context.normalizeWindowFast(1, bounds, (ok, win) => replies.push({ ok, win })); },
		open() { context.openOrReuseStremioWindow('https://web.stremio.com/#/detail/series/tt0460681/tt0460681:8:23', layout,
			{ tab: { windowId: 1 } }, response => replies.push(response)); },
		flush() {
			let count = 0;
			while (timers.size) {
				assert.ok(++count < 100, 'window retries must be bounded');
				const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
				timers.delete(id); now = timer.at; timer.fn();
			}
			return now;
		},
	};
}

test('a cold/restored browser waits for normal state and recovers bounds silently ignored by Vivaldi', () => {
	for (const state of ['maximized', 'fullscreen', 'minimized']) {
		const f = fixture({ state, ignoredBounds: 1 });
		f.normalize();
		assert.equal(f.replies.length, 0, 'the initial API callback alone is not success');
		f.flush();
		assert.equal(f.replies.length, 1);
		assert.equal(f.replies[0].ok, true);
		for (const key of ['left', 'top', 'width', 'height']) assert.equal(f.windows.get(1)[key], fitted.trakt[key]);
		assert.equal(f.calls.filter(call => call.id === 1 && 'width' in call.info).length, 2);
	}
});

test('already-positioned windows need no writes; persistent failures and closed windows terminate', () => {
	const positioned = fixture({ state: 'normal' });
	Object.assign(positioned.windows.get(1), fitted.trakt);
	positioned.normalize();
	assert.equal(positioned.replies[0].ok, true);
	assert.equal(positioned.calls.length, 0);
	for (const failBounds of [false, true]) {
		const failed = fixture({ state: 'normal', ignoredBounds: 99, failBounds });
		failed.normalize();
		assert.ok(failed.flush() <= 2000);
		assert.equal(failed.replies.length, 1);
		assert.equal(failed.replies[0].ok, false);
		assert.equal(failed.calls.filter(call => 'width' in call.info).length, 5);
	}
	const closed = fixture(); closed.windows.delete(1); closed.normalize();
	assert.equal(closed.replies[0].ok, false);
});

test('first opening and saved-window reuse place both windows on a single click without replaying navigation', () => {
	for (const existing of [false, true]) {
		const f = fixture({ existing, ignoredBounds: 1 });
		f.open(); f.flush();
		assert.equal(f.replies.length, 1);
		assert.equal(f.replies[0].ok, true);
		for (const [id, target] of [[1, fitted.trakt], [2, fitted.popup]]) {
			assert.equal(f.windows.get(id).state, 'normal');
			for (const key of ['left', 'top', 'width', 'height']) assert.equal(f.windows.get(id)[key], target[key]);
		}
		assert.equal(f.calls.filter(call => call.kind === 'create').length, existing ? 0 : 1);
		assert.equal(f.calls.filter(call => call.kind === 'navigate').length, existing ? 1 : 0);
		assert.equal(f.windows.get(2).focused, true);
	}
});

test('the final layout check repairs a late native restore of Trakt before completing the opening', () => {
	const f = fixture({ state: 'normal' });
	Object.assign(f.windows.get(1), fitted.trakt, { state: 'maximized', width: 3440 });
	f.context.focusStremioWindow(2, response => f.replies.push(response), 1, fitted.trakt);
	// This fixture only needs a live panel for the final focus step.
	f.windows.set(2, { id: 2, state: 'normal', ...fitted.popup });
	f.flush();
	assert.equal(f.replies[0].ok, true);
	assert.equal(f.windows.get(1).width, fitted.trakt.width);
});

test('new panels open unfocused on the right and are fitted before Trakt leaves fullscreen', () => {
	for (const cachedWidth of [516, 600, null]) {
		const f = fixture({ state: 'fullscreen', cachedWidth });
		f.open(); f.flush();
		const created = f.calls.find(call => call.kind === 'create');
		assert.equal(created.info.focused, false);
		assert.equal(created.info.state, 'normal');
		assert.equal(created.sourceState, 'fullscreen');
		assert.ok(created.info.left >= 2800, 'creation must be anchored at the right edge, not naturally on the left');
		if (cachedWidth === 600) {
			const panelFit = f.calls.findIndex(call => call.kind === 'update' && call.id === 2 && 'width' in call.info);
			const sourceRestore = f.calls.findIndex(call => call.kind === 'update' && call.id === 1 && call.info.state === 'normal');
			assert.ok(panelFit >= 0 && panelFit < sourceRestore);
		}
		assert.equal(f.local.cinetraktStremioMinimumWidth, 516);
	}
});

test('closing the panel restores the original state, preserved across repeated clicks and a service-worker restart', () => {
	for (const state of ['fullscreen', 'maximized', 'normal']) {
		const f = fixture({ state });
		f.open(); f.flush();
		f.open(); f.flush();
		assert.equal(f.session.cinetraktStremioSourceState.state, state, 'a second episode must not overwrite the original state with tiled normal');
		f.restartWorker();
		f.closeWindow(2); f.flush();
		assert.equal(f.windows.get(1).state, state);
		assert.equal(f.windows.get(1).focused, true);
		if (state === 'normal') {
			for (const [key, value] of Object.entries({ left: 0, top: 0, width: 3440, height: 1440 })) assert.equal(f.windows.get(1)[key], value);
		}
		assert.equal(f.session.cinetraktStremioSourceState, undefined);
	}
});

test('closing the source or an unrelated window never restores another window', () => {
	const f = fixture(); f.open(); f.flush();
	f.closeWindow(99);
	assert.ok(f.session.cinetraktStremioSourceState);
	f.closeWindow(1); f.closeWindow(2); f.flush();
	assert.equal(f.session.cinetraktStremioSourceState, undefined);
	assert.equal(f.calls.filter(call => call.kind === 'update' && call.info.state === 'maximized').length, 0);
});

test('closing a panel while fullscreen restoration is still running restores Trakt after pending placement finishes', () => {
	const f = fixture({ state: 'fullscreen' });
	f.open();
	assert.equal(f.replies.length, 0);
	f.closeWindow(2); f.flush();
	assert.equal(f.windows.get(1).state, 'fullscreen');
	assert.equal(f.session.cinetraktStremioSourceState, undefined);
});
