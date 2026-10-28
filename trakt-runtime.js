(() => {
	'use strict';

	const runtimeApi = globalThis.CineTraktDomRuntime
		|| (typeof require === 'function' ? require('./dom-runtime.js') : null);
	const OWNED_MARKER = /^(?:cinetrakt|watch-on-stremio)(?:-|$)/;
	const NATIVE_CONTAINERS = '.cinetrakt-sticky-poster-detail-page, .cinetrakt-sticky-right-section, '
		+ '.watch-on-stremio-poster-size-ready, .watch-on-stremio-summary-poster-sized';

	function createRuntime(environment = globalThis) {
		return runtimeApi.createRuntime({
			environment,
			mutationDelay: 180,
			immediateMutationSelector: '.trakt-summary-container, .trakt-summary-poster-container, .trakt-summary-ratings',
			ownedMarker: OWNED_MARKER,
			nativeContainerSelector: NATIVE_CONTAINERS,
			name: 'Trakt',
			subscribeToSettings: true,
		});
	}

	function isOwnedMutation(mutation) {
		return runtimeApi.isOwnedMutation(mutation, OWNED_MARKER, NATIVE_CONTAINERS);
	}

	const api = Object.freeze({
		createRuntime,
		getRouteKey: runtimeApi.getRouteKey,
		isOwnedMutation,
	});

	globalThis.CineTraktTraktRuntime = api.createRuntime(globalThis);
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
