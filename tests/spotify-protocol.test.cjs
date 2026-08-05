const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../spotify-protocol.js');

test('Spotify bridge protocol keeps one stable set of message types and origins', () => {
	assert.deepEqual(protocol.MESSAGE_TYPES, {
		READY: 'cinetrakt:spotify-embed-ready',
		METADATA: 'cinetrakt:spotify-embed-metadata',
		PLAYBACK_STATE: 'cinetrakt:spotify-embed-playback-state',
		PLAY_REQUEST: 'cinetrakt:spotify-embed-play',
	});
	assert.equal(protocol.SPOTIFY_ORIGIN, 'https://open.spotify.com');
	assert.equal(protocol.TRAKT_ORIGIN, 'https://app.trakt.tv');
});
