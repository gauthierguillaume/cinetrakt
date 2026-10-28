const test = require('node:test');
const assert = require('node:assert/strict');

const { isRatingsDataMode } = require('../imdb-page.js');

test('IMDb data collection requires its explicit marker', () => {
	const dataPage = { search: '?cinetrakt_ratings_data=1' };
	assert.equal(isRatingsDataMode(dataPage), true);
	for (const search of ['', '?cinetrakt_ratings_popup=1', '?cinetrakt_ratings_data=0']) {
		assert.equal(isRatingsDataMode({ search }), false);
	}
});

test('regular IMDb pages and old popup URLs never start data collection', () => {
	assert.equal(isRatingsDataMode({ search: '' }), false);
	assert.equal(isRatingsDataMode({ search: '?cinetrakt_ratings_popup=1' }), false);
	assert.equal(isRatingsDataMode(null), false);
});
