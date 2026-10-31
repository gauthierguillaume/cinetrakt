const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const {
	MIN_BOOTSTRAP_VIEWPORT_WIDTH,
	MIN_STICKY_RIGHT_CONTENT_WIDTH,
	canBootstrapStickyLayout,
	canUseStickyLayout,
	getRightContentWidth,
	getViewportWidth,
	getStickyPosterSize,
	getPosterAspectRatio,
	getDetailedPosterUrl,
} = require('../poster-layout-utils.js');

test('the fixed poster uses the native visible row clearance on every side, regardless of summary offsets', () => {
	const source = fs.readFileSync(require.resolve('../trakt-poster-layout.js'), 'utf8');
	const metricsFunction = source.slice(source.indexOf('function getCinetraktStickyPosterMetrics('),
		source.indexOf('function scheduleCinetraktStickyPosterBoundsCorrection('));
	for (const fontSize of [16, 20]) {
		const root = { clientHeight: 1000 };
		const summary = {};
		const context = vm.createContext({
			document: { documentElement: root, querySelector: () => ({ getBoundingClientRect: () => ({ right: 192 }) }) },
			window: { innerHeight: 1000, visualViewport: { height: 1000 } },
			getComputedStyle: element => element === root ? { fontSize: `${fontSize}px` } : {
				columnGap: '32px', paddingTop: '38px',
				getPropertyValue: name => ({ '--layout-distance-side': '1.5rem', '--list-gap': '.75rem' })[name] || '',
			},
			getCinetraktViewportWidth: () => 2372, getStickyPosterSize,
		});
		vm.runInContext(metricsFunction, context);
		const metrics = context.getCinetraktStickyPosterMetrics({ summaryContainer: summary,
			posterImage: { naturalWidth: 1000, naturalHeight: 1500 }, posterAspectRatio: 2 / 3,
			posterFooterHeight: 112, posterDecorationOverflow: 10 });
		const clearance = fontSize * 2.25;
		assert.equal(metrics.posterTop, clearance);
		assert.equal(metrics.summaryLeft - 192, clearance);
		assert.equal(metrics.contentLeft - metrics.summaryLeft - metrics.width, clearance);
		assert.equal(metrics.sideInset, clearance);
		assert.equal(metrics.posterBottomSafety, clearance);
		assert.ok(metrics.posterTop + metrics.height + 112 + 10 <= 1000 - clearance);
	}
});

test('poster geometry does not depend on network completion or a successful image decode', () => {
	assert.equal(getPosterAspectRatio({ complete: false, naturalWidth: 0, naturalHeight: 0,
		getBoundingClientRect: () => ({ width: 300, height: 450 }) }), 2 / 3);
	assert.equal(getPosterAspectRatio({ width: 400, height: 600 }), 2 / 3);
	assert.equal(getPosterAspectRatio({ naturalWidth: 800, naturalHeight: 1200 }), 2 / 3);
	assert.equal(getPosterAspectRatio({ naturalWidth: 0, naturalHeight: 0 }), 2 / 3);
});

test('detail posters promote native thumbnails without inventing unavailable originals or external sources', () => {
	const url = 'https://media.trakt.tv/images/shows/000/155/536/posters/medium/c15067608d.jpg.webp';
	assert.equal(getDetailedPosterUrl(url.replace('/medium/', '/thumb/')), url);
	assert.equal(getDetailedPosterUrl(url), url);
	const original = url.replace('/medium/', '/original/');
	assert.equal(getDetailedPosterUrl(original), original);
	for (const invalid of [url + '?token=x', url + '#x', url.replace('media.trakt.tv', 'other.test'),
		url.replace('/posters/', '/fanarts/'), 'javascript:alert(1)', '']) assert.equal(getDetailedPosterUrl(invalid), '');
});

test('viewport measurements use the smallest positive browser value', () => {
	assert.equal(getViewportWidth(1280, 1278, 1260), 1260);
	assert.equal(getViewportWidth(0, Number.NaN, 1180), 1180);
	assert.equal(getViewportWidth(), 0);
});

test('sticky layout only starts on a genuinely wide viewport', () => {
	assert.equal(canBootstrapStickyLayout(MIN_BOOTSTRAP_VIEWPORT_WIDTH - 1), false);
	assert.equal(canBootstrapStickyLayout(MIN_BOOTSTRAP_VIEWPORT_WIDTH), true);
});

test('sticky poster preserves enough width for Trakt responsive content', () => {
	const viewportWidth = 1280;
	const contentLeft = viewportWidth - 36 - MIN_STICKY_RIGHT_CONTENT_WIDTH;

	assert.equal(getRightContentWidth(viewportWidth, contentLeft), MIN_STICKY_RIGHT_CONTENT_WIDTH);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft), true);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft + 1), false);
	assert.equal(canUseStickyLayout(900, 100), false);
});

test('native spacing reserves readable content at desktop, split-window and scaled sizes', () => {
	for (const viewportWidth of [1024, 1100, 1280, 1440, 2372]) {
		for (const sideInset of [24, 36, 45, 48]) {
			const posterLeft = 192 + sideInset;
			const gap = sideInset;
			const size = getStickyPosterSize(viewportWidth, posterLeft, 800, 2 / 3, gap, sideInset);
			const contentLeft = posterLeft + size.width + gap;
			const inner = getRightContentWidth(viewportWidth, contentLeft, sideInset);
			assert.ok(inner >= MIN_STICKY_RIGHT_CONTENT_WIDTH);
			assert.equal(canUseStickyLayout(viewportWidth, contentLeft, sideInset), true);
			assert.ok(contentLeft + inner <= viewportWidth - sideInset);
			assert.ok(size.height <= 800);
		}
	}
});

test('a 1440p split window keeps a full-height poster and stacks the right content', () => {
	const size = getStickyPosterSize(1280, 228, 800, 2 / 3);
	assert.equal(size.width, 533);
	assert.ok(size.height >= 799);
	assert.equal(canUseStickyLayout(1280, 228 + size.width + 36), true);
});

test('narrow desktop windows reduce the poster gradually while reserving readable content', () => {
	const size = getStickyPosterSize(1100, 228, 800, 2 / 3);
	assert.equal(size.width, 440);
	assert.equal(size.height, 660);
	assert.equal(getRightContentWidth(1100, 228 + size.width + 36), 360);
});
