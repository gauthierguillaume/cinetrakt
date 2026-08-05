(() => {
	'use strict';

	const STORAGE_KEY = 'cinetrakt:feature-settings:v1';
	const ROOT_CLASS = 'cinetrakt-poster-layout-enabled';
	let posterLayoutEnabled = true;

	function isPosterDetailRoute() {
		return /^\/(movies|shows)\/[^/]+\/?$/.test(window.location.pathname);
	}

	function applyPosterLayoutSetting(settings) {
		const root = document.documentElement;
		if (!root) return;
		posterLayoutEnabled = settings?.traktPosterLayout !== false;
		root.classList.toggle(ROOT_CLASS, posterLayoutEnabled && isPosterDetailRoute());
	}

	applyPosterLayoutSetting(null);

	chrome.storage.local.get(STORAGE_KEY, (result) => {
		applyPosterLayoutSetting(result?.[STORAGE_KEY]);
	});

	chrome.storage.onChanged.addListener((changes, areaName) => {
		if (areaName !== 'local' || !changes[STORAGE_KEY]) return;
		applyPosterLayoutSetting(changes[STORAGE_KEY].newValue);
	});

	const syncPosterRoute = () => applyPosterLayoutSetting({ traktPosterLayout: posterLayoutEnabled });
	window.addEventListener('popstate', syncPosterRoute);
	window.addEventListener('hashchange', syncPosterRoute);
	globalThis.navigation?.addEventListener('currententrychange', syncPosterRoute);
})();
