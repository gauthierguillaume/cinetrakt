(() => {
	'use strict';

	const runtimeApi = globalThis.CineTraktDomRuntime
		|| (typeof require === 'function' ? require('./dom-runtime.js') : null);
	const OWNED_MARKER = /^(?:cinetrakt|watch-on-stremio)(?:-|$)/;

	function createRuntime(environment = globalThis) {
		return runtimeApi.createRuntime({
			environment,
			mutationDelay: 180,
			ownedMarker: OWNED_MARKER,
			name: 'Trakt',
			subscribeToSettings: true,
		});
	}

	function isOwnedMutation(mutation) {
		return runtimeApi.isOwnedMutation(mutation, OWNED_MARKER);
	}

	const api = Object.freeze({
		createRuntime,
		getRouteKey: runtimeApi.getRouteKey,
		isOwnedMutation,
	});

	globalThis.CineTraktTraktRuntime = api.createRuntime(globalThis);
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
