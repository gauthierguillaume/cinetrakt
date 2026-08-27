(() => {
	'use strict';

	const stremioUi = globalThis.CineTraktTraktStremioUi;
	const ratings = globalThis.CineTraktTraktRatings;
	const posterLayout = globalThis.CineTraktTraktPosterLayout;
	const soundtrack = globalThis.CineTraktTraktSoundtrack;
	const customizations = globalThis.CineTraktTraktCustomizations;

	function isFeatureEnabled(key) {
		return globalThis.CineTraktSettings?.isEnabled(key) !== false;
	}

	function isDetailPage() {
		return /^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname);
	}

	async function updateFeatures() {
		await globalThis.CineTraktSettings?.ready;
		if (window.location.hostname !== 'app.trakt.tv') return;
		const pageRelevant = stremioUi.isPageRelevant();

		/* L'ouverture Stremio est la fonction principale : elle est initialisée
		   avant les personnalisations visuelles afin qu'une erreur de layout ne
		   puisse jamais désactiver les pochettes ou les titres d'épisodes. */
		if (pageRelevant && isFeatureEnabled('traktStremioLinks')) stremioUi.update();

		posterLayout.setEnabled(isFeatureEnabled('traktPosterLayout') && isDetailPage());
		if (isFeatureEnabled('traktSoundtrack')) soundtrack.update();
		else soundtrack.cleanup({ pause: false });

		customizations.update({
			collectionEnabled: isFeatureEnabled('traktCollectionCard'),
			navigationCleanupEnabled: isFeatureEnabled('traktNavigationCleanup'),
		});

		if (!pageRelevant) return;
		ratings.setColorsEnabled(isFeatureEnabled('traktRatingColors'));
		ratings.setControlsEnabled({
			toggleEnabled: isFeatureEnabled('traktRatingsToggle'),
			popupEnabled: isFeatureEnabled('imdbEpisodeRatingsPopup'),
		});
	}

	if (window.location.hostname !== 'app.trakt.tv') return;

	window.addEventListener('message', soundtrack.handleEmbedMessage);
	window.addEventListener('resize', () => posterLayout.schedule(80), { passive: true });
	window.visualViewport?.addEventListener('resize', () => posterLayout.schedule(80), { passive: true });
	window.addEventListener('pagehide', () => {
		soundtrack.cleanup({ pause: isFeatureEnabled('traktSoundtrack') });
		posterLayout.cleanup();
	}, { once: true });

	globalThis.CineTraktTraktRuntime?.start(updateFeatures);
})();
