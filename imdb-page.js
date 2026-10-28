(() => {
	'use strict';

	function isRatingsDataMode(locationLike = globalThis.location) {
		return new URLSearchParams(locationLike?.search || '').get('cinetrakt_ratings_data') === '1';
	}

	globalThis.CineTraktImdbPage = Object.freeze({ isRatingsDataMode });

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = globalThis.CineTraktImdbPage;
	}
})();
