const test = require('node:test');
const assert = require('node:assert/strict');

const {
	STORAGE_KEY,
	createCache,
} = require('../trakt-imdb-cache.js');

function createStorage(initialValue = null) {
	let value = initialValue;
	return {
		getItem(key) {
			return key === STORAGE_KEY ? value : null;
		},
		setItem(key, nextValue) {
			if (key === STORAGE_KEY) value = nextValue;
		},
		read() {
			return value;
		},
	};
}

test('cache keeps compatible legacy entries and expires stale dated entries', () => {
	let currentTime = 1_000_000;
	const storage = createStorage(JSON.stringify({
		legacy: 'tt1520211',
		fresh: { imdbId: 'tt0903747', updatedAt: currentTime - 100 },
		stale: { imdbId: 'tt2861424', updatedAt: currentTime - 10_000 },
	}));
	const cache = createCache({ storage, now: () => currentTime, maxAge: 1_000 });

	assert.equal(cache.get('legacy'), 'tt1520211');
	assert.equal(cache.get('fresh'), 'tt0903747');
	assert.equal(cache.get('stale'), '');
	const migrated = JSON.parse(storage.read());
	assert.deepEqual(migrated.legacy, { imdbId: 'tt1520211', updatedAt: currentTime });
	assert.equal(migrated.stale, undefined);
});

test('writing one entry preserves timestamps belonging to other entries', () => {
	let currentTime = 20_000;
	const storage = createStorage(JSON.stringify({
		existing: { imdbId: 'tt0903747', updatedAt: 12_345 },
	}));
	const cache = createCache({ storage, now: () => currentTime });

	cache.set('new-show', 'tt1520211');
	const saved = JSON.parse(storage.read());
	assert.equal(saved.existing.updatedAt, 12_345);
	assert.equal(saved['new-show'].updatedAt, currentTime);
});

test('parallel resolutions share one request and cache its result', async () => {
	const cache = createCache({ storage: createStorage() });
	let calls = 0;
	let release;
	const resolver = () => {
		calls += 1;
		return new Promise((resolve) => {
			release = resolve;
		});
	};

	const first = cache.resolve('silo', resolver);
	const second = cache.resolve('silo', resolver);
	await Promise.resolve();
	release('tt14688458');

	assert.equal(await first, 'tt14688458');
	assert.equal(await second, 'tt14688458');
	assert.equal(calls, 1);
	assert.equal(await cache.resolve('silo', resolver), 'tt14688458');
	assert.equal(calls, 1);
});

test('failed resolutions use a short cooldown instead of becoming permanent', async () => {
	let currentTime = 0;
	const cache = createCache({
		storage: createStorage(),
		now: () => currentTime,
		failureCooldown: 500,
	});
	let calls = 0;
	const resolver = async () => {
		calls += 1;
		return '';
	};

	assert.equal(await cache.resolve('unknown', resolver), '');
	assert.equal(await cache.resolve('unknown', resolver), '');
	assert.equal(calls, 1);

	currentTime += 501;
	assert.equal(await cache.resolve('unknown', resolver), '');
	assert.equal(calls, 2);
});
