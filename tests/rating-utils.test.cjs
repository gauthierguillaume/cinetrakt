const test = require('node:test');
const assert = require('node:assert/strict');

const {
	COLORS,
	getStarFillRatios,
	getScoreBucket,
	getStyleForRating,
	formatRating,
	parseDisplayRating,
	calculateAverage,
} = require('../rating-utils.js');

test('ratings use fixed integer buckets without color interpolation', () => {
	assert.equal(getScoreBucket(6), 6);
	assert.equal(getScoreBucket(6.1), 6);
	assert.equal(getScoreBucket(6.9), 6);
	assert.strictEqual(getStyleForRating(6.1), COLORS[6]);
	assert.strictEqual(getStyleForRating(6.9), COLORS[6]);
	assert.equal(getStyleForRating(6.1).bg, '#22c55e');
});

test('every rating band keeps the established CineTrakt palette', () => {
	const expected = {
		1: '#ef4444',
		2: '#ef4444',
		3: '#ef4444',
		4: '#f97316',
		5: '#eab308',
		6: '#22c55e',
		7: '#3b82f6',
		8: '#ec4899',
		9: '#8b5cf6',
		10: '#ffffff',
	};

	for (const [bucket, color] of Object.entries(expected)) {
		const rating = Number(bucket) === 10 ? 10 : Number(bucket) + 0.5;
		assert.equal(getStyleForRating(rating)?.bg, color);
	}
});

test('historical zero rating uses the first band while invalid values are rejected', () => {
	assert.equal(getScoreBucket(0), 1);
	assert.strictEqual(getStyleForRating(0), COLORS[1]);
	assert.equal(getStyleForRating(null), null);
	assert.equal(getStyleForRating(''), null);
	assert.equal(getStyleForRating(-0.1), null);
	assert.equal(getStyleForRating(10.1), null);
	assert.equal(getStyleForRating('not-a-rating'), null);
});

test('rating formatting and averages ignore invalid values', () => {
	assert.equal(formatRating(8), '8');
	assert.equal(formatRating(8.25), '8.3');
	assert.equal(formatRating(0), '');
	assert.equal(calculateAverage([6, 7, null, 'invalid', 8]), 7);
	assert.equal(calculateAverage([null, 0, 11]), null);
});

test('display ratings normalize percentages and decimal scores to the same scale', () => {
	assert.equal(parseDisplayRating('69%'), 6.9);
	assert.equal(parseDisplayRating('6,9'), 6.9);
	assert.equal(parseDisplayRating('10'), 10);
	assert.equal(parseDisplayRating('101%'), null);
	assert.equal(parseDisplayRating('Rate'), null);
});

test('star fill ratios preserve full and half stars', () => {
	assert.deepEqual(getStarFillRatios(7, 5), [1, 1, 1, 0.5, 0]);
	assert.deepEqual(getStarFillRatios(10, 5), [1, 1, 1, 1, 1]);
	assert.deepEqual(getStarFillRatios(0, 5), []);
});
