(() => {
	'use strict';

	function isRatingsPopupMode(locationLike = globalThis.location) {
		return new URLSearchParams(locationLike?.search || '').get('cinetrakt_ratings_popup') === '1';
	}

	globalThis.CineTraktImdbPage = Object.freeze({ isRatingsPopupMode });

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = globalThis.CineTraktImdbPage;
	}
})();
