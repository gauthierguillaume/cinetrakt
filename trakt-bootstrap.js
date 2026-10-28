(() => {
	'use strict';

	const ROOT_CLASS = 'cinetrakt-poster-layout-enabled';
	const settings = globalThis.CineTraktSettings;
	const { canBootstrapStickyLayout, getViewportWidth } = globalThis.CineTraktPosterLayoutUtils;
	let posterLayoutEnabled = true;
	let ratingsEnabled = true;
	let ratingsRoute = '';
	let ratingsRevealTimer = null;

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
		ratingsEnabled = values?.traktRatingsToggle !== false;
		root.classList.toggle(
			ROOT_CLASS,
			posterLayoutEnabled && isPosterDetailRoute() && isPosterViewportEligible(),
		);
		const prepareRatings = ratingsEnabled && isPosterDetailRoute();
		root.classList.toggle('cinetrakt-rating-cards-enabled', prepareRatings);
		const route = prepareRatings ? window.location.pathname : '';
		if (route !== ratingsRoute) {
			ratingsRoute = route;
			window.clearTimeout(ratingsRevealTimer);
			root.classList.toggle('cinetrakt-ratings-pending', Boolean(route));
			// Fail open even if the worker or a later content script is unavailable.
			if (route) ratingsRevealTimer = window.setTimeout(() => {
				root.classList.remove('cinetrakt-ratings-pending');
			}, 4000);
		}
	}

	applyPosterLayoutSetting(null);
	settings.ready.then(applyPosterLayoutSetting);
	const unsubscribe = settings.onChange(applyPosterLayoutSetting);

	const syncPosterState = () => applyPosterLayoutSetting({ traktPosterLayout: posterLayoutEnabled, traktRatingsToggle: ratingsEnabled });
	window.addEventListener('popstate', syncPosterState);
	window.addEventListener('hashchange', syncPosterState);
	window.addEventListener('resize', syncPosterState, { passive: true });
	window.visualViewport?.addEventListener('resize', syncPosterState, { passive: true });
	globalThis.navigation?.addEventListener('currententrychange', syncPosterState);
	window.addEventListener('pagehide', unsubscribe, { once: true });
	window.addEventListener('pagehide', () => window.clearTimeout(ratingsRevealTimer), { once: true });
})();
