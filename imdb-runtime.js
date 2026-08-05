(() => {
	'use strict';

	const runtimeApi = globalThis.CineTraktDomRuntime
		|| (typeof require === 'function' ? require('./dom-runtime.js') : null);
	const OWNED_MARKER = /^(?:cinetrakt|sg)(?:-|$)|^trakt-header-btn$/;

	function createRuntime(environment = globalThis) {
		return runtimeApi.createRuntime({
			environment,
			mutationDelay: 220,
			ownedMarker: OWNED_MARKER,
			name: 'IMDb',
			observeBody: true,
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

	globalThis.CineTraktImdbRuntime = api.createRuntime(globalThis);
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
