const test = require('node:test');
const assert = require('node:assert/strict');

const {
	TRAKT_API_CLIENT_ID,
	parseTraktMediaPath,
	findImdbIdInTraktResponse,
	getTraktApiMediaUrl,
	getTraktMediaIdFromImageUrl,
	getTraktApiRatingsUrl,
	findExternalRatingsInTraktResponse,
} = require('../trakt-imdb-resolver.js');

test('external cards use official ratings endpoints and preserve source URLs and vote counts', () => {
	assert.equal(getTraktApiRatingsUrl('/movies/Thunderbolts-2025?view=ratings'),
		'https://api.trakt.tv/movies/thunderbolts-2025/ratings?extended=all');
	assert.equal(getTraktApiRatingsUrl('/shows/silo'), 'https://api.trakt.tv/shows/silo/ratings?extended=all');
	for (const route of ['/movies/test/ratings', 'https://evil.example/movies/test']) {
		assert.equal(getTraktApiRatingsUrl(route), '');
	}
	assert.deepEqual(findExternalRatingsInTraktResponse({ letterboxd: { rating: 3.6, votes: 1800000, link: 'letterboxd.com/film/thunderbolts' },
		imdb: { rating: 7.1, votes: 275800, link: 'www.imdb.com/title/tt20969586' } }),
		{ mal: null, letterboxd: { rating: 3.6, url: 'https://letterboxd.com/film/thunderbolts', votes: 1800000 },
			imdb: { rating: 7.1, url: 'https://www.imdb.com/title/tt20969586', votes: 275800 } });
	assert.equal(findExternalRatingsInTraktResponse({ letterboxd: { rating: 0, link: 'https://letterboxd.com/film/test/' } }).letterboxd.rating, 0);
});

test('MyAnimeList uses the original /10 score, official anime link and optional vote count', () => {
	const ratings = findExternalRatingsInTraktResponse({ mal: { rating: 9.32, votes: 934800, link: 'myanimelist.net/anime/52991' } });
	assert.deepEqual(ratings, { imdb: null, letterboxd: null,
		mal: { rating: 9.32, votes: 934800, url: 'https://myanimelist.net/anime/52991' } });
	assert.equal(findExternalRatingsInTraktResponse({ mal: { rating: 0, link: 'https://myanimelist.net/anime/52991/Sousou_no_Frieren/' } }).mal.votes, null);
	assert.equal(findExternalRatingsInTraktResponse({ mal: { rating: 10, votes: 0, link: 'https://www.myanimelist.net/anime/52991' } }).mal.votes, 0);
});

test('MyAnimeList omits unavailable ratings and rejects invalid scores or mismatched links', () => {
	for (const mal of [null, {}, { rating: 9.3 },
		...[-1, 10.1, NaN, Infinity, '9.3', null].map(rating => ({ rating, link: 'myanimelist.net/anime/52991' })),
		...['https://myanimelist.net.evil.test/anime/52991', 'https://myanimelist.net@evil.test/anime/52991',
			'https://myanimelist.net/manga/52991', 'https://myanimelist.net/anime/0', 'https://myanimelist.net/anime/52991?redirect=other',
			'http://myanimelist.net/anime/52991', 'javascript:alert(1)'].map(link => ({ rating: 9.3, link }))]) {
		assert.equal(findExternalRatingsInTraktResponse({ mal }), null);
	}
	assert.equal(findExternalRatingsInTraktResponse({ imdb: { rating: 7, link: 'imdb.com/title/tt20969586' }, mal: null }).mal, null);
});

test('Letterboxd never invents a score or accepts a mismatched external destination', () => {
	for (const value of [null, {}, { letterboxd: { rating: 3.6 } },
		...[-1, 5.1, NaN, '3.6', null].map(rating => ({ letterboxd: { rating, link: 'letterboxd.com/film/test' } })),
		...['https://letterboxd.com.evil.test/film/test', 'https://letterboxd.com@evil.test/film/test',
			'https://letterboxd.com/film/test?redirect=other', 'https://letterboxd.com/member/', 'javascript:alert(1)']
			.map(link => ({ letterboxd: { rating: 3.6, link } }))]) {
		assert.equal(findExternalRatingsInTraktResponse(value), null);
	}
});

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
