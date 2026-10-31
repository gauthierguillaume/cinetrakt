(() => {
	'use strict';
	const settings = globalThis.CineTraktSettings;
	const apply = values => document.documentElement?.classList.toggle(
		'cinetrakt-clear-watched-posters', values?.traktClearWatchedPosters !== false,
	);
	apply(settings.getAll());
	settings.ready.then(apply);
	const unsubscribe = settings.onChange(apply);
	window.addEventListener('pagehide', unsubscribe, { once: true });
})();
