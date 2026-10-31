(() => {
	'use strict';
	const frame = window.frameElement;
	if (window.top === window || frame?.dataset.cinetraktNativeSeasons !== location.pathname
		|| !/^\/shows\/[a-z0-9][a-z0-9-]*\/?$/i.test(location.pathname)) return;

	// Only this isolated native section uses Trakt's small-tablet render guard.
	// The real viewport, CSS card sizes and the main page remain desktop-sized.
	// No APIs or app data are replaced: Trakt mounts its own SeasonPosterList.
	const original = window.matchMedia.bind(window);
	const profiles = new Map([
		['(max-width:480px)', false],
		['(min-width:481px)and(max-width:768px)', true],
		['(min-width:769px)and(max-width:1023px)', false],
		['(min-width:1024px)', false],
	]);
	const queries = new Map();
	window.matchMedia = query => {
		const key = String(query).replace(/\s+/g, '');
		if (!profiles.has(key)) return original(query);
		if (!queries.has(key)) {
			const result = new EventTarget();
			Object.defineProperties(result, {
				matches: { value: profiles.get(key), enumerable: true },
				media: { value: String(query), enumerable: true },
			});
			result.onchange = null;
			result.addListener = listener => result.addEventListener('change', listener);
			result.removeListener = listener => result.removeEventListener('change', listener);
			queries.set(key, result);
		}
		return queries.get(key);
	};
})();
