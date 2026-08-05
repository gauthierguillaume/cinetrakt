const test = require('node:test');
const assert = require('node:assert/strict');

const { MESSAGE_TYPES } = require('../extension-protocol.js');

test('extension contexts share one stable runtime message contract', () => {
	assert.deepEqual(MESSAGE_TYPES, {
		OPEN_STREMIO_WEB: 'WATCH_ON_STREMIO_OPEN_WEB',
		OPEN_IMDB_RATINGS_POPUP: 'CINETRAKT_OPEN_IMDB_RATINGS_POPUP',
		RESIZE_IMDB_RATINGS_POPUP: 'CINETRAKT_RESIZE_IMDB_RATINGS_POPUP',
	});
});
