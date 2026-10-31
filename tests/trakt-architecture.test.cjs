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

function externalRatingsRetryFixture() {
	const vm = require('node:vm'); const requests = []; const reasons = []; const timers = new Map(); let now = 1000; let nextId = 0;
	const location = { pathname: '/movies/first', hostname: 'app.trakt.tv' };
	const context = vm.createContext({ window: { location }, document: { querySelector: () => null }, Date: { now: () => now },
		CineTraktSettings: { isEnabled: () => true }, CineTraktRatingUtils: {}, CineTraktTraktStremioUi: {},
		CineTraktExtensionProtocol: { MESSAGE_TYPES: require('../extension-protocol.js').MESSAGE_TYPES },
		CineTraktStremioOpen: { sendRuntimeMessage(message, reply) { requests.push({ message, reply }); return true; } },
		CineTraktTraktRuntime: { schedule: reason => reasons.push(reason) },
		setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, delay }); return id; },
		clearTimeout(id) { timers.delete(id); },
	});
	vm.runInContext(traktRatingsSource.replace('globalThis.CineTraktTraktRatings = api;',
		'globalThis.getRatings = getCinetraktExternalRatings; globalThis.testApi = api;'), context);
	return { get: context.getRatings, api: context.testApi, requests, reasons, location, timers,
		runRetry() { const [id, timer] = [...timers][0]; timers.delete(id); now += timer.delay; timer.callback(); },
	};
}

test('ratings prefetch begins before the native summary exists and requests are shared across updates', () => {
	const f = externalRatingsRetryFixture(); f.location.pathname = '/shows/reacher';
	f.api.setControlsEnabled({ toggleEnabled: true, popupEnabled: true });
	assert.equal(f.requests.length, 2, 'cards and seasons load independently of the native row');
	f.api.setControlsEnabled({ toggleEnabled: true, popupEnabled: true });
	assert.equal(f.requests.length, 2, 'DOM updates reuse in-flight requests');
});

test('a temporary ratings rejection retries automatically on a quiet page and then keeps its cards cached', () => {
	const f = externalRatingsRetryFixture();
	assert.equal(f.get(), null); f.get();
	assert.equal(f.requests.length, 1);
	f.requests[0].reply({ ok: false });
	assert.equal([...f.timers.values()][0].delay, 1500);
	f.get(); assert.equal(f.requests.length, 1, 'native page mutations do not bypass the retry delay');
	f.runRetry();
	assert.ok(f.reasons.includes('external-ratings-retry'), 'no user scroll or reload is needed to schedule the next update');
	f.get(); assert.equal(f.requests.length, 2);
	const ratings = { imdb: { rating: 7.1 } };
	f.requests[1].reply({ ok: true, ratings });
	assert.equal(f.get(), ratings);
	assert.equal(f.timers.size, 0);
	f.get(); assert.equal(f.requests.length, 2);
});

test('ratings retries are bounded, skip a different fiche, and do not retry genuinely absent ratings', () => {
	const f = externalRatingsRetryFixture();
	for (let attempt = 0; attempt < 3; attempt++) {
		f.get(); f.requests.at(-1).reply({ ok: false, retryable: true });
		if (attempt < 2) f.runRetry();
	}
	assert.equal(f.requests.length, 3);
	assert.equal(f.timers.size, 0, 'retries never become permanent polling');
	const leaving = externalRatingsRetryFixture();
	leaving.get(); leaving.requests[0].reply({ ok: false });
	leaving.location.pathname = '/shows/second';
	const count = leaving.reasons.length;
	leaving.runRetry();
	assert.equal(leaving.reasons.length, count, 'an old fiche cannot trigger a retry on the new one');
	leaving.location.pathname = '/movies/first'; leaving.get();
	assert.equal(leaving.requests.length, 2, 'returning to the fiche does not retain the transient rejection');
	leaving.requests[1].reply({ ok: true, ratings: null });
	assert.equal(leaving.timers.size, 0, 'a successful response without ratings is not a network failure');
});

test('season data loads independently from score cards and is never requested for movies', () => {
	const f = externalRatingsRetryFixture();
	f.location.pathname = '/shows/supernatural';
	f.get(); f.get(true); f.get(true);
	assert.equal(f.requests.length, 2);
	assert.equal(f.requests[0].message.type, 'CINETRAKT_GET_TRAKT_RATINGS');
	assert.equal(f.requests[1].message.type, 'CINETRAKT_GET_SHOW_SEASON_RATINGS');
	const scores = { imdb: { rating: 8.4 } }, seasons = [{ season: 1, percent: 80 }];
	f.requests[0].reply({ ok: true, ratings: scores });
	f.requests[1].reply({ ok: true, seasons });
	assert.equal(f.get(), scores);
	assert.equal(f.get(true), seasons);
	f.location.pathname = '/movies/dune-2021';
	assert.equal(f.get(true), null);
	assert.equal(f.requests.length, 2);
});

test('rating cards retain native URLs and votes, double only Letterboxd, and restore settings safely', () => {
	const vm = require('node:vm'); const requests = []; const schedules = []; const groups = [];
	const enabled = { traktRatingsToggle: true, traktRatingColors: true };
	const location = { pathname: '/movies/first' };
	const makeNode = () => {
		const attributes = new Map(); const styles = new Map(); const slots = new Map();
		return { dataset: {}, children: [], textContent: '', hidden: false,
			style: { getPropertyValue: key => styles.get(key) || '', getPropertyPriority: () => 'important',
				setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
			querySelector(selector) {
				if (selector.startsWith('[data-source=')) return this.children.find(n => n.dataset.source === selector.match(/"([^"]+)"/)[1] && !n.removed) || null;
				if (!slots.has(selector)) slots.set(selector, makeNode());
				return slots.get(selector);
			},
			getAttribute: key => attributes.get(key), setAttribute: (key, value) => attributes.set(key, value),
			appendChild(node) { this.children.push(node); node.parent = this; },
			insertBefore(node, reference) {
				this.children = this.children.filter(child => child !== node);
				const index = reference ? this.children.indexOf(reference) : this.children.length;
				this.children.splice(index, 0, node); node.parent = this;
			},
			remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); },
		};
	};
	const context = vm.createContext({ window: { location },
		CineTraktSettings: { isEnabled: key => enabled[key] !== false },
		CineTraktExtensionProtocol: { MESSAGE_TYPES: require('../extension-protocol.js').MESSAGE_TYPES },
		CineTraktStremioOpen: { sendRuntimeMessage(message, reply) { requests.push({ message, reply }); return true; } },
		CineTraktTraktStremioUi: {}, CineTraktRatingUtils: require('../rating-utils.js'),
		CineTraktTraktRuntime: { schedule: (...args) => schedules.push(args) },
		chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` } },
		document: { querySelectorAll: () => groups.filter(group => !group.removed), createElement: makeNode },
	});
	vm.runInContext(traktRatingsSource.replace('globalThis.CineTraktTraktRatings = api;',
		'globalThis.updateLink = updateCinetraktRatingCards;'), context);
	assert.equal(context.updateLink(), null);
	assert.equal(context.updateLink(), null);
	assert.equal(requests.length, 1, 'page mutations must not duplicate a pending request');
	location.pathname = '/movies/second';
	const firstData = {
		imdb: { rating: 7.1, url: 'https://www.imdb.com/title/tt20969586/', votes: 275800 },
		letterboxd: { rating: 3.56, url: 'https://letterboxd.com/film/first-film', votes: 1800000 },
	};
	requests[0].reply({ ok: true, ratings: firstData });
	assert.equal(schedules.length, 0, 'a late response cannot update a different film');
	location.pathname = '/movies/first';
	const firstGroup = context.updateLink(); groups.push(firstGroup);
	const first = firstGroup.querySelector('[data-source="letterboxd"]');
	const imdb = firstGroup.querySelector('[data-source="imdb"]');
	assert.equal(first.querySelector('.cinetrakt-rating-score').textContent, '7.2');
	assert.equal(imdb.querySelector('.cinetrakt-rating-score').textContent, '7.1');
	assert.equal(first.querySelector('.cinetrakt-rating-score').style.getPropertyValue('color'), '#3b82f6');
	assert.equal(first.querySelector('.cinetrakt-rating-votes').querySelector('span').textContent, '1.8M');
	assert.equal(imdb.querySelector('.cinetrakt-rating-votes').querySelector('span').textContent, '275.8K');
	assert.equal(imdb.querySelector('.cinetrakt-rating-votes').title, '275,800 votes');
	assert.equal(first.href, 'https://letterboxd.com/film/first-film');
	assert.equal(first.target, '_blank');
	assert.equal(first.rel, 'noopener noreferrer');
	assert.equal(context.updateLink(), firstGroup);
	assert.equal(firstGroup.children.length, 2, 'repeated updates do not duplicate either card');
	assert.equal(requests.length, 1);
	firstData.mal = { rating: 9.32, votes: 934800, url: 'https://myanimelist.net/anime/52991' };
	context.updateLink();
	const mal = firstGroup.querySelector('[data-source="mal"]');
	assert.equal(mal.querySelector('.cinetrakt-rating-score').textContent, '9.3', 'MyAnimeList is already /10 and must not be doubled');
	assert.equal(mal.querySelector('.cinetrakt-rating-score').style.getPropertyValue('color'), '#8b5cf6');
	assert.equal(mal.querySelector('.cinetrakt-rating-votes').querySelector('span').textContent, '934.8K');
	assert.equal(mal.querySelector('.cinetrakt-rating-logo').src, 'chrome-extension://test/assets/ratings/mal.svg');
	assert.equal(mal.href, 'https://myanimelist.net/anime/52991');
	assert.equal(mal.target, '_blank');
	assert.equal(mal.rel, 'noopener noreferrer');
	assert.deepEqual(firstGroup.children.map(card => card.dataset.source), ['imdb', 'mal', 'letterboxd'], 'MAL goes directly after IMDb even if added after Letterboxd');
	context.updateLink();
	assert.equal(firstGroup.children.length, 3, 'repeated updates do not duplicate MAL');
	enabled.traktRatingColors = false; context.updateLink();
	assert.equal(first.querySelector('.cinetrakt-rating-score').style.getPropertyValue('color'), '');
	assert.equal(mal.querySelector('.cinetrakt-rating-score').style.getPropertyValue('color'), '');
	firstData.letterboxd.votes = null; context.updateLink();
	assert.equal(first.querySelector('.cinetrakt-rating-votes').hidden, true, 'an unknown vote count is never shown as zero');
	enabled.traktRatingColors = true;
	location.pathname = '/movies/second';
	assert.equal(context.updateLink(), null);
	assert.equal(firstGroup.removed, true, 'the previous film cards are removed while loading');
	requests[1].reply({ ok: true, ratings: { letterboxd: { rating: 2.5, url: 'https://letterboxd.com/film/second-film', votes: 0 } } });
	const secondGroup = context.updateLink(); groups.push(secondGroup);
	const second = secondGroup.querySelector('[data-source="letterboxd"]');
	assert.equal(second.querySelector('.cinetrakt-rating-score').textContent, '5');
	assert.equal(second.querySelector('.cinetrakt-rating-score').style.getPropertyValue('color'), '#eab308');
	assert.equal(second.querySelector('.cinetrakt-rating-votes').querySelector('span').textContent, '0');
	assert.equal(secondGroup.children.length, 1);
	assert.equal(secondGroup.querySelector('[data-source="mal"]'), null, 'a film without MAL must not keep the previous anime card');
	assert.equal(schedules.length, 1);
	enabled.traktRatingsToggle = false;
	assert.equal(context.updateLink(), null);
	assert.equal(secondGroup.removed, true);
	enabled.traktRatingsToggle = true; location.pathname = '/shows/test';
	assert.equal(context.updateLink(), null);
	assert.equal(requests.length, 3);
	requests[2].reply({ ok: true, ratings: { imdb: firstData.imdb, letterboxd: null } });
	const showGroup = context.updateLink();
	assert.equal(showGroup.children.length, 1, 'series without Letterboxd keep only the available IMDb card');
});

test('Continue Watching reuses section positions across cards and only measures matching headings', () => {
	const vm = require('node:vm'); let queries = 0; let measurements = 0; const prepared = [];
	const heading = (text, top) => ({ textContent: text, getBoundingClientRect() {
		measurements++; return { top, width: 200, height: 30 };
	} });
	const headings = [heading('Continue Watching', 100), heading('Recommended', 400),
		{ textContent: 'Unrelated page content', getBoundingClientRect() { throw new Error('unnecessary layout measurement'); } }];
	const cards = [200, 300, 500].map((top) => ({ getBoundingClientRect: () => ({ top }) }));
	const context = vm.createContext({
		window: { location: { hostname: 'app.trakt.tv' } },
		document: { querySelectorAll() { queries++; return headings; } },
		getCleanText: (text) => text.trim(), isContinueWatchingPage: () => false,
		getContinueWatchingVerticalRange: () => ({}),
		getSeasonEpisodeTextTargets: () => cards.map((element) => ({ element, text: 'S1 • E2' })),
		getSeasonEpisodeFromText: () => ({ season: 1, episode: 2 }),
		findContinueWatchingCardFromElement: (element) => element,
		getSeasonEpisodeClickableTargets: (element) => [element], markSeasonEpisodeTargetsPreparing() {},
		findEpisodeLookupContext: (element, card) => card, getBestShowLinkFromEpisodeElement: () => '/shows/test',
		prepareSeasonEpisodeTextLinkFromShowUrl: (targets) => prepared.push(targets[0]),
	});
	vm.runInContext(traktStremioSource.slice(traktStremioSource.indexOf('function getVisibleSectionHeadingCandidates()'),
		traktStremioSource.indexOf('function prepareSeasonEpisodeTextLinkFromShowUrl('))
		+ traktStremioSource.slice(traktStremioSource.indexOf('function linkifyContinueWatchingSeasonEpisodeTexts()'),
			traktStremioSource.indexOf('function insertContinueWatchingStremioButtonsTraktV3()')), context);
	context.linkifyContinueWatchingSeasonEpisodeTexts();
	assert.equal(queries, 1);
	assert.equal(measurements, 2);
	assert.deepEqual(prepared, cards.slice(0, 2));
});

test('user ratings retain native values through repeated conversion, updates and reset', () => {
	const vm = require('node:vm');
	const all = [];
	function node(text = '') {
		const classes = new Set();
		const styles = new Map();
		const value = {
			textContent: text, dataset: {}, children: [],
			classList: { contains: name => classes.has(name), add: name => classes.add(name),
				remove: name => classes.delete(name), toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } },
			style: { getPropertyValue: name => styles.get(name) || '', getPropertyPriority: () => 'important',
				setProperty: (name, color) => styles.set(name, color), removeProperty: name => styles.delete(name) },
			setAttribute() {},
			set className(names) { names.split(' ').forEach(name => classes.add(name)); },
			after(label) { label.parent = this.parent; this.parent.children.push(label); },
			remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
			querySelector() { return this.children.find(child => child.classList.contains('cinetrakt-rating-value')) || null; },
			querySelectorAll() { return this.children; },
		};
		all.push(value);
		return value;
	}
	const badges = ['3', '4.5', '3,5', '4.25', '100%'].map(text => {
		const badge = node();
		const native = node(text); native.parent = badge; badge.children = [native];
		return badge;
	});
	const document = {
		getElementById: () => true,
		createElement: () => node(),
		querySelectorAll(selector) {
			if (selector.startsWith('.trakt-user-rating')) return badges;
			if (selector.startsWith('[data-') || selector === '.wos-personal-star-colored') return [];
			return all.filter(value => selector.split(', ').some(name => value.classList.contains(name.slice(1))));
		},
	};
	const context = vm.createContext({ document,
		CineTraktExtensionProtocol: { MESSAGE_TYPES: {} }, CineTraktStremioOpen: {}, CineTraktTraktStremioUi: {},
		CineTraktRatingUtils: require('../rating-utils.js'),
	});
	vm.runInContext(traktRatingsSource.replace('globalThis.CineTraktTraktRatings = api;',
		'globalThis.testRatings = { colorizeTraktUserRatings, resetTraktRatingColors };'), context);
	const { colorizeTraktUserRatings: update, resetTraktRatingColors: reset } = context.testRatings;
	update(); update();
	assert.deepEqual(badges.map(badge => badge.children[0].textContent), ['3', '4.5', '3,5', '4.25', '100%']);
	assert.deepEqual(badges.map(badge => badge.querySelector()?.textContent), ['6', '9', '7', '8.5', undefined]);
	assert.equal(badges[0].style.getPropertyValue('--cinetrakt-rating-color'), '#22c55e');
	assert.equal(badges[1].style.getPropertyValue('--cinetrakt-rating-color'), '#8b5cf6');
	badges[0].children[0].textContent = '4'; update();
	assert.equal(badges[0].querySelector().textContent, '8');
	reset();
	assert.ok(badges.every(badge => badge.children.length === 1));
	assert.ok(badges.every(badge => !badge.children[0].classList.contains('cinetrakt-rating-native-value')));
});

test('IMDb rating handles middle click once and leaves right click and disabled controls alone', () => {
	const vm = require('node:vm');
	const links = [];
	const listeners = {};
	let enabled = true;
	const item = {
		classList: { add() {} }, dataset: {}, setAttribute() {},
		addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
	};
	const context = vm.createContext({
		isCinetraktFeatureEnabled: () => enabled,
		document: {
			body: { appendChild() {} },
			createElement: () => ({ click() { links.push(this.href); }, remove() {} }),
		},
	});
	vm.runInContext(traktRatingsSource.slice(
		traktRatingsSource.indexOf('function openWatchOnStremioImdbTitle('),
		traktRatingsSource.indexOf('function resetWatchOnStremioImdbDirectLinks('),
	), context);
	context.bindWatchOnStremioImdbDirectLink(item, 'tt0460681');
	context.bindWatchOnStremioImdbDirectLink(item, 'tt0460681');
	const dispatch = (type, button) => {
		const calls = [];
		for (const handler of listeners[type]) handler({ type, button,
			preventDefault() { calls.push('preventDefault'); },
			stopPropagation() { calls.push('stopPropagation'); },
			stopImmediatePropagation() { calls.push('stopImmediatePropagation'); },
		});
		return calls;
	};
	assert.deepEqual(dispatch('auxclick', 1), ['preventDefault', 'stopPropagation', 'stopImmediatePropagation']);
	assert.deepEqual(links, ['https://www.imdb.com/title/tt0460681/']);
	assert.deepEqual(dispatch('auxclick', 2), []);
	assert.equal(links.length, 1);
	dispatch('click', 0);
	assert.equal(links.length, 2);
	enabled = false;
	assert.deepEqual(dispatch('auxclick', 1), []);
	assert.equal(links.length, 2);
});
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
	const scripts = getContentScripts('https://app.trakt.tv/*', 'document_end');
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
	const traktScripts = getContentScripts('https://app.trakt.tv/*', 'document_end');
	const spotifyScripts = getContentScripts('https://open.spotify.com/embed*');
	assert.ok(traktScripts.indexOf('spotify-protocol.js') < traktScripts.indexOf('trakt-soundtrack.js'));
	assert.ok(traktScripts.indexOf('trakt-soundtrack-library.js') >= 0);
	assert.ok(traktScripts.indexOf('trakt-soundtrack-library.js') < traktScripts.indexOf('trakt-soundtrack.js'));
	assert.ok(spotifyScripts.indexOf('spotify-protocol.js') < spotifyScripts.indexOf('spotify-embed.js'));
	assert.ok(spotifyScripts.indexOf('spotify-playback.js') >= 0);
	assert.ok(spotifyScripts.indexOf('spotify-playback.js') < spotifyScripts.indexOf('spotify-embed.js'));
	assert.match(traktSoundtrackSource, /if \(!cinetraktReadySpotifyEmbeds\.has\(iframe\)\) return false/);
	assert.match(traktSoundtrackSource, /Date\.now\(\) < cinetraktSoundtrackState\.discoveryDeadline/);
});

test('site entry points only coordinate their feature modules', () => {
	assert.ok(traktEntrySource.split(/\r?\n/).length < 80);
	assert.match(traktEntrySource, /CineTraktTraktRuntime\?\.start\(updateFeatures\)/);
	assert.match(traktEntrySource, /posterLayout\.setEnabled/);
	assert.match(traktEntrySource, /soundtrack\.update/);
	assert.ok(
		traktEntrySource.indexOf('stremioUi.update()') < traktEntrySource.indexOf('posterLayout.setEnabled'),
		'Stremio links must initialize before visual layout features',
	);

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
	assert.match(traktPosterSource, /const resolvedPosterTop = sideInset/);
	assert.match(traktPosterSource, /const contentLeft = summaryLeft \+ width \+ posterSideGap/);
	assert.match(traktPosterSource, /getRightContentWidth\(getCinetraktViewportWidth\(\), contentLeft, state\.sideInset\)/);
	assert.match(traktPosterSource, /document\.documentElement\.style\.setProperty\('--list-inner-width'/);
	assert.match(traktPosterSource, /document\.documentElement\.style\.removeProperty\('--list-inner-width'\)/);
	assert.doesNotMatch(traktPosterSource, /padding-inline-end:\s*4px|padding-right:\s*12px|CINETRAKT_POSTER_SIDE_GAP|CINETRAKT_POSTER_TOP_REDUCTION/);
	assert.match(traktPosterSource, /padding-right:\s*calc\(var\(--layout-distance-side\) \+ var\(--list-gap\)\)/);
	assert.doesNotMatch(traktPosterSource, /soundtrackCardRect|sidebarVisualRight/);
	assert.match(traktPosterSource, /sidebarRight \+ sideInset/);
	assert.match(traktPosterSource, /\.trakt-summary-actions-slider\s*\{[\s\S]*?bottom:\s*100%\s*!important/);
	assert.match(traktPosterSource, /clip-path:\s*inset\(-100vmax -100vmax 0 -100vmax\)\s*!important/);
	assert.doesNotMatch(traktPosterSource, /cinetrakt-sticky-poster-image/);
	assert.doesNotMatch(traktPosterSource, /getCinetraktPosterImageSource/);
	assert.doesNotMatch(traktPosterSource, /syncCinetraktStablePosterImage/);
	assert.doesNotMatch(traktPosterSource, /object-fit:\s*contain\s*!important/);
	assert.doesNotMatch(traktPosterSource, /filter:\s*brightness/);
	assert.match(traktPosterSource, /\.trakt-summary-poster\.has-active-overlay img,[\s\S]*?\.trakt-summary-poster\.has-active-overlay:hover img\s*\{[\s\S]*?filter:\s*none\s*!important[\s\S]*?transition:\s*none\s*!important/);
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

test('Trivia adapts beside or below Insights, retains native sizes, and restores its original position', () => {
	const vm = require('node:vm');
	function element(textContent = '', isSection = false) {
		const classes = new Set();
		return {
			textContent, isSection, parentNode: null, children: [], width: 480,
			get parentElement() { return this.parentNode; },
			get isConnected() { return Boolean(this.root || this.parentNode?.isConnected); },
			get nextElementSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1]; },
			classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
			contains(child) { return child === this || this.children.some((node) => node.contains(child)); },
			closest() { return this.isSection ? this : this.parentNode?.closest(); },
			querySelectorAll() { return this.children.flatMap((child) => [child, ...child.querySelectorAll()]); },
			appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; },
			append(...children) { children.forEach((child) => this.appendChild(child)); },
			getBoundingClientRect() { return { width: this.width }; },
			insertBefore(child, anchor) { child.remove(); child.parentNode = this; this.children.splice(this.children.indexOf(anchor), 0, child); },
			insertAdjacentElement(position, child) {
				assert.equal(position, 'afterend');
				const parent = this.parentNode; child.remove(); child.parentNode = parent;
				parent.children.splice(parent.children.indexOf(this) + 1, 0, child);
			},
			remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; },
		};
	}
	for (const label of ['Insights', 'Sentiment']) for (const wide of [false, true]) {
		const main = element(); main.root = true;
		const summary = main.appendChild(element());
		summary.width = wide ? 1600 : 1000;
		const contextual = summary.appendChild(element()); summary.querySelector = () => contextual;
		const insights = contextual.appendChild(element('', true)); insights.appendChild(element(label));
		insights.width = 320;
		const trivia = main.appendChild(element('', true)); trivia.appendChild(element('Trivia'));
		const state = { mainContent: main, summaryContainer: summary, sectionElements: new Set([trivia]) };
		const context = vm.createContext({ document: { createComment: () => element(), createElement: () => element() },
			getComputedStyle: () => ({ columnGap: '24px' }) });
		vm.runInContext(traktPosterSource.match(/const CINETRAKT_CONTEXTUAL_PAIR_GAP = \d+;/)[0]
			+ traktPosterSource.slice(traktPosterSource.indexOf('function moveCinetraktElementWithPlaceholder('),
			traktPosterSource.indexOf('function attachCinetraktStickyPosterControls('))
			+ traktPosterSource.slice(traktPosterSource.indexOf('function findCinetraktSectionByTitle('),
				traktPosterSource.indexOf('function hasCinetraktVisibleBorderRadius(')), context);
		context.attachCinetraktTriviaBesideSentiment(state);
		assert.equal(insights.nextElementSibling, trivia, label);
		assert.equal(trivia.parentNode, wide ? state.sentimentTriviaRow : contextual);
		assert.equal(state.sectionElements.has(trivia), false);
		context.attachCinetraktTriviaBesideSentiment(state);
		assert.equal(contextual.children.length, wide ? 1 : 2, 'repeated updates never duplicate Trivia');
		summary.width = 1000;
		context.attachCinetraktTriviaBesideSentiment(state);
		assert.equal(trivia.parentNode, contextual, 'a narrower window stacks the cards');
		assert.equal(insights.nextElementSibling, trivia);
		summary.width = 1600;
		context.attachCinetraktTriviaBesideSentiment(state);
		assert.equal(trivia.parentNode, state.sentimentTriviaRow, 'wide windows place the cards beside each other');
		assert.equal(insights.width, 320);
		assert.equal(trivia.width, 480);
		context.restoreCinetraktTriviaToNativeFlow(state);
		assert.equal(trivia.parentNode, main);
		assert.equal(main.children.length, 2, 'restoring removes the placeholder');
		assert.equal(state.triviaEntry, null);
	}
});

test('poster layout places native Trivia beside Insights or legacy Sentiment without compressing either card', () => {
	assert.match(traktPosterSource, /function attachCinetraktTriviaBesideSentiment\(state\)/);
	assert.match(traktPosterSource, /findCinetraktSectionByTitle\(contextualContent, \['insights', 'sentiment'\]\)/);
	assert.match(traktPosterSource, /findCinetraktSectionByTitle\(state\.mainContent, \['trivia', 'anecdotes'\]\)/);
	assert.match(traktPosterSource, /function canPlaceCinetraktTriviaBesideSentiment\(state, contextualContent, sentimentSection\)/);
	assert.match(traktPosterSource, /const minimumWidth = sentimentWidth[\s\S]*?\+ \(cardWidth \* 2\)[\s\S]*?\+ CINETRAKT_CONTEXTUAL_PAIR_GAP[\s\S]*?\+ summaryGap/);
	assert.match(traktPosterSource, /row\.append\(sentimentSection, triviaSection\)/);
	assert.match(traktPosterSource, /classList\.add\('cinetrakt-contextual-pair-ready'\)/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row\s*\{[\s\S]*?grid-template-columns:\s*var\(--ni-320\) var\(--ni-480\)\s*!important/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row > \.cinetrakt-summary-sentiment\s*\{[\s\S]*?min-width:\s*var\(--ni-320\)\s*!important/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row > \.cinetrakt-summary-trivia\s*\{[\s\S]*?min-width:\s*var\(--ni-480\)\s*!important/);
	assert.match(traktPosterSource, /cinetrakt-contextual-pair-ready[\s\S]*?calc\(var\(--ni-320\) \+ var\(--ni-480\) \+ var\(--gap-m, 16px\)\)/);
	// Une fenêtre plus étroite revient à l'empilement vertical au lieu de rogner les cartes.
	assert.match(traktPosterSource, /sentimentSection\.insertAdjacentElement\('afterend', triviaSection\)/);
	assert.match(traktPosterSource, /moveCinetraktElementWithPlaceholder\([\s\S]*?'CineTrakt original Trivia position'/);
	assert.match(traktPosterSource, /function restoreCinetraktTriviaToNativeFlow\(state\)/);
	assert.match(traktPosterSource, /function discardCinetraktTriviaFromPreviousRoute\(state\)/);
	assert.match(traktPosterSource, /triviaEntry\.element\?\.remove\(\)/);
	assert.match(traktPosterSource, /triviaEntry\.placeholder\?\.remove\(\)/);
	assert.match(traktPosterSource, /cleanupWatchOnStremioPosterSize\(\{ discardMovedTrivia: true \}\)/);
	assert.match(traktPosterSource, /function cleanupWatchOnStremioPosterSize\(\{ discardMovedTrivia = false \} = \{\}\)/);
	assert.match(traktPosterSource, /function unwrapCinetraktSentimentTriviaRow\(state\)/);
	assert.match(traktPosterSource, /if \(!useStickyLayout\) \{[\s\S]*?restoreCinetraktTriviaToNativeFlow\(state\)/);
	assert.match(traktPosterSource, /restoreCinetraktMovedElement\(state\.triviaEntry\)/);
	assert.match(traktPosterSource, /\.cinetrakt-summary-trivia\s*\{[\s\S]*?width:\s*100%\s*!important/);
	assert.match(traktPosterSource, /grid-template-columns:[\s\S]*?minmax\(0, 1fr\)[\s\S]*?var\(--ni-480\)\s*!important/);
	assert.doesNotMatch(traktPosterSource, /--width-sentiment-card:/);
	assert.doesNotMatch(traktPosterSource, /--width-trivia-card:\s*100%/);
	assert.match(traktPosterSource, /querySelector\('footer\.trakt-footer, \[role="contentinfo"\]'\)/);
	assert.doesNotMatch(traktPosterSource, /querySelector\('footer, \[role="contentinfo"\]'\)/);
});

test('moved Trivia keeps the native section rhythm and soundtrack text follows the Trakt theme', () => {
	assert.match(traktPosterSource, /\.cinetrakt-summary-trivia\s*\{[\s\S]*?margin-top:\s*var\(--gap-m, 16px\)\s*!important/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row\s*\{[\s\S]*?margin-top:\s*var\(--gap-m, 16px\)\s*!important/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row > \.cinetrakt-summary-sentiment\s*\{[\s\S]*?margin:\s*0\s*!important/);
	assert.match(traktPosterSource, /\.cinetrakt-sentiment-trivia-row > \.cinetrakt-summary-trivia\s*\{[\s\S]*?margin:\s*8px 0 0\s*!important/);
	assert.match(traktSoundtrackSource, /color:\s*var\(--color-text-primary, var\(--color-foreground,/);
	assert.match(traktSoundtrackSource, /color:\s*var\(--color-text-secondary, var\(--color-foreground,/);
});

test('detail poster uses a clean Stremio interaction without the native promo overlay', () => {
	assert.match(traktPosterSource, /\.trakt-summary-poster-overlay\s*\{[\s\S]*?display:\s*none\s*!important/);
	assert.match(traktPosterSource, /\.trakt-summary-poster\s*>\s*a\s*\{[\s\S]*?pointer-events:\s*auto\s*!important/);
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
	assert.match(traktStremioSource, /const posterImage = posterSurface\?\.querySelector\('img'\)/);
	assert.match(traktStremioSource, /if \(posterImage\) return \[posterImage\]/);
	assert.match(traktStremioSource, /\|\| stickyPosterStage/);
	assert.match(traktStremioSource, /target\.dataset\.cinetraktStremioActive = 'false'/);
	assert.match(traktStremioSource, /target\.dataset\.cinetraktStremioActive = 'true'/);
	assert.match(traktStremioSource, /function resetCinetraktDetailPosterTargets\(\)/);
	assert.match(traktStremioSource, /target\.removeAttribute\('data-stremio-url'\)/);
	assert.match(traktStremioSource, /pendingDetailPosterResolution = null;[\s\S]*?resetCinetraktDetailPosterTargets\(\)/);
	assert.match(traktStremioSource, /function isCinetraktPrimaryPosterLink\(element, interactive\)/);
	assert.match(traktStremioSource, /posterImage\.closest\('a\[href\]'\) === interactive/);
	assert.match(traktStremioSource, /&& !isCinetraktPrimaryPosterLink\(element, nativeInteractive\)/);
	assert.match(traktStremioSource, /bindCinetraktPendingDetailPosterTargets\(\)/);
	assert.match(traktStremioSource, /resolvePendingDetailPosterStremioUrl\(\)/);
	assert.match(traktStremioSource, /getTraktMediaIdFromDetailPoster\(pending\.media\.kind\)/);
	assert.match(traktStremioSource, /requestTraktImdbId\(`\/\$\{pending\.media\.kind\}\/\$\{traktId\}`\)/);
	assert.match(traktStremioSource, /openStremioFromMouseEvent\(stremioUrl, null\)/);
	assert.doesNotMatch(traktPosterSource, /opacity:\s*1\s*!important/);
	assert.doesNotMatch(traktStremioSource, /cinetrakt-sticky-poster-image/);
});

test('summary ratings keep IMDb, add Letterboxd, and preserve the native arrow trigger', () => {
	assert.match(traktRatingsSource, /querySelectorAll\('rating\[data-variant="row"\]'\)/);
	assert.match(traktRatingsSource, /getAttribute\('viewBox'\)/);
	assert.match(traktRatingsSource, /#f6c700/);
	assert.match(traktRatingsSource, /width \/ height > 1\.8/);
	assert.match(traktRatingsSource, /item\.classList\.add\('wos-trakt-rating-hidden'\)/);
	assert.match(traktRatingsSource, /function openWatchOnStremioImdbTitle\(imdbId\)/);
	assert.match(traktRatingsSource, /`https:\/\/www\.imdb\.com\/title\/\$\{imdbId\}\//);
	assert.match(traktRatingsSource, /link\.target = '_blank'/);
	assert.match(traktRatingsSource, /bindWatchOnStremioImdbDirectLink\(imdbItem, directImdbId\)/);
	assert.match(traktRatingsSource, /getImdbIdFromTraktMediaUrl\(window\.location\.href\)/);
	assert.match(traktStremioSource, /resolveImdbIdFromMediaUrl: getImdbIdFromTraktMediaUrl/);
	assert.match(traktRatingsSource, /querySelectorAll\('\.wos-imdb-ratings-popup-button'\)/);
	assert.match(traktRatingsSource, /buttons\.forEach\(\(button\) => button\.remove\(\)\)/);
	assert.match(traktRatingsSource, /summaryRatings\.closest\(/);
	assert.match(traktRatingsSource, /document\.createElement\('span'\)/);
	assert.match(traktRatingsSource, /row\.dataset\.cinetraktRatingsPopupRow = 'true'/);
	assert.match(traktRatingsSource, /placementAnchor\.parentNode\.insertBefore\(row, placementAnchor\)/);
	assert.match(traktRatingsSource, /popupRow\.insertBefore\(popupButton, placementAnchor\)/);
	assert.match(traktRatingsSource, /CineTraktSeasonChart\.updateButton\(popupButton, seasonRatings\)/);
	assert.doesNotMatch(traktRatingsSource, /wos-grid-blue|wos-grid-green|wos-grid-pink/);
	assert.match(traktRatingsSource, /popupButton\.dataset\.imdbId = imdbId/);
	assert.doesNotMatch(traktRatingsSource, /setWatchOnStremioRatingsPopupRow\(placementAnchor\.parentElement\)/);
	assert.doesNotMatch(traktRatingsSource, /function createWatchOnStremioTraktRatingsToggle/);
});

test('episode title and number share one explicit footer target', () => {
	const vm = require('node:vm');
	const context = vm.createContext({});
	vm.runInContext(traktStremioSource.slice(
		traktStremioSource.indexOf('function getSeasonEpisodeClickableTargets('),
		traktStremioSource.indexOf('function makeSeasonEpisodeElementClickable('),
	), context);
	for (const containerClass of ['trakt-card-footer-information', 'trakt-summary-card-titles']) {
		for (const isEpisodeTitle of [true, false]) {
			const title = { textContent: isEpisodeTitle ? 'Party On, Garth' : 'Supernatural',
				querySelector: () => isEpisodeTitle ? {} : null };
			const subtitle = { textContent: isEpisodeTitle ? 'S7 • E18' : 'S7 • E18 - Party On, Garth' };
			const container = { querySelector: selector => ({ '.trakt-card-title': title, '.trakt-card-subtitle': subtitle })[selector] };
			const episodeNumber = { closest: selector => selector.includes(`.${containerClass}`) ? container : null };
			const targets = context.getSeasonEpisodeClickableTargets(episodeNumber);
			assert.equal(targets.length, 1);
			assert.equal(targets[0], isEpisodeTitle ? container : subtitle);
		}
	}
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

test('the added collection follows the native summary row without displacing contextual information', () => {
	assert.match(traktCustomizationsSource, /document.createElement\('section'\)/);
	assert.match(traktCustomizationsSource, /summaryContainer\.appendChild\(host\)/);
	assert.match(traktCustomizationsSource, /grid-column: 1 \/ -1/);
	const collectionStyles = traktCustomizationsSource.slice(traktCustomizationsSource.indexOf('function injectCinetraktCollectionCardStyles'), traktCustomizationsSource.indexOf('function findCinetraktCollectionInsertionTarget'));
	assert.doesNotMatch(collectionStyles, /grid-template-columns:|grid-row:/);
	assert.match(traktCustomizationsSource, /CineTraktNativeSection.mount/);
	assert.doesNotMatch(traktCustomizationsSource, /cloneNode|readCollectionWatched|cinetrakt-collection-watched|GET_COLLECTION_ITEMS/);
});

test('native collection documents keep their own handlers without running extension features recursively', () => {
	const manifest = require('../manifest.json');
	const scripts = manifest.content_scripts.find(entry => entry.run_at === 'document_end' && entry.matches.includes('https://app.trakt.tv/*'));
	assert.equal(scripts.all_frames, undefined);
	const early = manifest.content_scripts.find(entry => entry.js?.includes('trakt-season-selector.js'));
	assert.equal(early.run_at, 'document_start');
	assert.ok(early.js.indexOf('trakt-native-section.js') < early.js.indexOf('trakt-season-selector.js'));
	assert.equal(scripts.js.includes('trakt-native-section.js'), false);
	const nativeSource = fs.readFileSync(require.resolve('../trakt-native-section.js'), 'utf8');
	assert.doesNotMatch(nativeSource, /cloneNode|innerHTML|indexedDB\.(?:open|databases)|fetch\(|localStorage|sessionStorage/);
	assert.match(nativeSource, /frame.contentDocument/);
	assert.match(nativeSource, /observer\?\.disconnect\(\)/);
	assert.match(nativeSource, /resizeObserver\?\.disconnect\(\)/);
});
