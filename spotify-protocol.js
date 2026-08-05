(() => {
	'use strict';

	const MESSAGE_TYPES = Object.freeze({
		READY: 'cinetrakt:spotify-embed-ready',
		METADATA: 'cinetrakt:spotify-embed-metadata',
		PLAYBACK_STATE: 'cinetrakt:spotify-embed-playback-state',
		PLAY_REQUEST: 'cinetrakt:spotify-embed-play',
	});

	const api = Object.freeze({
		MESSAGE_TYPES,
		SPOTIFY_ORIGIN: 'https://open.spotify.com',
		TRAKT_ORIGIN: 'https://app.trakt.tv',
	});

	globalThis.CineTraktSpotifyProtocol = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
