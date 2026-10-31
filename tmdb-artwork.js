(() => {
	'use strict';
	const IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
	const isImagePath = path => typeof path === 'string' && /^\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(path);
	function posterLanguage(details) {
		const title = details.original_title || details.original_name || '';
		// Punctuation and digits do not determine a script. Accented Latin
		// letters remain in the original language; other scripts use English.
		const letters = [...title].filter(letter => /\p{Letter}/u.test(letter));
		return letters.length && letters.every(letter => /\p{Script=Latin}/u.test(letter))
			? details.original_language || 'en' : 'en';
	}
	function catalogFromDetails(details) {
		const language = posterLanguage(details);
		const paths = (kind, accept) => [...new Set((Array.isArray(details.images?.[kind]) ? details.images[kind] : [])
			.filter(image => isImagePath(image.file_path) && accept(image)).map(image => image.file_path))];
		return { language,
			posters: paths('posters', image => image.iso_639_1 === language),
			// TMDB's null language marks artwork without language-specific text.
			backdrops: paths('backdrops', image => image.iso_639_1 === null),
		};
	}
	function createPool(paths, random = Math.random) {
		const all = [...new Set(paths.filter(isImagePath))];
		let bag = [];
		return { next(exclude = '') {
			if (!all.some(path => path !== exclude)) return '';
			if (!bag.length) {
				bag = [...all];
				for (let i = bag.length - 1; i > 0; i--) {
					const j = Math.floor(random() * (i + 1));
					[bag[i], bag[j]] = [bag[j], bag[i]];
				}
			}
			let index = bag.findIndex(path => path !== exclude);
			if (index < 0) { bag = []; return this.next(exclude); }
			return bag.splice(index, 1)[0];
		} };
	}
	function isAllowedRequest(pathname, sender) {
		try {
			const url = new URL(sender?.tab?.url || sender?.url || '');
			return sender.frameId === 0 && url.origin === 'https://app.trakt.tv'
				&& /^\/(movies|shows)\/[a-z0-9][a-z0-9-]*\/?$/i.test(pathname)
				&& url.pathname.replace(/\/$/, '') === pathname.replace(/\/$/, '');
		} catch { return false; }
	}
	function createLoader({ settings, resolver, fetch: request = globalThis.fetch, now = Date.now }) {
		const cache = new Map(); let credential = '';
		async function json(url, headers) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 10000);
			try {
				const response = await request(url, { headers, credentials: 'omit', signal: controller.signal });
				if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'credential' : 'network');
				return await response.json();
			} finally { clearTimeout(timer); }
		}
		return async function load(pathname) {
			await settings.ready;
			const traktUrl = resolver.getTraktApiMediaUrl(pathname);
			if (!traktUrl || !settings.isEnabled('traktArtworkSwitcher')) return { ok: false, error: 'unavailable' };
			const saved = settings.getTmdbCredential();
			if (!saved) return { ok: false, error: 'missing-credential' };
			if (credential !== saved) { cache.clear(); credential = saved; }
			const key = pathname.replace(/\/$/, '');
			const cached = cache.get(key);
			if (cached && cached.expiresAt > now()) return cached.promise;
			const entry = { expiresAt: Infinity, promise: null };
			entry.promise = (async () => {
				try {
					const media = await json(traktUrl, { 'trakt-api-key': resolver.TRAKT_API_CLIENT_ID, 'trakt-api-version': '2' });
					const id = media.ids?.tmdb;
					if (!Number.isSafeInteger(id) || id <= 0) throw new Error('no-id');
					const kind = key.startsWith('/shows/') ? 'tv' : 'movie';
					// Resolve the exact Trakt reference. Never search by title and never
					// call a season/episode endpoint for a show's artwork.
					const url = new URL(`https://api.themoviedb.org/3/${kind}/${id}`);
					url.searchParams.set('append_to_response', 'images');
					const headers = { Accept: 'application/json' };
					if (globalThis.CineTraktTmdbUtils.isBearerToken(saved)) headers.Authorization = `Bearer ${saved}`;
					else url.searchParams.set('api_key', saved);
					const details = await json(url.href, headers);
					if (details.id !== id) throw new Error('no-id');
					entry.expiresAt = now() + 6 * 60 * 60 * 1000;
					return { ok: true, ...catalogFromDetails(details) };
				} catch (error) {
					entry.expiresAt = now() + 1500;
					return { ok: false, error: ['credential', 'no-id'].includes(error.message) ? error.message : 'network' };
				}
			})();
			cache.set(key, entry);
			if (cache.size > 50) cache.delete(cache.keys().next().value);
			return entry.promise;
		};
	}
	const api = Object.freeze({ IMAGE_BASE, isImagePath, posterLanguage, catalogFromDetails, createPool, isAllowedRequest, createLoader });
	globalThis.CineTraktTmdbArtwork = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
