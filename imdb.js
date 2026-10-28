(() => {
	'use strict';

	const settings = globalThis.CineTraktSettings;
	const traktButton = globalThis.CineTraktImdbTraktButton;
	const ratings = globalThis.CineTraktImdbRatings;
	if (window.top !== window || globalThis.CineTraktImdbPage.isRatingsDataMode()) return;

	function updateFeatures() {
		ratings.initialize();
		traktButton.update();
		ratings.update();
	}

	settings.ready.then(() => {
		globalThis.CineTraktImdbRuntime?.start(updateFeatures);
	});
})();
