(() => {
	'use strict';

	const TRAKT_API_ORIGIN = 'https://api.trakt.tv';
	const TRAKT_API_CLIENT_ID = '201dc70c5ec6af530f12f079ea1922733f6e1085ad7b02f36d8e011b75bcea7d';
	const TRAKT_MEDIA_PATH_PATTERN = /^\/(movies|shows)\/([a-z0-9][a-z0-9-]*)\/?$/i;
	const TRAKT_MEDIA_IMAGE_PATTERN = /^\/images\/(movies|shows)\/(\d{3})\/(\d{3})\/(\d{3})\//i;

	function parseTraktMediaPath(value) {
		const pathname = String(value || '').split(/[?#]/, 1)[0];
		const match = pathname.match(TRAKT_MEDIA_PATH_PATTERN);
		if (!match) return null;

		return Object.freeze({
			kind: match[1].toLowerCase(),
			slug: match[2].toLowerCase(),
			pathname: `/${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
		});
	}

	function findImdbIdInTraktResponse(value) {
		let media = value;
		if (typeof value === 'string') {
			try {
				media = JSON.parse(value);
			} catch {
				return '';
			}
		}

		const imdbId = String(media?.ids?.imdb || '').toLowerCase();
		return /^tt\d{7,}$/.test(imdbId) ? imdbId : '';
	}

	function getTraktMediaIdFromImageUrl(value, expectedKind = '') {
		let url;
		try {
			url = new URL(String(value || ''));
		} catch {
			return '';
		}
		if (url.origin !== 'https://media.trakt.tv') return '';

		const match = url.pathname.match(TRAKT_MEDIA_IMAGE_PATTERN);
		if (!match || (expectedKind && match[1].toLowerCase() !== expectedKind.toLowerCase())) return '';

		return String(Number.parseInt(`${match[2]}${match[3]}${match[4]}`, 10));
	}

	function getTraktApiMediaUrl(pathname) {
		const media = parseTraktMediaPath(pathname);
		return media
			? `${TRAKT_API_ORIGIN}/${media.kind}/${encodeURIComponent(media.slug)}?extended=full`
			: '';
	}

	function getTraktApiRatingsUrl(pathname) {
		const media = parseTraktMediaPath(pathname);
		return media
			? `${TRAKT_API_ORIGIN}/${media.kind}/${encodeURIComponent(media.slug)}/ratings?extended=all`
			: '';
	}

	function findExternalRatingsInTraktResponse(value) {
		function parseSource(source, max, hosts, pathPattern) {
			if (typeof source?.rating !== 'number' || !Number.isFinite(source.rating)
				|| source.rating < 0 || source.rating > max || typeof source.link !== 'string') return null;
			try {
				const link = new URL(source.link.startsWith('https://') ? source.link : `https://${source.link}`);
				if (link.protocol !== 'https:' || !hosts.includes(link.hostname) || link.port || link.username || link.password
					|| !pathPattern.test(link.pathname) || link.search || link.hash) return null;
				return { rating: source.rating, url: link.href,
					votes: Number.isSafeInteger(source.votes) && source.votes >= 0 ? source.votes : null };
			} catch { return null; }
		}
		const imdb = parseSource(value?.imdb, 10, ['www.imdb.com', 'imdb.com'], /^\/title\/tt\d{7,}\/?$/i);
		const mal = parseSource(value?.mal, 10, ['myanimelist.net', 'www.myanimelist.net'], /^\/anime\/[1-9]\d*(?:\/[a-z0-9_-]+)?\/?$/i);
		const letterboxd = parseSource(value?.letterboxd, 5, ['letterboxd.com'], /^\/film\/[a-z0-9-]+\/?$/i);
		return imdb || mal || letterboxd ? { imdb, mal, letterboxd } : null;
	}

	const api = Object.freeze({
		TRAKT_API_ORIGIN,
		TRAKT_API_CLIENT_ID,
		TRAKT_MEDIA_PATH_PATTERN,
		TRAKT_MEDIA_IMAGE_PATTERN,
		parseTraktMediaPath,
		findImdbIdInTraktResponse,
		getTraktMediaIdFromImageUrl,
		getTraktApiMediaUrl,
		getTraktApiRatingsUrl,
		findExternalRatingsInTraktResponse,
	});

	globalThis.CineTraktTraktImdbResolver = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
