const test = require('node:test');
const assert = require('node:assert/strict');

const { isRatingsPopupMode } = require('../imdb-page.js');

test('IMDb popup mode is detected from its dedicated query parameter', () => {
	assert.equal(isRatingsPopupMode({ search: '?cinetrakt_ratings_popup=1' }), true);
	assert.equal(isRatingsPopupMode({ search: '?foo=1&cinetrakt_ratings_popup=1&bar=2' }), true);
});

test('regular IMDb pages are not treated as ratings popups', () => {
	assert.equal(isRatingsPopupMode({ search: '' }), false);
	assert.equal(isRatingsPopupMode({ search: '?cinetrakt_ratings_popup=0' }), false);
	assert.equal(isRatingsPopupMode(null), false);
});
