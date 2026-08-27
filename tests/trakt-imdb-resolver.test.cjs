const test = require('node:test');
const assert = require('node:assert/strict');

const {
	TRAKT_API_CLIENT_ID,
	parseTraktMediaPath,
	findImdbIdInTraktResponse,
	getTraktApiMediaUrl,
	getTraktMediaIdFromImageUrl,
} = require('../trakt-imdb-resolver.js');

test('Trakt movie and show paths are normalized for the official API resolver', () => {
	assert.deepEqual(parseTraktMediaPath('/movies/Dune-2021?mode=media'), {
		kind: 'movies',
		slug: 'dune-2021',
		pathname: '/movies/dune-2021',
	});
	assert.equal(
		getTraktApiMediaUrl('/shows/Silo'),
		'https://api.trakt.tv/shows/silo?extended=full',
	);
	assert.match(TRAKT_API_CLIENT_ID, /^[a-f0-9]{64}$/);
});

test('the resolver rejects paths outside exact movie and show detail routes', () => {
	assert.equal(parseTraktMediaPath('/shows/silo/seasons/1'), null);
	assert.equal(parseTraktMediaPath('https://evil.example/movies/dune-2021'), null);
	assert.equal(getTraktApiMediaUrl('/users/test'), '');
});

test('IMDb IDs are extracted only from valid official Trakt API responses', () => {
	assert.equal(findImdbIdInTraktResponse({ ids: { imdb: 'tt10648342' } }), 'tt10648342');
	assert.equal(findImdbIdInTraktResponse('{"ids":{"imdb":"tt14688458"}}'), 'tt14688458');
	assert.equal(findImdbIdInTraktResponse({ ids: { imdb: 'invalid' } }), '');
	assert.equal(findImdbIdInTraktResponse('<html></html>'), '');
});

test('Trakt numeric media IDs are recovered from official card images', () => {
	assert.equal(
		getTraktMediaIdFromImageUrl(
			'https://media.trakt.tv/images/shows/000/138/163/posters/medium/395fb195f3.jpg.webp',
			'shows',
		),
		'138163',
	);
	assert.equal(
		getTraktMediaIdFromImageUrl(
			'https://media.trakt.tv/images/movies/000/459/282/posters/medium/c27dc76364.jpg.webp',
			'movies',
		),
		'459282',
	);
	assert.equal(getTraktMediaIdFromImageUrl('https://evil.example/images/shows/000/138/163/poster.jpg'), '');
	assert.equal(
		getTraktMediaIdFromImageUrl(
			'https://media.trakt.tv/images/movies/000/459/282/posters/medium/c27dc76364.jpg.webp',
			'shows',
		),
		'',
	);
});
