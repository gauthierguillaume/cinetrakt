const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getFallbackDisplayBounds,
	getPopupLayout,
	pickBestDisplayForWindow,
} = require('../window-layout.js');

test('Stremio layout uses the browser-accepted minimum and gives remaining width to Trakt', () => {
	assert.deepEqual(getPopupLayout({ left: 0, top: 0, width: 1920, height: 1080 }, 400), {
		trakt: { left: -7, top: -6, width: 1549, height: 1094 },
		popup: { left: 1527, top: -6, width: 400, height: 1094 },
	});
	assert.equal(getPopupLayout({ width: 2560, height: 1440 }).popup.width, 1);
});

test('Stremio popup remains bounded on a narrow display', () => {
	const layout = getPopupLayout({ left: 100, top: 40, width: 1000, height: 700 });
	assert.ok(layout.trakt.width > 0);
	assert.ok(layout.popup.width > 0);
	assert.ok(layout.popup.left >= layout.trakt.left);
	assert.ok(layout.popup.left + layout.popup.width <= 100 + 1000 + 7);
});

test('Stremio keeps its minimum width and visible right border on the selected monitor', () => {
	for (const left of [-3440, 0, 2560]) {
		for (const width of [1920, 2560, 3440]) {
			const layout = getPopupLayout({ left, top: 0, width, height: 1440 }, 516);
			assert.equal(layout.popup.width, 516);
			// The outer bounds include the seven-pixel invisible Windows frame.
			assert.equal(layout.popup.left + layout.popup.width - 7, left + width);
			assert.equal(layout.trakt.left + layout.trakt.width - layout.popup.left, 15);
		}
	}
});

test('display selection favors the largest intersection', () => {
	const displays = [
		{ id: 'left', workArea: { left: -1920, top: 0, width: 1920, height: 1080 } },
		{ id: 'right', workArea: { left: 0, top: 0, width: 2560, height: 1440 } },
	];
	assert.equal(pickBestDisplayForWindow({ left: 300, top: 100, width: 1200, height: 900 }, displays).id, 'right');
});

test('screen bounds fallback preserves browser-provided monitor coordinates', () => {
	assert.deepEqual(getFallbackDisplayBounds(null, {
		availLeft: -1920,
		availTop: 0,
		availWidth: 1920,
		availHeight: 1040,
	}), { left: -1920, top: 0, width: 1920, height: 1040 });
});
