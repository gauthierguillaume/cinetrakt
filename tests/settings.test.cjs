const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'settings.js'), 'utf8');

function loadSettings({ protocol = 'chrome-extension:', stored = {}, getError = '', setError = '' } = {}) {
	let storageListener = null;
	let requestedKeys = [];
	const writes = [];
	const runtime = {};
	const chrome = {
		runtime,
		storage: {
			local: {
				get(keys, callback) {
					requestedKeys = Array.from(keys);
					runtime.lastError = getError ? { message: getError } : null;
					callback(stored);
					runtime.lastError = null;
				},
				set(entries, callback) {
					writes.push(JSON.parse(JSON.stringify(entries)));
					runtime.lastError = setError ? { message: setError } : null;
					callback();
					runtime.lastError = null;
				},
			},
			onChanged: {
				addListener(listener) {
					storageListener = listener;
				},
			},
		},
	};
	const context = vm.createContext({ chrome, location: { protocol } });
	vm.runInContext(source, context, { filename: 'settings.js' });

	return {
		settings: context.CineTraktSettings,
		getRequestedKeys: () => requestedKeys,
		getStorageListener: () => storageListener,
		writes,
	};
}

test('settings load normalized values and private credentials on extension pages', async () => {
	const storageKey = 'cinetrakt:feature-settings:v1';
	const credentialKey = 'cinetrakt:tmdb-credential:v1';
	const harness = loadSettings({
		stored: {
			[storageKey]: { traktStremioLinks: false, unknownFeature: false },
			[credentialKey]: '  secret-token  ',
		},
	});
	const values = await harness.settings.ready;

	assert.equal(values.traktStremioLinks, false);
	assert.equal(values.traktRatingColors, true);
	assert.equal('unknownFeature' in values, false);
	assert.equal(harness.settings.getTmdbCredential(), 'secret-token');
	assert.deepEqual(harness.getRequestedKeys(), [storageKey, credentialKey]);
});

test('content pages never request the private TMDB credential', async () => {
	const harness = loadSettings({ protocol: 'https:' });
	await harness.settings.ready;

	assert.deepEqual(harness.getRequestedKeys(), ['cinetrakt:feature-settings:v1']);
	assert.equal(harness.settings.getTmdbCredential(), '');
});

test('storage read failures fall back to defaults without rejecting readiness', async () => {
	const harness = loadSettings({ getError: 'Extension context invalidated.' });
	const values = await harness.settings.ready;

	assert.equal(values.traktStremioLinks, true);
	assert.equal(values.imdbRatingColors, true);
	assert.equal(harness.settings.loaded, true);
});

test('storage write failures reject so the popup can report them', async () => {
	const harness = loadSettings({ setError: 'Storage unavailable.' });
	await harness.settings.ready;

	await assert.rejects(
		harness.settings.save({ traktStremioLinks: false }),
		/Storage unavailable/,
	);
});

test('storage changes update the in-memory feature snapshot', async () => {
	const harness = loadSettings();
	await harness.settings.ready;
	const listener = harness.getStorageListener();

	listener({
		'cinetrakt:feature-settings:v1': { newValue: { traktPosterLayout: false } },
	}, 'local');

	assert.equal(harness.settings.isEnabled('traktPosterLayout'), false);
	assert.equal(harness.settings.isEnabled('traktStremioLinks'), true);
});

test('every Trakt option belongs to a clear popup subcategory', () => {
	const harness = loadSettings();
	const traktFeatures = Array.from(harness.settings.DEFINITIONS)
		.filter((feature) => feature.group === 'Trakt');
	const categories = new Set(traktFeatures.map((feature) => feature.category));

	assert.equal(traktFeatures.length, 9);
	assert.deepEqual(
		[...categories].sort(),
		['Affichage des fiches', 'Lecture et Stremio', 'Navigation', 'Notes et IMDb'].sort(),
	);
	assert.ok(traktFeatures.every((feature) => feature.title && feature.description));
});
