const test = require('node:test');
const assert = require('node:assert/strict');

const {
	getTraktMediaType,
	buildStremioDetailUrl,
	buildStremioEpisodeUrl,
	getStremioWebUrl,
	getStremioPopupUrl,
	isStremioWebUrl,
	getSeasonEpisodeFromText,
	getEpisodeDataFromTraktUrl,
} = require('../stremio-url.js');

test('Trakt movie and show pages produce exact Stremio detail URLs', () => {
	assert.equal(getTraktMediaType('https://app.trakt.tv/movies/dune-2021'), 'movie');
	assert.equal(getTraktMediaType('https://app.trakt.tv/shows/silo'), 'series');
	assert.equal(buildStremioDetailUrl('movie', 'tt1160419'), 'stremio:///detail/movie/tt1160419');
	assert.equal(buildStremioDetailUrl('series', 'tt14688458'), 'stremio:///detail/series/tt14688458');
});

test('episode URLs keep the encoded Stremio video identifier', () => {
	assert.equal(
		buildStremioEpisodeUrl('tt14688458', 3, 7),
		'stremio:///detail/series/tt14688458/tt14688458%3A3%3A7',
	);
});

test('season and episode parsing supports the separators used by Trakt', () => {
	assert.deepEqual(getSeasonEpisodeFromText('S3 · E7 The Last Dive'), { season: 3, episode: 7 });
	assert.deepEqual(getSeasonEpisodeFromText('S 03 • E 07'), { season: 3, episode: 7 });
	assert.deepEqual(getSeasonEpisodeFromText('S3 - E7'), { season: 3, episode: 7 });
	assert.equal(getSeasonEpisodeFromText('Episode 7'), null);
});

test('episode detail routes expose their parent show URL', () => {
	assert.deepEqual(
		getEpisodeDataFromTraktUrl(
			'https://app.trakt.tv/shows/silo/seasons/3/episodes/7?mode=media',
			'https://app.trakt.tv',
		),
		{
			showSlug: 'silo',
			season: 3,
			episode: 7,
			showUrl: 'https://app.trakt.tv/shows/silo',
		},
	);
});

test('current Trakt episode drawer routes expose their parent show URL', () => {
	assert.deepEqual(
		getEpisodeDataFromTraktUrl(
			'https://app.trakt.tv/shows/the-witcher-2019?view=episode&season=4&episode=1&mode=media',
		),
		{
			showSlug: 'the-witcher-2019',
			season: 4,
			episode: 1,
			showUrl: 'https://app.trakt.tv/shows/the-witcher-2019',
		},
	);
	assert.equal(
		getEpisodeDataFromTraktUrl(
			'https://app.trakt.tv/shows/the-witcher-2019?mode=media&season=4',
		),
		null,
	);
});

test('web URLs keep episode colons readable by the Stremio router', () => {
	const episodeUrl = buildStremioEpisodeUrl('tt14688458', 3, 7);
	assert.equal(
		getStremioWebUrl(episodeUrl),
		'https://web.stremio.com/#/detail/series/tt14688458/tt14688458:3:7',
	);
});

test('popup flags stay before the Stremio hash and never use the removed retry flag', () => {
	const popupUrl = getStremioPopupUrl('stremio:///detail/movie/tt1160419', 1234);
	assert.equal(
		popupUrl,
		'https://web.stremio.com/?wos_stream_panel=1&wos_t=1234#/detail/movie/tt1160419',
	);
	assert.doesNotMatch(popupUrl, /wos_retry/);
});

test('Stremio Web validation only accepts CineTrakt detail popup URLs', () => {
	const movieUrl = getStremioPopupUrl('stremio:///detail/movie/tt0111161', 123);
	const episodeUrl = getStremioPopupUrl('stremio:///detail/series/tt1520211/tt1520211%3A3%3A1', 123);
	assert.equal(isStremioWebUrl(movieUrl), true);
	assert.equal(isStremioWebUrl(episodeUrl), true);
	assert.equal(isStremioWebUrl('https://web.stremio.com/'), false);
	assert.equal(isStremioWebUrl('https://example.com/?wos_stream_panel=1#/detail/movie/tt0111161'), false);
});
