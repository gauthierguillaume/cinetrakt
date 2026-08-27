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
const traktEarlyStyles = read('trakt-early.css');
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
	assertOrdered(earlyScripts, ['settings.js', 'poster-layout-utils.js', 'trakt-bootstrap.js']);
	assert.equal(scripts.includes('settings.js'), false);
	assertOrdered(scripts, [
		'rating-utils.js',
		'extension-protocol.js',
		'stremio-url.js',
		'stremio-open.js',
		'trakt-imdb-resolver.js',
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
	assert.match(traktPosterSource, /moveCinetraktElementWithPlaceholder\(\s*posterContainer/);
	assert.match(traktPosterSource, /posterStage\.appendChild\(posterContainer\)/);
	assert.match(traktPosterSource, /rail\.appendChild\(posterStage\)/);
	assert.equal((traktPosterSource.match(/state\.rail\.appendChild\((?:attachedControls|controls)\)/g) || []).length, 2);
	assert.doesNotMatch(traktPosterSource, /state\.rail\.insertBefore\((?:attachedControls|controls), state\.posterStage\)/);
	assert.match(traktPosterSource, /posterFooterHeight:\s*controlsHeight \+ controlsGap/);
	assert.match(traktPosterSource, /const railTop = Math\.max\(8, metrics\.posterTop\)/);
	assert.match(traktPosterSource, /originalPosterRect\.top - CINETRAKT_POSTER_TOP_REDUCTION/);
	assert.match(traktPosterSource, /const CINETRAKT_POSTER_BOTTOM_SAFETY = 12/);
	assert.match(traktPosterSource, /const contentLeft = summaryLeft \+ width \+ posterSideGap/);
	assert.match(traktPosterSource, /const CINETRAKT_POSTER_SIDE_GAP = 16/);
	assert.match(traktPosterSource, /\.cinetrakt-soundtrack-card:not\(\[hidden\]\)/);
	assert.match(traktPosterSource, /sidebarVisualRight \+ CINETRAKT_POSTER_SIDE_GAP/);
	assert.match(traktPosterSource, /const contentLeft = summaryLeft \+ width \+ CINETRAKT_POSTER_SIDE_GAP/);
	assert.match(traktPosterSource, /posterSideGap:\s*CINETRAKT_POSTER_SIDE_GAP/);
	assert.doesNotMatch(traktPosterSource, /summaryLeft \+ width \+ 32/);
	assert.match(traktPosterSource, /\.trakt-summary-actions-slider\s*\{[\s\S]*?bottom:\s*100%\s*!important/);
	assert.match(traktPosterSource, /clip-path:\s*inset\(-100vmax -100vmax 0 -100vmax\)\s*!important/);
	assert.doesNotMatch(traktPosterSource, /cinetrakt-sticky-poster-image/);
	assert.doesNotMatch(traktPosterSource, /getCinetraktPosterImageSource/);
	assert.doesNotMatch(traktPosterSource, /syncCinetraktStablePosterImage/);
	assert.doesNotMatch(traktPosterSource, /object-fit:\s*contain\s*!important/);
	assert.doesNotMatch(traktPosterSource, /filter:\s*brightness/);
	assert.match(traktPosterSource, /\.trakt-summary-poster\.has-active-overlay:hover img\s*\{[\s\S]*?filter:\s*none\s*!important/);
	assert.doesNotMatch(traktPosterSource, /rotate[XY]\(/);
	assert.doesNotMatch(traktPosterSource, /scale3d\(/);
	assert.doesNotMatch(traktPosterSource, /addEventListener\('pointermove'/);
	assert.match(traktPosterSource, /cursor:\s*pointer\s*!important/);
	assert.match(traktPosterSource, /--cinetrakt-poster-decoration-overflow/);
	assert.match(traktPosterSource, /Math\.ceil\(state\.posterDecorationOverflow\)/);
	assert.match(traktPosterSource, /--cinetrakt-poster-border-radius/);
	assert.match(traktPosterSource, /getComputedStyle\(element\)\.borderRadius/);
	assert.match(traktPosterSource, /#\$\{CINETRAKT_STICKY_POSTER_RAIL_ID\}[\s\S]*?position:\s*fixed\s*!important/);
	assert.match(traktPosterSource, /cinetrakt-poster-layout-compact/);
	assert.match(traktPosterSource, /setCinetraktPosterLayoutMode\(state, useStickyLayout\)/);
	assert.match(traktPosterSource, /clearCinetraktStickyPosterDimensions\(state\)/);
	assert.doesNotMatch(traktPosterSource, /canBootstrapStickyLayout/);
	assert.doesNotMatch(traktPosterSource, /watch-on-stremio-summary-poster-sized[\s\S]{0,300}position:\s*fixed\s*!important/);
	assert.match(traktPosterSource, /posterContainer\.classList\.add\('watch-on-stremio-summary-poster-sized'\)/);
	assert.match(traktPosterSource, /querySelector\(':scope > \.trakt-summary-poster-container'\)/);
	assert.match(traktPosterSource, /posterContainer\.parentElement !== summaryContainer/);
	assert.match(traktPosterSource, /--summary-poster-width', `\$\{width\}px`, 'important'/);
	assert.doesNotMatch(traktPosterSource, /summaryRect\.top\s*\+\s*38/);
	assert.doesNotMatch(traktPosterSource, /watch-on-stremio-native-poster/);
	assert.doesNotMatch(traktPosterSource, /transform:\s*scale\(/);
	assert.doesNotMatch(traktPosterSource, /watch-on-stremio-summary-poster-sized img/);
	assert.doesNotMatch(traktPosterSource, /content-visibility:\s*visible\s*!important/);
	assert.doesNotMatch(traktPosterSource, /opacity:\s*1\s*!important/);
	assert.doesNotMatch(traktPosterSource, /createCinetraktStickyPosterDisplay/);
	assert.doesNotMatch(traktEarlyStyles, /\.trakt-summary-poster img/);
	assert.doesNotMatch(traktEarlyStyles, /\.trakt-summary-poster > a/);
	assert.match(traktStremioSource, /querySelector\('\.cinetrakt-sticky-poster-stage'\)/);
	assert.match(traktStremioSource, /refreshDetailPosterTarget/);
	assert.match(traktStremioSource, /event\.cinetraktStremioHandled/);
});

test('poster layout does not turn the page into a nested vertical scroll container', () => {
	const pageOverflowRule = traktPosterSource.match(
		/html\.cinetrakt-poster-layout-enabled,\s*html\.cinetrakt-poster-layout-enabled body\s*\{([\s\S]*?)\}/,
	)?.[1] || '';
	assert.match(pageOverflowRule, /overflow-x:\s*clip\s*!important/);
	assert.doesNotMatch(pageOverflowRule, /overflow-x:\s*hidden\s*!important/);
});

test('detail poster uses a clean Stremio interaction without the native promo overlay', () => {
	assert.match(traktPosterSource, /\.trakt-summary-poster-overlay\s*\{[\s\S]*?display:\s*none\s*!important/);
	assert.match(traktPosterSource, /\.trakt-summary-poster\s*>\s*a\s*\{[\s\S]*?pointer-events:\s*none\s*!important/);
	assert.match(traktPosterSource, /data-cinetrakt-stremio-target="true"/);
	assert.match(traktStremioSource, /target\.dataset\.cinetraktStremioTarget\s*=\s*'true'/);
	assert.match(traktStremioSource, /event\.key\s*!==\s*'Enter'\s*&&\s*event\.key\s*!==\s*' '/);
	assert.match(traktStremioSource, /shouldPreserveNativePosterInteraction\(element, event\)/);
	assert.match(traktStremioSource, /a\[href\], button, input, select, textarea/);
	assert.match(traktStremioSource, /nativeInteractive\s*!==\s*element/);
	assert.match(traktStremioSource, /isCinetraktNativePosterStatusTarget\(element, target\)/);
	assert.match(traktStremioSource, /wishlisted/);
	assert.match(traktStremioSource, /isCinetraktPointerOutsidePosterImage\(element, event\)/);
	assert.match(traktStremioSource, /event\.clientY > rect\.bottom/);
	assert.match(traktStremioSource, /cinetraktStremioActive !== 'true'/);
	assert.match(traktStremioSource, /if \(stickyPosterStage\) return \[stickyPosterStage\]/);
	assert.match(traktStremioSource, /target\.dataset\.cinetraktStremioActive = 'false'/);
	assert.match(traktStremioSource, /target\.dataset\.cinetraktStremioActive = 'true'/);
	assert.doesNotMatch(traktPosterSource, /opacity:\s*1\s*!important/);
	assert.doesNotMatch(traktStremioSource, /cinetrakt-sticky-poster-image/);
});

test('summary ratings keep only IMDb and place one episode heatmap after the complete native IMDb trigger', () => {
	assert.match(traktRatingsSource, /querySelectorAll\('rating\[data-variant="row"\]'\)/);
	assert.match(traktRatingsSource, /getAttribute\('viewBox'\)/);
	assert.match(traktRatingsSource, /#f6c700/);
	assert.match(traktRatingsSource, /width \/ height > 1\.8/);
	assert.match(traktRatingsSource, /item\.classList\.add\('wos-trakt-rating-hidden'\)/);
	assert.match(traktRatingsSource, /querySelectorAll\('\.wos-imdb-ratings-popup-button'\)/);
	assert.match(traktRatingsSource, /buttons\.forEach\(\(button\) => button\.remove\(\)\)/);
	assert.match(traktRatingsSource, /summaryRatings\.closest\(/);
	assert.match(traktRatingsSource, /document\.createElement\('span'\)/);
	assert.match(traktRatingsSource, /row\.dataset\.cinetraktRatingsPopupRow = 'true'/);
	assert.match(traktRatingsSource, /placementAnchor\.parentNode\.insertBefore\(row, placementAnchor\)/);
	assert.match(traktRatingsSource, /row\.appendChild\(placementAnchor\)/);
	assert.match(traktRatingsSource, /placementAnchor\.nextElementSibling !== popupButton/);
	assert.match(traktRatingsSource, /placementAnchor\.insertAdjacentElement\('afterend', popupButton\)/);
	assert.match(traktRatingsSource, /popupButton\.dataset\.imdbId = imdbId/);
	assert.doesNotMatch(traktRatingsSource, /setWatchOnStremioRatingsPopupRow\(placementAnchor\.parentElement\)/);
	assert.doesNotMatch(traktRatingsSource, /function createWatchOnStremioTraktRatingsToggle/);
});

test('episode title and number share one explicit footer target', () => {
	assert.match(traktStremioSource, /element\.closest\('\.trakt-card-footer-information'\)/);
	assert.match(traktStremioSource, /footerInformation\.querySelector\(':scope > \.trakt-card-title'\)/);
	assert.match(traktStremioSource, /footerInformation\.querySelector\(':scope > \.trakt-card-subtitle'\)/);
	assert.match(traktStremioSource, /findEpisodeLinkData\(current\)/);
	assert.match(traktStremioSource, /getEpisodeDataFromTraktUrl\(link\.href/);
	assert.doesNotMatch(traktStremioSource, /classList\.add\([^\n]*(?:trakt-card-content|trakt-card-image)/);
	assert.doesNotMatch(traktStremioSource, /cinetrakt-imdb-resolver-frame/);
	assert.match(traktStremioSource, /getTraktShowIdFromCard\(card\)/);
	assert.match(traktStremioSource, /getTraktMediaIdFromImageUrl/);
	assert.match(traktStremioSource, /closest\('\.trakt-card-footer-information'\)[\s\S]*?closest\('\.trakt-card'\)/);
	assert.match(traktStremioSource, /markSeasonEpisodeTargetsPreparing\(targets, episodeData\)/);
	assert.match(traktStremioSource, /getBestShowLinkFromEpisodeElement\(element, context\)/);
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
	assert.match(traktCustomizationsSource, /getCinetraktCollectionPosterImages/);
	assert.match(traktCustomizationsSource, /\.slice\(0, 8\)/);
	assert.match(traktCustomizationsSource, /--cinetrakt-collection-useful-width/);
	assert.match(traktCustomizationsSource, /requestAnimationFrame/);
});
