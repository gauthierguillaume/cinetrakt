const test = require('node:test');
const assert = require('node:assert/strict');

const { getRouteKey, isOwnedMutation } = require('../trakt-runtime.js');

function element({ id = '', classes = [] } = {}) {
	return {
		nodeType: 1,
		id,
		classList: classes,
	};
}

test('getRouteKey includes path, query and hash', () => {
	assert.equal(
		getRouteKey({ pathname: '/shows/silo', search: '?season=3', hash: '#episodes' }),
		'/shows/silo?season=3#episodes',
	);
});

test('isOwnedMutation ignores mutations created entirely by CineTrakt', () => {
	assert.equal(isOwnedMutation({
		target: element({ id: 'cinetrakt-collection-card-host' }),
		addedNodes: [element()],
		removedNodes: [],
	}), true);

	assert.equal(isOwnedMutation({
		target: element(),
		addedNodes: [element({ classes: ['watch-on-stremio-episode-link'] })],
		removedNodes: [],
	}), true);
});

test('isOwnedMutation keeps native Trakt mutations relevant', () => {
	assert.equal(isOwnedMutation({
		target: element({ classes: ['trakt-summary-container'] }),
		addedNodes: [element({ classes: ['trakt-summary-ratings'] })],
		removedNodes: [],
	}), false);

	assert.equal(isOwnedMutation({
		target: element(),
		addedNodes: [
			element({ classes: ['cinetrakt-soundtrack-card'] }),
			element({ classes: ['trakt-summary-ratings'] }),
		],
		removedNodes: [],
	}), false);
});
