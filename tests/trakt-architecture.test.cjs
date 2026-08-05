const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const traktEntrySource = read('trakt.js');
const traktStremioSource = read('trakt-stremio-ui.js');
const traktRatingsSource = read('trakt-ratings.js');
const traktPosterSource = read('trakt-poster-layout.js');
const traktSoundtrackSource = read('trakt-soundtrack.js');
const traktCustomizationsSource = read('trakt-customizations.js');
const stremioSource = read('stremio.js');
const imdbEntrySource = read('imdb.js');
const imdbButtonSource = read('imdb-trakt-button.js');
const imdbRatingsSource = read('imdb-ratings.js');

const traktFeatureSource = [
	traktStremioSource,
	traktRatingsSource,
	traktPosterSource,
	traktSoundtrackSource,
	traktCustomizationsSource,
].join('\n');

function getContentScripts(match, runAt = 'document_idle') {
	return manifest.content_scripts.find((entry) => entry.matches.includes(match) && entry.run_at === runAt).js;
}

function assertOrdered(scripts, files) {
	for (const file of files) assert.ok(scripts.includes(file), `${file} is missing from the manifest`);
	for (let index = 1; index < files.length; index += 1) {
		assert.ok(
			scripts.indexOf(files[index - 1]) < scripts.indexOf(files[index]),
			`${files[index - 1]} must load before ${files[index]}`,
		);
	}
}

test('Trakt dependencies and feature modules load before the entry point', () => {
	const scripts = getContentScripts('https://app.trakt.tv/*');
	const earlyScripts = getContentScripts('https://app.trakt.tv/*', 'document_start');
	assertOrdered(earlyScripts, ['settings.js', 'trakt-bootstrap.js']);
	assert.equal(scripts.includes('settings.js'), false);
	assertOrdered(scripts, [
		'rating-utils.js',
		'extension-protocol.js',
		'stremio-url.js',
		'stremio-open.js',
		'trakt-imdb-cache.js',
		'spotify-protocol.js',
		'dom-runtime.js',
		'trakt-runtime.js',
		'trakt-stremio-ui.js',
		'trakt-ratings.js',
		'trakt-poster-layout.js',
		'trakt-soundtrack.js',
		'trakt-customizations.js',
		'trakt.js',
	]);
	assert.equal(scripts.includes('ratings-table.js'), false);
});

test('IMDb dependencies and feature modules load before the entry point', () => {
	const scripts = getContentScripts('https://www.imdb.com/title/*');
	assertOrdered(scripts, [
		'settings.js',
		'rating-utils.js',
		'extension-protocol.js',
		'dom-runtime.js',
		'imdb-runtime.js',
		'imdb-page.js',
		'imdb-trakt-button.js',
		'imdb-ratings.js',
		'imdb.js',
	]);
});

test('Spotify bridge protocol loads in both communicating frames', () => {
	const traktScripts = getContentScripts('https://app.trakt.tv/*');
	const spotifyScripts = getContentScripts('https://open.spotify.com/embed*');
	assert.ok(traktScripts.indexOf('spotify-protocol.js') < traktScripts.indexOf('trakt-soundtrack.js'));
	assert.ok(spotifyScripts.indexOf('spotify-protocol.js') < spotifyScripts.indexOf('spotify-embed.js'));
});

test('site entry points only coordinate their feature modules', () => {
	assert.ok(traktEntrySource.split(/\r?\n/).length < 80);
	assert.match(traktEntrySource, /CineTraktTraktRuntime\?\.start\(updateFeatures\)/);
	assert.match(traktEntrySource, /posterLayout\.setEnabled/);
	assert.match(traktEntrySource, /soundtrack\.update/);

	assert.ok(imdbEntrySource.split(/\r?\n/).length < 40);
	assert.match(imdbEntrySource, /traktButton\.update\(\)/);
	assert.match(imdbEntrySource, /ratings\.update\(\)/);
	assert.match(imdbEntrySource, /CineTraktImdbRuntime\?\.start\(updateFeatures\)/);
});

test('feature modules expose explicit APIs', () => {
	assert.match(traktStremioSource, /CineTraktTraktStremioUi = api/);
	assert.match(traktRatingsSource, /CineTraktTraktRatings = api/);
	assert.match(traktPosterSource, /CineTraktTraktPosterLayout = api/);
	assert.match(traktSoundtrackSource, /CineTraktTraktSoundtrack = api/);
	assert.match(traktCustomizationsSource, /CineTraktTraktCustomizations = api/);
	assert.match(imdbButtonSource, /CineTraktImdbTraktButton = Object\.freeze/);
	assert.match(imdbRatingsSource, /CineTraktImdbRatings = Object\.freeze/);
});

test('IMDb features use the shared runtime instead of duplicate startup timers', () => {
	const source = `${imdbEntrySource}\n${imdbButtonSource}\n${imdbRatingsSource}`;
	assert.doesNotMatch(source, /setTimeout\(runImdbButtons/);
	assert.doesNotMatch(source, /addEventListener\(['"]DOMContentLoaded['"], runImdbButtons/);
	assert.equal((source.match(/CineTraktImdbRuntime\?\.start/g) || []).length, 1);
});

test('Trakt does not maintain a duplicate rating palette', () => {
	assert.doesNotMatch(traktFeatureSource, /WATCH_ON_STREMIO_RATING_COLORS/);
	assert.doesNotMatch(traktFeatureSource, /getWatchOnStremioRatingBucket/);
});

test('Trakt and Stremio avoid permanent polling loops', () => {
	assert.doesNotMatch(traktFeatureSource, /\bsetInterval\s*\(/);
	assert.doesNotMatch(stremioSource, /\bsetInterval\s*\(/);
	assert.doesNotMatch(traktFeatureSource, /scheduleRunStremioButtons/);
});

test('poster integration preserves native Trakt href values', () => {
	assert.doesNotMatch(traktStremioSource, /poster(?:Link|Target)\.href\s*=\s*stremioUrl/);
	assert.doesNotMatch(traktStremioSource, /querySelectorAll\(["']a\[href\]["']\)/);
});

test('Trakt delegates Stremio URL construction and opening to shared helpers', () => {
	assert.doesNotMatch(traktStremioSource, /`stremio:\/\/\/detail\//);
	assert.match(traktStremioSource, /buildStremioDetailUrl\(type, imdbId\)/);
	assert.doesNotMatch(traktStremioSource, /function openStremioWebUrl/);
	assert.doesNotMatch(traktStremioSource, /chrome\.runtime\.sendMessage/);
	assert.match(traktStremioSource, /openFromMouseEvent: openStremioFromMouseEvent/);
});

test('Stremio resets stream scroll only when the route changes', () => {
	assert.match(stremioSource, /const shouldResetScroll = routeChanged/);
	assert.equal((stremioSource.match(/scrollTop\s*=\s*0/g) || []).length, 1);
	assert.match(stremioSource, /const DISCOVERY_RETRY_DELAYS = Object\.freeze/);
});

test('collection cards normalize malformed SVG viewBox values before cloning', () => {
	const normalizeIndex = traktCustomizationsSource.indexOf('normalizeCinetraktSvgViewBoxes(collectionCard);');
	const cloneIndex = traktCustomizationsSource.indexOf('collectionCard.cloneNode(true)');
	assert.ok(normalizeIndex >= 0);
	assert.ok(cloneIndex > normalizeIndex);
	assert.match(traktCustomizationsSource, /svg\.removeAttribute\('viewBox'\)/);
});
