const test = require('node:test');
const assert = require('node:assert/strict');

const {
	MIN_BOOTSTRAP_VIEWPORT_WIDTH,
	MIN_STICKY_RIGHT_CONTENT_WIDTH,
	canBootstrapStickyLayout,
	canUseStickyLayout,
	getRightListInnerWidth,
	getRightContentWidth,
	getViewportWidth,
	getStickyPosterSize,
	getPosterAspectRatio,
	getDetailedPosterUrl,
} = require('../poster-layout-utils.js');

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
	const contentLeft = viewportWidth - 12 - MIN_STICKY_RIGHT_CONTENT_WIDTH;

	assert.equal(getRightContentWidth(viewportWidth, contentLeft), MIN_STICKY_RIGHT_CONTENT_WIDTH);
	assert.equal(getRightListInnerWidth(viewportWidth, contentLeft), MIN_STICKY_RIGHT_CONTENT_WIDTH - 24);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft), true);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft + 1), false);
	assert.equal(canUseStickyLayout(900, 100), false);
});

test('native card sizing leaves complete cards before the trailing list mask', () => {
	for (const viewportWidth of [1280, 1440, 1660, 1899, 2293]) {
		for (const sideInset of [16, 24, 32]) {
			const contentLeft = 758;
			const area = getRightContentWidth(viewportWidth, contentLeft);
			const inner = getRightListInnerWidth(viewportWidth, contentLeft, sideInset);
			for (const minimum of [120, 132, 200, 340]) {
				const gap = 12;
				const count = Math.max(1, Math.floor(inner / (minimum + gap)));
				const cardWidth = Math.max(minimum, inner / count - gap);
				const finalCardRight = count * cardWidth + (count - 1) * gap;
				assert.ok(finalCardRight <= area - sideInset, 'last complete card must precede the mask');
				assert.ok(finalCardRight + gap >= area - sideInset - 0.01, 'next card starts under the mask');
				// Browser zoom rounds the carousel and individual cards separately.
				// Include both that subpixel difference and the native hover outline.
				for (const fractionalRemainder of [0, 0.5, 0.99]) {
					const maskEdge = area + fractionalRemainder - sideInset - 4;
					const outline = 8 / 3;
					assert.ok(finalCardRight + outline < maskEdge, 'last visible hover outline stays complete');
					assert.ok(finalCardRight + gap - outline > maskEdge, 'next hover outline stays hidden');
				}
			}
		}
	}
});

test('a 1440p split window keeps a full-height poster and stacks the right content', () => {
	const size = getStickyPosterSize(1280, 208, 800, 2 / 3);
	assert.equal(size.width, 533);
	assert.ok(size.height >= 799);
	assert.equal(canUseStickyLayout(1280, 208 + size.width + 16), true);
});

test('narrow desktop windows reduce the poster gradually while reserving readable content', () => {
	const size = getStickyPosterSize(1100, 208, 800, 2 / 3);
	assert.equal(size.width, 504);
	assert.equal(size.height, 756);
	assert.equal(getRightContentWidth(1100, 208 + size.width + 16), 360);
});
