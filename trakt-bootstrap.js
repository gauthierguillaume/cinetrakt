(() => {
	'use strict';

	const ROOT_CLASS = 'cinetrakt-poster-layout-enabled';
	const settings = globalThis.CineTraktSettings;
	let posterLayoutEnabled = true;

	function isPosterDetailRoute() {
		return /^\/(movies|shows)\/[^/]+\/?$/.test(window.location.pathname);
	}

	function applyPosterLayoutSetting(values) {
		const root = document.documentElement;
		if (!root) return;
		posterLayoutEnabled = values?.traktPosterLayout !== false;
		root.classList.toggle(ROOT_CLASS, posterLayoutEnabled && isPosterDetailRoute());
	}

	applyPosterLayoutSetting(null);
	settings.ready.then(applyPosterLayoutSetting);
	const unsubscribe = settings.onChange(applyPosterLayoutSetting);

	const syncPosterRoute = () => applyPosterLayoutSetting({ traktPosterLayout: posterLayoutEnabled });
	window.addEventListener('popstate', syncPosterRoute);
	window.addEventListener('hashchange', syncPosterRoute);
	globalThis.navigation?.addEventListener('currententrychange', syncPosterRoute);
	window.addEventListener('pagehide', unsubscribe, { once: true });
})();
