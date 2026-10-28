(() => {
	'use strict';
	const resolver = globalThis.CineTraktTraktImdbResolver
		|| (typeof require === 'function' ? require('./trakt-imdb-resolver.js') : null);
	const CHART_WIDTH = 220;

	function getSeasonRatingsUrl(pathname) {
		const media = resolver.parseTraktMediaPath(pathname);
		return media?.kind === 'shows'
			? `${resolver.TRAKT_API_ORIGIN}/shows/${encodeURIComponent(media.slug)}/seasons?extended=full,images`
			: '';
	}

	function parseSeasonRatings(value, now = Date.now()) {
		if (!Array.isArray(value)) return null;
		const seen = new Set();
		return value.filter(season => {
			if (!Number.isInteger(season?.number) || season.number <= 0 || seen.has(season.number)
				|| !(season.episode_count > 0) || typeof season.rating !== 'number'
				|| !Number.isFinite(season.rating) || season.rating < 0 || season.rating > 10
				|| typeof season.first_aired !== 'string' || !(Date.parse(season.first_aired) <= now)) return false;
			seen.add(season.number);
			return true;
		}).map(season => ({ season: season.number, percent: Math.round(season.rating * 10) }))
			.sort((a, b) => a.season - b.season);
	}

	function normalizeSeasonPosterUrl(value) {
		if (typeof value !== 'string' || !value) return '';
		try {
			const url = new URL(value.startsWith('https://') ? value : `https://${value}`);
			if (url.origin !== 'https://media.trakt.tv' || url.username || url.password || url.search || url.hash
				|| !/^\/images\/seasons\/\d{3}\/\d{3}\/\d{3}\/posters\/(?:original|medium|thumb)\/[a-z0-9_.-]+$/i.test(url.pathname)) return '';
			url.pathname = url.pathname.replace(/\/(?:original|medium)\//, '/thumb/');
			return url.href;
		} catch { return ''; }
	}

	function parseSeasonPosters(value) {
		const posters = {};
		if (!Array.isArray(value)) return posters;
		for (const season of value) {
			if (!Number.isInteger(season?.number) || season.number < 0 || season.number > 200 || posters[season.number]
				|| !Array.isArray(season.images?.poster)) continue;
			const poster = season.images.poster.map(normalizeSeasonPosterUrl).find(Boolean);
			if (poster) posters[season.number] = poster;
		}
		return posters;
	}

	function parseSeasonDetails(value) {
		const details = {};
		if (!Array.isArray(value)) return details;
		for (const season of value) {
			if (!Number.isInteger(season?.number) || season.number < 0 || season.number > 200 || details[season.number]) continue;
			const title = typeof season.title === 'string' ? season.title.trim().slice(0, 300) : '';
			const count = Number.isInteger(season.episode_count) && season.episode_count >= 0 ? season.episode_count : 0;
			details[season.number] = {
				title: /^(?:specials|season \d+)$/i.test(title) ? '' : title,
				aired: Number.isInteger(season.aired_episodes) && season.aired_episodes >= 0 ? Math.min(count, season.aired_episodes) : count,
			};
		}
		return details;
	}

	function buildSeasonChart(seasons) {
		const values = Array.isArray(seasons) ? seasons.filter(p => Number.isInteger(p?.season) && p.season > 0
			&& Number.isInteger(p.percent) && p.percent >= 0 && p.percent <= 100) : [];
		if (!values.length) return { points: [], line: '', area: '', ticks: [], peak: null, low: null };
		const floor = Math.min(60, ...values.map(p => p.percent));
		const top = Math.max(...values.map(p => p.percent), floor + 1);
		const points = values.map((p, index) => ({ ...p,
			x: values.length === 1 ? CHART_WIDTH / 2 : 5 + index * (CHART_WIDTH - 10) / (values.length - 1),
			y: 57 - (p.percent - floor) * 51 / (top - floor),
		}));
		const slopes = points.slice(1).map((p, i) => (p.y - points[i].y) / (p.x - points[i].x));
		const tangents = points.map((p, i) => i === 0 ? slopes[0] || 0 : i === points.length - 1 ? slopes[i - 1]
			: slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
		// Monotone cubic segments keep the native chart's smooth line without
		// creating peaks or troughs that are absent from the season ratings.
		for (let i = 0; i < slopes.length; i++) {
			if (!slopes[i]) { tangents[i] = tangents[i + 1] = 0; continue; }
			const length = Math.hypot(tangents[i] / slopes[i], tangents[i + 1] / slopes[i]);
			if (length > 3) { tangents[i] *= 3 / length; tangents[i + 1] *= 3 / length; }
		}
		const n = x => Number(x.toFixed(3));
		let line = `M${n(points[0].x)} ${n(points[0].y)}`;
		for (let i = 1; i < points.length; i++) {
			const a = points[i - 1], b = points[i], dx = (b.x - a.x) / 3;
			line += `C${n(a.x + dx)} ${n(a.y + dx * tangents[i - 1])} ${n(b.x - dx)} ${n(b.y - dx * tangents[i])} ${n(b.x)} ${n(b.y)}`;
		}
		const tickStep = Math.max(1, Math.ceil(points.length / 15));
		const ticks = points.filter((p, i) => i === 0 || i === points.length - 1
			|| (i % tickStep === 0 && i <= points.length - 1 - tickStep));
		return { points, line, area: `${line}L${n(points.at(-1).x)} 57L${n(points[0].x)} 57Z`, ticks,
			peak: points.reduce((a, b) => b.percent > a.percent ? b : a),
			low: points.reduce((a, b) => b.percent < a.percent ? b : a) };
	}

	function nearestSeasonIndex(points, x) {
		if (!points.length) return -1;
		return points.reduce((best, p, i) => Math.abs(p.x - x) < Math.abs(points[best].x - x) ? i : best, 0);
	}

	const api = Object.freeze({ CHART_WIDTH, getSeasonRatingsUrl, parseSeasonRatings, parseSeasonPosters, parseSeasonDetails, normalizeSeasonPosterUrl, buildSeasonChart, nearestSeasonIndex });
	globalThis.CineTraktSeasonRatings = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
