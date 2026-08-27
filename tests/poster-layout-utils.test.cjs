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
} = require('../poster-layout-utils.js');

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
	assert.equal(getRightListInnerWidth(viewportWidth, contentLeft), MIN_STICKY_RIGHT_CONTENT_WIDTH);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft), true);
	assert.equal(canUseStickyLayout(viewportWidth, contentLeft + 1), false);
	assert.equal(canUseStickyLayout(900, 100), false);
});
