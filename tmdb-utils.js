(() => {
	'use strict';

	function isBearerToken(value) {
		const token = String(value || '');
		return /^eyJ[A-Za-z0-9._-]+$/.test(token) || token.length > 80;
	}

	function shuffle(items, random = Math.random) {
		const result = [...items];
		for (let index = result.length - 1; index > 0; index -= 1) {
			const target = Math.floor(random() * (index + 1));
			[result[index], result[target]] = [result[target], result[index]];
		}
		return result;
	}

	function sortImagesByQuality(images) {
		return [...images].sort((left, right) => {
			const voteDifference = (right.vote_count || 0) - (left.vote_count || 0);
			if (voteDifference) return voteDifference;
			const ratingDifference = (right.vote_average || 0) - (left.vote_average || 0);
			if (ratingDifference) return ratingDifference;
			return (right.width || 0) - (left.width || 0);
		});
	}

	function getImagePreferences(originalLanguage) {
		return originalLanguage === 'fr'
			? { apiLanguage: 'fr-FR', includedLanguages: 'fr,null,en', posterLanguages: ['fr', null, 'en'] }
			: { apiLanguage: 'en-US', includedLanguages: 'en,null', posterLanguages: ['en', null] };
	}

	function getPreferredPosterPath(details, posterLanguages) {
		const posters = Array.isArray(details.images?.posters) ? details.images.posters : [];
		for (const language of posterLanguages) {
			const candidate = sortImagesByQuality(posters.filter((image) => image.iso_639_1 === language))[0];
			if (candidate?.file_path) return candidate.file_path;
		}
		return '';
	}

	function getBackdropPaths(details) {
		const imagePaths = Array.isArray(details.images?.backdrops)
			? sortImagesByQuality(details.images.backdrops).map((image) => image.file_path)
			: [];
		if (details.backdrop_path) imagePaths.unshift(details.backdrop_path);
		return [...new Set(imagePaths.filter(Boolean))];
	}

	function getMediaConfiguration(mediaType) {
		return mediaType === 'tv'
			? { detailsPath: 'tv', discoverPath: '/discover/tv', traktPath: 'shows' }
			: { detailsPath: 'movie', discoverPath: '/discover/movie', traktPath: 'movies' };
	}

	const api = Object.freeze({
		isBearerToken,
		shuffle,
		sortImagesByQuality,
		getImagePreferences,
		getPreferredPosterPath,
		getBackdropPaths,
		getMediaConfiguration,
	});
	globalThis.CineTraktTmdbUtils = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
