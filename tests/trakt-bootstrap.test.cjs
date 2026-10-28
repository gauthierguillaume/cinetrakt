const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
	const classes = new Set(), timers = new Map(), listeners = new Map();
	let resolveSettings, changeSettings, nextId = 0;
	const location = { pathname: '/shows/reacher' };
	const root = { clientWidth: 1920, classList: {
		toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
		remove(name) { classes.delete(name); },
	} };
	vm.runInNewContext(fs.readFileSync(require.resolve('../trakt-bootstrap.js'), 'utf8'), {
		document: { documentElement: root },
		window: { location, innerWidth: 1920, addEventListener(name, fn) { listeners.set(name, fn); },
			setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, delay }); return id; },
			clearTimeout(id) { timers.delete(id); } },
		CineTraktPosterLayoutUtils: require('../poster-layout-utils.js'),
		CineTraktSettings: { ready: new Promise(resolve => { resolveSettings = resolve; }),
			onChange(fn) { changeSettings = fn; return () => {}; } },
	});
	return { classes, timers, location, resolveSettings, changeSettings, listeners };
}

test('first-render ratings space is scoped to detail pages and restores the native fallback after a bounded wait', () => {
	const f = fixture();
	assert.ok(f.classes.has('cinetrakt-rating-cards-enabled'));
	assert.ok(f.classes.has('cinetrakt-ratings-pending'));
	assert.equal(f.timers.size, 1);
	const timer = [...f.timers.values()][0]; assert.equal(timer.delay, 4000); timer.fn();
	assert.equal(f.classes.has('cinetrakt-ratings-pending'), false);
	f.listeners.get('resize')(); assert.equal(f.classes.has('cinetrakt-ratings-pending'), false, 'resize cannot hide a settled row again');
	f.location.pathname = '/movies/rocky-1976'; f.listeners.get('popstate')();
	assert.ok(f.classes.has('cinetrakt-ratings-pending'));
	f.location.pathname = '/users/me/progress'; f.listeners.get('popstate')();
	assert.equal(f.classes.has('cinetrakt-rating-cards-enabled'), false);
	assert.equal(f.classes.has('cinetrakt-ratings-pending'), false);
});

test('disabled settings reveal native ratings and resizing preserves both independent preferences', async () => {
	const f = fixture();
	f.resolveSettings({ traktPosterLayout: true, traktRatingsToggle: false }); await new Promise(setImmediate);
	assert.equal(f.classes.has('cinetrakt-rating-cards-enabled'), false);
	assert.equal(f.classes.has('cinetrakt-ratings-pending'), false);
	assert.ok(f.classes.has('cinetrakt-poster-layout-enabled'));
	f.listeners.get('resize')(); assert.equal(f.classes.has('cinetrakt-rating-cards-enabled'), false);
	f.changeSettings({ traktPosterLayout: false, traktRatingsToggle: true });
	assert.equal(f.classes.has('cinetrakt-poster-layout-enabled'), false);
	assert.ok(f.classes.has('cinetrakt-rating-cards-enabled'));
	f.listeners.get('resize')(); assert.equal(f.classes.has('cinetrakt-poster-layout-enabled'), false);
	f.listeners.get('pagehide')(); assert.equal(f.timers.size, 0);
});
