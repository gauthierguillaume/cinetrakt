const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getBackdropPaths,
	getImagePreferences,
	getMediaConfiguration,
	getPreferredPosterPath,
	isBearerToken,
	shuffle,
} = require('../tmdb-utils.js');

test('French originals prefer French artwork while other titles prefer English', () => {
	assert.deepEqual(getImagePreferences('fr').posterLanguages, ['fr', null, 'en']);
	assert.deepEqual(getImagePreferences('ko').posterLanguages, ['en', null]);
});

test('poster selection respects language priority before popularity', () => {
	const details = { images: { posters: [
		{ file_path: '/ko.jpg', iso_639_1: 'ko', vote_count: 999, vote_average: 10, width: 2000 },
		{ file_path: '/en.jpg', iso_639_1: 'en', vote_count: 4, vote_average: 7, width: 1000 },
		{ file_path: '/neutral.jpg', iso_639_1: null, vote_count: 20, vote_average: 9, width: 1200 },
	] } };
	assert.equal(getPreferredPosterPath(details, ['en', null]), '/en.jpg');
});

test('backdrops are quality-sorted and deduplicated', () => {
	assert.deepEqual(getBackdropPaths({
		backdrop_path: '/hero.jpg',
		images: { backdrops: [
			{ file_path: '/secondary.jpg', vote_count: 2, vote_average: 9, width: 1000 },
			{ file_path: '/hero.jpg', vote_count: 4, vote_average: 8, width: 1200 },
		] },
	}), ['/hero.jpg', '/secondary.jpg']);
});

test('media configuration maps TMDB types to direct Trakt routes', () => {
	assert.equal(getMediaConfiguration('movie').traktPath, 'movies');
	assert.equal(getMediaConfiguration('tv').traktPath, 'shows');
});

test('credential and shuffle helpers are deterministic when supplied a random source', () => {
	assert.equal(isBearerToken('short-api-key'), false);
	assert.equal(isBearerToken(`eyJ${'a'.repeat(20)}`), true);
	assert.deepEqual(shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});
