(() => {
	'use strict';

	function getTraktMediaType(url) {
		return String(url || '').includes('/shows/') ? 'series' : 'movie';
	}

	function buildStremioDetailUrl(mediaType, imdbId) {
		if (!imdbId) return '';
		const type = mediaType === 'series' ? 'series' : 'movie';
		return `stremio:///detail/${type}/${imdbId}`;
	}

	function buildStremioEpisodeUrl(imdbId, season, episode) {
		if (!imdbId) return '';
		const videoId = `${imdbId}:${season}:${episode}`;
		return `stremio:///detail/series/${imdbId}/${encodeURIComponent(videoId)}`;
	}

	function getStremioWebUrl(stremioUrl) {
		if (!stremioUrl) return '';

		return String(stremioUrl)
			.replace(/^stremio:\/\/\/detail\//, 'https://web.stremio.com/#/detail/')
			.replace(/^stremio:\/\/detail\//, 'https://web.stremio.com/#/detail/')
			.replace(/%3A/gi, ':');
	}

	function getStremioPopupUrl(stremioUrl, timestamp = Date.now()) {
		const webUrl = getStremioWebUrl(stremioUrl);
		if (!webUrl) return '';

		const hashIndex = webUrl.indexOf('#');
		const cacheBuster = `wos_t=${timestamp}`;
		if (hashIndex === -1) {
			const separator = webUrl.includes('?') ? '&' : '?';
			return `${webUrl}${separator}wos_stream_panel=1&${cacheBuster}`;
		}

		const beforeHash = webUrl.slice(0, hashIndex);
		const afterHash = webUrl.slice(hashIndex);
		const separator = beforeHash.includes('?') ? '&' : '?';
		return `${beforeHash}${separator}wos_stream_panel=1&${cacheBuster}${afterHash}`;
	}

	function isStremioWebUrl(value) {
		try {
			const url = new URL(String(value || ''));
			return url.protocol === 'https:'
				&& url.hostname === 'web.stremio.com'
				&& url.searchParams.get('wos_stream_panel') === '1'
				&& /^#\/detail\/(?:movie|series)\/tt\d{7,}(?:\/tt\d{7,}:\d+:\d+)?(?:\?|$)/i.test(url.hash);
		} catch (error) {
			return false;
		}
	}

	function getSeasonEpisodeFromText(text) {
		const match = String(text || '').match(/S\s*(\d+)\s*[•·.-]\s*E\s*(\d+)/i);
		if (!match) return null;

		return {
			season: Number.parseInt(match[1], 10),
			episode: Number.parseInt(match[2], 10),
		};
	}

	function getEpisodeDataFromTraktUrl(url, origin = globalThis.location?.origin || '') {
		let parsed;
		try {
			parsed = new URL(String(url || ''), origin || 'https://app.trakt.tv');
		} catch {
			return null;
		}

		const legacyMatch = parsed.pathname.match(
			/^\/shows\/([^/?#]+)\/seasons\/(\d+)\/episodes\/(\d+)\/?$/i,
		);
		const showMatch = parsed.pathname.match(/^\/shows\/([^/?#]+)\/?$/i);
		const showSlug = legacyMatch?.[1] || showMatch?.[1];
		const seasonValue = legacyMatch?.[2] || parsed.searchParams.get('season');
		const episodeValue = legacyMatch?.[3] || parsed.searchParams.get('episode');

		if (!showSlug || !/^\d+$/.test(seasonValue || '') || !/^\d+$/.test(episodeValue || '')) {
			return null;
		}

		const season = Number.parseInt(seasonValue, 10);
		const episode = Number.parseInt(episodeValue, 10);
		if (!Number.isSafeInteger(season) || season < 0 || !Number.isSafeInteger(episode) || episode < 1) {
			return null;
		}

		return {
			showSlug,
			season,
			episode,
			showUrl: `${parsed.origin}/shows/${showSlug}`,
		};
	}

	const api = Object.freeze({
		getTraktMediaType,
		buildStremioDetailUrl,
		buildStremioEpisodeUrl,
		getStremioWebUrl,
		getStremioPopupUrl,
		isStremioWebUrl,
		getSeasonEpisodeFromText,
		getEpisodeDataFromTraktUrl,
	});

	globalThis.CineTraktStremioUrls = api;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
