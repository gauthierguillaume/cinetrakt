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
		globalThis.CineTraktHorizontalScroll?.sync();
		globalThis.CineTraktImdbPanel?.sync(isFeatureEnabled('imdbEpisodeRatingsPopup'));
		ratings.setControlsEnabled({
			toggleEnabled: isFeatureEnabled('traktRatingsToggle'),
			popupEnabled: isFeatureEnabled('imdbEpisodeRatingsPopup'),
		});
		const pageRelevant = stremioUi.isPageRelevant();

		/* L'ouverture Stremio est la fonction principale : elle est initialisée
		   avant les personnalisations visuelles afin qu'une erreur de layout ne
		   puisse jamais désactiver les pochettes ou les titres d'épisodes. */
		if (pageRelevant && isFeatureEnabled('traktStremioLinks')) stremioUi.update();

		globalThis.CineTraktTraktFanart?.update(isFeatureEnabled('traktPosterLayout') && isDetailPage());
		posterLayout.setEnabled(isFeatureEnabled('traktPosterLayout') && isDetailPage());
		globalThis.CineTraktSeasonSelector?.update(isFeatureEnabled('traktSeasonPosters'));
		if (isFeatureEnabled('traktSoundtrack')) soundtrack.update();
		else soundtrack.cleanup({ pause: false });
		customizations.update({
			collectionEnabled: isFeatureEnabled('traktCollectionCard'),
			navigationCleanupEnabled: isFeatureEnabled('traktNavigationCleanup'),
			hideReactionsEnabled: isFeatureEnabled('traktHideReactions'),
		});
		ratings.setColorsEnabled(isFeatureEnabled('traktRatingColors'));
	}

	if (window.location.hostname !== 'app.trakt.tv') return;

	let lastPointerNotice = 0;
	const notifyPointerReturn = () => {
		const at = Date.now();
		if (at - lastPointerNotice < 150 || !isFeatureEnabled('stremioCompactPanel')) return;
		lastPointerNotice = at;
		try {
			chrome.runtime.sendMessage({
				type: globalThis.CineTraktExtensionProtocol.MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER,
				at,
			}, () => { void chrome.runtime.lastError; });
		} catch { /* Extension may have been reloaded while this page remains open. */ }
	};
	document.addEventListener('pointermove', notifyPointerReturn, { passive: true });
	document.addEventListener('pointerover', notifyPointerReturn, { passive: true });

	window.addEventListener('message', soundtrack.handleEmbedMessage);
	window.addEventListener('resize', () => posterLayout.schedule(80), { passive: true });
	window.visualViewport?.addEventListener('resize', () => posterLayout.schedule(80), { passive: true });
	window.addEventListener('pagehide', () => {
		document.removeEventListener('pointermove', notifyPointerReturn);
		document.removeEventListener('pointerover', notifyPointerReturn);
		soundtrack.cleanup({ pause: isFeatureEnabled('traktSoundtrack') });
		posterLayout.cleanup();
		globalThis.CineTraktTraktFanart?.cleanup();
		globalThis.CineTraktImdbPanel?.cleanup();
		globalThis.CineTraktSeasonSelector?.cleanup();
	}, { once: true });

	globalThis.CineTraktTraktRuntime?.start(updateFeatures);
})();
