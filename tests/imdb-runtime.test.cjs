const test = require('node:test');
const assert = require('node:assert/strict');

const { getRouteKey, isOwnedMutation } = require('../imdb-runtime.js');

function element({ id = '', classes = [] } = {}) {
	return {
		nodeType: 1,
		id,
		classList: classes,
	};
}

test('IMDb route keys include title subpages and popup parameters', () => {
	assert.equal(
		getRouteKey({ pathname: '/title/tt1520211/ratings', search: '?cinetrakt_ratings_popup=1', hash: '' }),
		'/title/tt1520211/ratings?cinetrakt_ratings_popup=1',
	);
});

test('IMDb runtime ignores DOM mutations created entirely by CineTrakt', () => {
	assert.equal(isOwnedMutation({
		target: element(),
		addedNodes: [element({ classes: ['trakt-header-btn'] })],
		removedNodes: [],
	}), true);

	assert.equal(isOwnedMutation({
		target: element({ id: 'sg-average-column-table' }),
		addedNodes: [element()],
		removedNodes: [],
	}), true);
});

test('IMDb runtime keeps native page mutations relevant', () => {
	assert.equal(isOwnedMutation({
		target: element(),
		addedNodes: [element({ classes: ['ipc-page-content-container'] })],
		removedNodes: [],
	}), false);

	assert.equal(isOwnedMutation({
		target: element(),
		addedNodes: [
			element({ classes: ['sg-rating-cell'] }),
			element({ classes: ['ratings-heatmap__table-data'] }),
		],
		removedNodes: [],
	}), false);
});
