(() => {
	'use strict';

	const MESSAGE_TYPES = Object.freeze({
		OPEN_STREMIO_WEB: 'WATCH_ON_STREMIO_OPEN_WEB',
		RESOLVE_TRAKT_IMDB_ID: 'CINETRAKT_RESOLVE_TRAKT_IMDB_ID',
		OPEN_IMDB_RATINGS_POPUP: 'CINETRAKT_OPEN_IMDB_RATINGS_POPUP',
		RESIZE_IMDB_RATINGS_POPUP: 'CINETRAKT_RESIZE_IMDB_RATINGS_POPUP',
	});

	const api = Object.freeze({ MESSAGE_TYPES });
	globalThis.CineTraktExtensionProtocol = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
