const test = require('node:test');
const assert = require('node:assert/strict');

const { getRouteKey, isOwnedMutation } = require('../trakt-runtime.js');

function element({ id = '', classes = [] } = {}) {
	return {
		nodeType: 1,
		id,
		classList: classes,
		matches: (selector) => selector.split(', ').some((name) => classes.includes(name.slice(1))),
	};
}

test('getRouteKey includes path, query and hash', () => {
	assert.equal(
		getRouteKey({ pathname: '/shows/silo', search: '?season=3', hash: '#episodes' }),
		'/shows/silo?season=3#episodes',
	);
});

test('styling a native Trakt container does not hide new native cards from the runtime', () => {
	for (const className of ['cinetrakt-sticky-poster-detail-page', 'cinetrakt-sticky-right-section',
		'watch-on-stremio-poster-size-ready', 'watch-on-stremio-summary-poster-sized']) {
		const target = element({ classes: [className] });
		assert.equal(isOwnedMutation({ target, addedNodes: [element({ classes: ['trakt-card'] })], removedNodes: [] }), false);
		assert.equal(isOwnedMutation({ target, addedNodes: [element({ id: 'cinetrakt-official-collection-host' })], removedNodes: [] }), true);
	}
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
