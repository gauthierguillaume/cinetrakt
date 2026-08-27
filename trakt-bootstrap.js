(() => {
	'use strict';

	const ROOT_CLASS = 'cinetrakt-poster-layout-enabled';
	const settings = globalThis.CineTraktSettings;
	const { canBootstrapStickyLayout, getViewportWidth } = globalThis.CineTraktPosterLayoutUtils;
	let posterLayoutEnabled = true;

	function isPosterDetailRoute() {
		return /^\/(movies|shows)\/[^/]+\/?$/.test(window.location.pathname);
	}

	function isPosterViewportEligible() {
		return canBootstrapStickyLayout(getViewportWidth(
			document.documentElement?.clientWidth,
			window.innerWidth,
			window.visualViewport?.width,
		));
	}

	function applyPosterLayoutSetting(values) {
		const root = document.documentElement;
		if (!root) return;
		posterLayoutEnabled = values?.traktPosterLayout !== false;
		root.classList.toggle(
			ROOT_CLASS,
			posterLayoutEnabled && isPosterDetailRoute() && isPosterViewportEligible(),
		);
	}

	applyPosterLayoutSetting(null);
	settings.ready.then(applyPosterLayoutSetting);
	const unsubscribe = settings.onChange(applyPosterLayoutSetting);

	const syncPosterState = () => applyPosterLayoutSetting({ traktPosterLayout: posterLayoutEnabled });
	window.addEventListener('popstate', syncPosterState);
	window.addEventListener('hashchange', syncPosterState);
	window.addEventListener('resize', syncPosterState, { passive: true });
	window.visualViewport?.addEventListener('resize', syncPosterState, { passive: true });
	globalThis.navigation?.addEventListener('currententrychange', syncPosterState);
	window.addEventListener('pagehide', unsubscribe, { once: true });
})();
