(() => {
	'use strict';
	const ID = /^tt\d{7,}$/;
	function normalizeSnapshot(value, imdbId) {
		if (!ID.test(imdbId) || !value || value.imdbId !== imdbId || !Array.isArray(value.episodes)
			|| !value.episodes.length || value.episodes.length > 10000) return null;
		const episodes = [], seen = new Map();
		for (const item of value.episodes) {
			if (!item || !Number.isInteger(item.season) || item.season < 0 || item.season > 200
				|| !Number.isInteger(item.episode) || item.episode < 1 || item.episode > 2000 || !ID.test(item.imdbId)
				|| (item.rating !== null && (typeof item.rating !== 'number' || !Number.isFinite(item.rating) || item.rating < 1 || item.rating > 10))) return null;
			const key = `${item.season}:${item.episode}`, previous = seen.get(key);
			if (previous) {
				if (previous.imdbId !== item.imdbId || previous.rating !== item.rating) return null;
				continue;
			}
			const episode = { season: item.season, episode: item.episode, imdbId: item.imdbId, rating: item.rating };
			seen.set(key, episode); episodes.push(episode);
		}
		episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
		const totalEpisodes = Number.isInteger(value.totalEpisodes) && value.totalEpisodes >= episodes.length && value.totalEpisodes <= 10000
			? value.totalEpisodes : episodes.length;
		return { imdbId, episodes, totalEpisodes, complete: value.complete === true && episodes.length === totalEpisodes };
	}

	function buildTableModel(snapshot, ratingUtils, columnWidth = 88) {
		const seasons = [...new Set(snapshot.episodes.map(item => item.season))].map(number => {
			const episodes = snapshot.episodes.filter(item => item.season === number);
			return { number, episodes: new Map(episodes.map(item => [item.episode, item])),
				average: snapshot.complete ? ratingUtils.calculateAverage(episodes.map(item => item.rating)) : null };
		});
		const episodeCount = Math.max(...snapshot.episodes.map(item => item.episode));
		// Include the label column, native drawer padding and the vertical
		// scrollbar, so the final season is not clipped on an otherwise wide screen.
		return { seasons, episodeCount, width: Math.max(400, 60 + (seasons.length + 1) * (columnWidth + 8)) };
	}

	const api = Object.freeze({ normalizeSnapshot, buildTableModel });
	globalThis.CineTraktEpisodeRatings = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
