const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getFallbackDisplayBounds,
	getImdbRatingsPopupLayout,
	getPopupLayout,
	getResizedImdbRatingsPopupLayout,
	pickBestDisplayForWindow,
} = require('../window-layout.js');

test('Stremio popup layout keeps the established ultrawide geometry', () => {
	assert.deepEqual(getPopupLayout({ left: 0, top: 0, width: 1920, height: 1080 }), {
		trakt: { left: -7, top: -6, width: 1340, height: 1094 },
		popup: { left: 1318, top: -6, width: 609, height: 1094 },
	});
});

test('Stremio popup remains bounded on a narrow display', () => {
	const layout = getPopupLayout({ left: 100, top: 40, width: 1000, height: 700 });
	assert.ok(layout.trakt.width > 0);
	assert.ok(layout.popup.width > 0);
	assert.ok(layout.popup.left >= layout.trakt.left);
	assert.ok(layout.popup.left + layout.popup.width <= 100 + 1000 + 8);
});

test('display selection favors the largest intersection', () => {
	const displays = [
		{ id: 'left', workArea: { left: -1920, top: 0, width: 1920, height: 1080 } },
		{ id: 'right', workArea: { left: 0, top: 0, width: 2560, height: 1440 } },
	];
	assert.equal(pickBestDisplayForWindow({ left: 300, top: 100, width: 1200, height: 900 }, displays).id, 'right');
});

test('IMDb ratings layouts stay centered and clamped to the work area', () => {
	const display = { left: 1920, top: 0, width: 2560, height: 1400 };
	assert.deepEqual(getImdbRatingsPopupLayout(display), {
		left: 2540,
		top: 250,
		width: 1320,
		height: 900,
	});
	assert.deepEqual(getResizedImdbRatingsPopupLayout(display, 9999, 100), {
		left: 1960,
		top: 550,
		width: 2480,
		height: 300,
	});
});

test('screen bounds fallback preserves browser-provided monitor coordinates', () => {
	assert.deepEqual(getFallbackDisplayBounds(null, {
		availLeft: -1920,
		availTop: 0,
		availWidth: 1920,
		availHeight: 1040,
	}), { left: -1920, top: 0, width: 1920, height: 1040 });
});
