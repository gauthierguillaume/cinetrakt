(() => {
	'use strict';

	const STORAGE_KEY = 'watchOnStremio:traktImdbCache:v1';
	const MAX_AGE = 1000 * 60 * 60 * 24 * 180;
	const FAILURE_COOLDOWN = 30 * 1000;

	function normalizeSlug(value) {
		return String(value || '').trim().toLowerCase();
	}

	function normalizeImdbId(value) {
		const imdbId = String(value || '').trim().toLowerCase();
		return /^tt\d{7,}$/.test(imdbId) ? imdbId : '';
	}

	function createCache({
		storage = globalThis.localStorage,
		storageKey = STORAGE_KEY,
		now = () => Date.now(),
		maxAge = MAX_AGE,
		failureCooldown = FAILURE_COOLDOWN,
	} = {}) {
		const entries = new Map();
		const pending = new Map();
		const failedAt = new Map();
		let loaded = false;

		function load() {
			if (loaded) return;
			loaded = true;

			try {
				const rawCache = storage?.getItem?.(storageKey);
				const parsedCache = rawCache ? JSON.parse(rawCache) : {};
				const currentTime = now();
				let needsMigration = false;

				Object.entries(parsedCache || {}).forEach(([rawSlug, value]) => {
					const slug = normalizeSlug(rawSlug);
					const legacyImdbId = typeof value === 'string' ? value : '';
					const imdbId = normalizeImdbId(legacyImdbId || value?.imdbId);
					const updatedAt = Number(value?.updatedAt) || currentTime;
					if (!slug || !imdbId || currentTime - updatedAt >= maxAge) {
						needsMigration = true;
						return;
					}
					if (legacyImdbId || !value?.updatedAt) needsMigration = true;
					entries.set(slug, { imdbId, updatedAt });
				});

				if (needsMigration) save();
			} catch (error) {
				console.warn('CineTrakt: IMDb cache load failed', error);
			}
		}

		function save() {
			try {
				const serialized = {};
				entries.forEach((entry, slug) => {
					serialized[slug] = { ...entry };
				});
				storage?.setItem?.(storageKey, JSON.stringify(serialized));
			} catch (error) {
				console.warn('CineTrakt: IMDb cache save failed', error);
			}
		}

		function get(rawSlug) {
			load();
			const slug = normalizeSlug(rawSlug);
			const entry = entries.get(slug);
			if (!entry) return '';
			if (now() - entry.updatedAt < maxAge) return entry.imdbId;

			entries.delete(slug);
			save();
			return '';
		}

		function set(rawSlug, rawImdbId) {
			load();
			const slug = normalizeSlug(rawSlug);
			const imdbId = normalizeImdbId(rawImdbId);
			if (!slug || !imdbId) return '';

			entries.set(slug, { imdbId, updatedAt: now() });
			failedAt.delete(slug);
			save();
			return imdbId;
		}

		async function resolve(rawSlug, resolver) {
			const slug = normalizeSlug(rawSlug);
			if (!slug || typeof resolver !== 'function') return '';

			const cachedImdbId = get(slug);
			if (cachedImdbId) return cachedImdbId;
			if (pending.has(slug)) return pending.get(slug);

			const lastFailure = failedAt.get(slug);
			if (lastFailure !== undefined && now() - lastFailure < failureCooldown) return '';

			const request = Promise.resolve()
				.then(() => resolver(slug))
				.then((value) => {
					const imdbId = normalizeImdbId(value);
					if (imdbId) return set(slug, imdbId);
					failedAt.set(slug, now());
					return '';
				})
				.catch((error) => {
					failedAt.set(slug, now());
					console.warn('CineTrakt: IMDb ID resolution failed', error);
					return '';
				})
				.finally(() => pending.delete(slug));

			pending.set(slug, request);
			return request;
		}

		return Object.freeze({ get, set, resolve });
	}

	const api = Object.freeze({
		STORAGE_KEY,
		MAX_AGE,
		FAILURE_COOLDOWN,
		createCache,
		normalizeSlug,
		normalizeImdbId,
	});

	globalThis.CineTraktImdbCache = createCache();

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
