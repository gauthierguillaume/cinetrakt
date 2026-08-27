(() => {
	'use strict';
	const CINETRAKT_STICKY_POSTER_RAIL_ID = 'cinetrakt-sticky-poster-rail';
	const CINETRAKT_POSTER_TOP_REDUCTION = 24;
	const CINETRAKT_POSTER_BOTTOM_SAFETY = 12;
	const CINETRAKT_POSTER_SIDE_GAP = 16;
	const CINETRAKT_CONTEXTUAL_PAIR_GAP = 16;
	const {
		canUseStickyLayout,
		getRightListInnerWidth,
		getViewportWidth,
	} = globalThis.CineTraktPosterLayoutUtils;
	let cinetraktStickyPosterState = null;
	let cinetraktStickyPosterResizeTimer = null;
	let cinetraktPosterLayoutRequested = false;

function injectWatchOnStremioPosterSizeStyles() {
	if (document.getElementById('watch-on-stremio-poster-size-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-poster-size-styles';
	style.textContent = `
		/* Colonne fixe CineTrakt : commandes et affiche restent visibles pendant que
		   le résumé et les sections suivantes défilent dans la partie droite. */
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.trakt-summary-container.watch-on-stremio-poster-size-ready,
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
			grid-template-columns:
				minmax(0, 1fr)
				var(--ni-480) !important;
			width: 100% !important;
			max-width: 100% !important;
			margin-left: 0 !important;
			align-items: start !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.trakt-summary-container.watch-on-stremio-poster-size-ready.cinetrakt-contextual-pair-ready,
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready.cinetrakt-contextual-pair-ready {
			grid-template-columns:
				minmax(0, 1fr)
				calc(var(--ni-320) + var(--ni-480) + var(--gap-m, 16px)) !important;
		}

		html.cinetrakt-poster-layout-enabled,
		html.cinetrakt-poster-layout-enabled body {
			max-width: 100% !important;
			/* hidden creates a vertical scroll container as a side effect when
			   overflow-y is visible. Trakt then caps that container when a drawer
			   opens, leaving the detail page with only a few pixels of scroll. */
			overflow-x: clip !important;
		}

		main.cinetrakt-sticky-poster-detail-page {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			main.cinetrakt-sticky-poster-detail-page {
			padding-left: var(--watch-on-stremio-sticky-content-left) !important;
			padding-right: 12px !important;
		}

		main.cinetrakt-sticky-poster-detail-page > * {
			box-sizing: border-box !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		#${CINETRAKT_STICKY_POSTER_RAIL_ID} {
			box-sizing: border-box !important;
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			gap: 8px !important;
			z-index: 20 !important;
			pointer-events: none !important;
		}

		#${CINETRAKT_STICKY_POSTER_RAIL_ID} > * {
			pointer-events: auto !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			#${CINETRAKT_STICKY_POSTER_RAIL_ID} {
			position: fixed !important;
			left: var(--watch-on-stremio-sticky-poster-left) !important;
			top: var(--watch-on-stremio-sticky-poster-top) !important;
			width: var(--watch-on-stremio-summary-poster-width) !important;
		}

		html.cinetrakt-poster-layout-compact #${CINETRAKT_STICKY_POSTER_RAIL_ID} {
			position: relative !important;
			inset: auto !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
			align-self: start !important;
			z-index: 1 !important;
		}

		.cinetrakt-sticky-poster-stage {
			box-sizing: border-box !important;
			position: relative !important;
			min-height: 0 !important;
			max-height: none !important;
			margin-bottom: var(--cinetrakt-poster-decoration-overflow, 0px) !important;
			isolation: isolate !important;
			overflow: visible !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.cinetrakt-sticky-poster-stage {
			width: var(--watch-on-stremio-summary-poster-width) !important;
			max-width: var(--watch-on-stremio-summary-poster-width) !important;
			height: var(--watch-on-stremio-summary-poster-height) !important;
		}

		html.cinetrakt-poster-layout-compact .cinetrakt-sticky-poster-stage {
			width: 100% !important;
			max-width: 100% !important;
			height: auto !important;
			aspect-ratio: var(--cinetrakt-poster-aspect-ratio) !important;
		}

		.cinetrakt-sticky-poster-stage[data-cinetrakt-stremio-target="true"] {
			cursor: pointer !important;
			border-radius: var(--cinetrakt-poster-border-radius, 8px) !important;
		}

		.cinetrakt-sticky-poster-stage[data-cinetrakt-stremio-target="true"]:focus-visible {
			outline: 2px solid rgba(177, 66, 211, 0.9) !important;
			outline-offset: 3px !important;
		}

		/* Le composant Trakt reste l'unique poster affiché. Son survol ne modifie
		   ni l'image ni sa géométrie ; seul le curseur indique qu'il est cliquable. */
		html.cinetrakt-poster-layout-enabled
			.watch-on-stremio-summary-poster-sized
			.trakt-summary-poster.has-active-overlay:hover img {
			border: 0 solid transparent !important;
			filter: none !important;
		}

		.cinetrakt-sticky-poster-controls {
			box-sizing: border-box !important;
			position: static !important;
			inset: auto !important;
			width: 100% !important;
			max-width: 100% !important;
			margin: 0 !important;
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			justify-content: center !important;
			gap: 6px !important;
		}

		/* La barre d'actions est placée sous l'affiche. Son menu contextuel doit
		   donc se déployer au-dessus, sans recouvrir ce qui suit dans la page. */
		.cinetrakt-sticky-poster-controls
			.trakt-summary-actions-bar:has(.trakt-media-actions-popup-button.is-opened) {
			border-start-start-radius: 0 !important;
			border-start-end-radius: 0 !important;
			border-end-start-radius: var(--border-radius-l) !important;
			border-end-end-radius: var(--border-radius-l) !important;
		}

		.cinetrakt-sticky-poster-controls .trakt-summary-actions-slider {
			top: auto !important;
			bottom: 100% !important;
			clip-path: inset(-100vmax -100vmax 0 -100vmax) !important;
			border-start-start-radius: var(--border-radius-l) !important;
			border-start-end-radius: var(--border-radius-l) !important;
			border-end-start-radius: 0 !important;
			border-end-end-radius: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized {
			box-sizing: border-box !important;
			position: absolute !important;
			inset: 0 !important;
			z-index: 1 !important;
			--summary-poster-width: var(--watch-on-stremio-summary-poster-width) !important;
			width: 100% !important;
			max-width: 100% !important;
			height: 100% !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			overflow: visible !important;
		}

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster-container,
		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster,
		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster > a {
			width: 100% !important;
			max-width: 100% !important;
			height: 100% !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			overflow: visible !important;
		}

		/* CineTrakt remplace seulement l'interaction de la jaquette. Le panneau
		   promotionnel natif (service + bouton lecture) reste hors de cette vue. */
		html.cinetrakt-poster-layout-enabled
			.watch-on-stremio-summary-poster-sized
			.trakt-summary-poster-overlay {
			display: none !important;
		}

		html.cinetrakt-poster-layout-enabled
			.watch-on-stremio-summary-poster-sized
			.trakt-summary-poster > a {
			pointer-events: none !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready .trakt-summary-content,
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready [class*="trakt-summary-content"] {
			grid-column: 1 !important;
			width: auto !important;
			min-width: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready .trakt-summary-contextual-content,
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready [class*="trakt-summary-contextual-content"] {
			grid-column: 2 !important;
			width: var(--ni-480) !important;
			max-width: var(--ni-480) !important;
			min-width: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready.cinetrakt-contextual-pair-ready
			.trakt-summary-contextual-content,
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.watch-on-stremio-poster-size-ready.cinetrakt-contextual-pair-ready
			[class*="trakt-summary-contextual-content"] {
			width: calc(var(--ni-320) + var(--ni-480) + var(--gap-m, 16px)) !important;
			max-width: calc(var(--ni-320) + var(--ni-480) + var(--gap-m, 16px)) !important;
		}

		.cinetrakt-sentiment-trivia-row {
			box-sizing: border-box !important;
			display: grid !important;
			grid-template-columns: var(--ni-320) var(--ni-480) !important;
			align-items: start !important;
			gap: var(--gap-m, 16px) !important;
			width: calc(var(--ni-320) + var(--ni-480) + var(--gap-m, 16px)) !important;
			max-width: none !important;
			min-width: calc(var(--ni-320) + var(--ni-480) + var(--gap-m, 16px)) !important;
			margin-top: var(--gap-m, 16px) !important;
			padding: 0 !important;
		}

		.cinetrakt-sentiment-trivia-row > .cinetrakt-summary-sentiment {
			box-sizing: border-box !important;
			width: var(--ni-320) !important;
			max-width: var(--ni-320) !important;
			min-width: var(--ni-320) !important;
			margin: 0 !important;
			padding-inline: 0 !important;
		}

		.cinetrakt-sentiment-trivia-row > .cinetrakt-summary-trivia {
			box-sizing: border-box !important;
			width: var(--ni-480) !important;
			max-width: var(--ni-480) !important;
			min-width: var(--ni-480) !important;
			margin: 8px 0 0 !important;
			padding-inline: 0 !important;
		}

		.cinetrakt-summary-trivia {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
			margin-top: var(--gap-m, 16px) !important;
			padding-inline: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			main.cinetrakt-sticky-poster-detail-page .cinetrakt-sticky-right-section {
			box-sizing: border-box !important;
			margin: 0 0 0 -24px !important;
			width: calc(100% + 24px) !important;
			max-width: calc(100% + 24px) !important;
			min-width: 0 !important;
		}

		/* Le padding gauche natif réaligne le contenu après le décalage de la
		   section. Le bord droit n'en reprend pas un second : toutes les listes
		   terminent ainsi sur la même marge que le résumé, sans carte tronquée. */
		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.cinetrakt-sticky-right-section .section-list-horizontal-scroll {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			padding-inline-end: 0 !important;
		}

		html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact)
			.cinetrakt-sticky-right-footer {
			box-sizing: border-box !important;
			margin-left: var(--watch-on-stremio-sticky-content-left) !important;
			width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 12px) !important;
			max-width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 12px) !important;
			min-width: 0 !important;
			padding-left: 48px !important;
			padding-right: 12px !important;
		}

		.cinetrakt-sticky-right-footer .trakt-footer-content,
		.cinetrakt-sticky-right-footer .trakt-footer-grid {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

	`;
	document.head.appendChild(style);
}

function findCinetraktStickyPosterControls(summaryContainer) {
	const mainContent = summaryContainer.querySelector('.trakt-summary-main-content');
	if (!mainContent) return null;

	const actionsBar = summaryContainer.querySelector('.trakt-summary-actions-bar');
	if (actionsBar) {
		const actionsGroup = actionsBar.closest('.trakt-summary-actions');
		return actionsGroup
			&& actionsGroup !== summaryContainer
			&& summaryContainer.contains(actionsGroup)
			? actionsGroup
			: actionsBar;
	}

	// Compatibilité avec une ancienne structure Trakt dépourvue de barre nommée.
	const rateNow = summaryContainer.querySelector('.trakt-rate-now, [class*="trakt-rate-now"]');
	if (!rateNow) return null;

	for (let candidate = rateNow.parentElement;
		candidate && candidate !== mainContent;
		candidate = candidate.parentElement) {
		const rect = candidate.getBoundingClientRect();
		const hasSeparateAction = [...candidate.querySelectorAll('button, a, [role="button"]')]
			.some((element) => !rateNow.contains(element));
		if (hasSeparateAction && rect.height > 0 && rect.height <= 220) return candidate;
	}

	return rateNow;
}

function moveCinetraktElementWithPlaceholder(element, placeholderText) {
	if (!element?.parentNode) return null;
	const placeholder = document.createComment(placeholderText);
	const parent = element.parentNode;
	parent.insertBefore(placeholder, element);
	return { element, parent, placeholder };
}

function restoreCinetraktMovedElement(entry) {
	if (!entry?.element) return;
	if (entry.placeholder?.parentNode) {
		entry.placeholder.parentNode.insertBefore(entry.element, entry.placeholder);
		entry.placeholder.remove();
	} else if (entry.parent?.isConnected) {
		entry.parent.appendChild(entry.element);
	}
}

function attachCinetraktStickyPosterControls(state) {
	const attachedControls = state.controlsEntry?.element;
	if (attachedControls?.isConnected) {
		attachedControls.classList.add('cinetrakt-sticky-poster-controls');
		if (!state.rail.contains(attachedControls)) {
			state.rail.appendChild(attachedControls);
		}
		return;
	}
	if (state.controlsEntry) {
		state.controlsEntry.placeholder?.remove();
		state.controlsEntry = null;
	}

	const controls = findCinetraktStickyPosterControls(state.summaryContainer);
	if (!controls || state.rail.contains(controls)) return;

	state.controlsEntry = moveCinetraktElementWithPlaceholder(
		controls,
		'CineTrakt sticky poster controls position',
	);
	controls.classList.add('cinetrakt-sticky-poster-controls');
	state.rail.appendChild(controls);
}

function findCinetraktSectionByTitle(root, labels) {
	if (!root) return null;
	const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()));
	const title = [...root.querySelectorAll(
		'h1, h2, h3, h4, .trakt-list-title, .trakt-list-inset-title, [class*="section-title"]',
	)].find((candidate) => normalizedLabels.has(candidate.textContent?.trim().toLowerCase()));
	if (!title) return null;

	const section = title.closest('section');
	if (section && root.contains(section)) return section;

	let container = title;
	while (container.parentElement && container.parentElement !== root) {
		container = container.parentElement;
	}
	return container !== title ? container : title.parentElement;
}

function unwrapCinetraktSentimentTriviaRow(state) {
	const row = state.sentimentTriviaRow;
	if (!row) {
		state.summaryContainer.classList.remove('cinetrakt-contextual-pair-ready');
		return;
	}

	const sentimentSection = state.sentimentSection;
	const triviaSection = state.triviaEntry?.element;
	const parent = row.parentNode;
	if (parent) {
		if (sentimentSection && row.contains(sentimentSection)) {
			parent.insertBefore(sentimentSection, row);
		}
		if (triviaSection && row.contains(triviaSection)) {
			parent.insertBefore(triviaSection, row);
		}
	}

	sentimentSection?.classList.remove('cinetrakt-summary-sentiment');
	row.remove();
	state.sentimentTriviaRow = null;
	state.sentimentSection = null;
	state.summaryContainer.classList.remove('cinetrakt-contextual-pair-ready');
}

function canPlaceCinetraktTriviaBesideSentiment(state, contextualContent, sentimentSection) {
	const contextualWidth = contextualContent.getBoundingClientRect().width;
	if (!state.contextualCardWidth && contextualWidth > 0) {
		state.contextualCardWidth = contextualWidth;
	}
	const cardWidth = state.contextualCardWidth;
	const sentimentWidth = sentimentSection.getBoundingClientRect().width;
	const summaryWidth = state.summaryContainer.getBoundingClientRect().width;
	if (!cardWidth || !sentimentWidth || !summaryWidth) return false;

	// Chaque carte conserve sa largeur native actuelle. Une largeur complète de
	// Trivia reste également réservée au résumé principal pour éviter tout écrasement.
	const minimumWidth = sentimentWidth
		+ (cardWidth * 2)
		+ (CINETRAKT_CONTEXTUAL_PAIR_GAP * 2);
	return summaryWidth >= minimumWidth;
}

function attachCinetraktTriviaBesideSentiment(state) {
	const contextualContent = state.summaryContainer.querySelector(
		'.trakt-summary-contextual-content, [class*="trakt-summary-contextual-content"]',
	);
	const sentimentSection = findCinetraktSectionByTitle(contextualContent, ['sentiment']);
	if (!contextualContent || !sentimentSection?.parentNode) return;

	let triviaSection = state.triviaEntry?.element;
	if (triviaSection && !triviaSection.isConnected) {
		state.triviaEntry.placeholder?.remove();
		state.triviaEntry = null;
		triviaSection = null;
	}
	if (!triviaSection) {
		triviaSection = findCinetraktSectionByTitle(state.mainContent, ['trivia', 'anecdotes']);
		if (!triviaSection || contextualContent.contains(triviaSection)) return;
		state.triviaEntry = moveCinetraktElementWithPlaceholder(
			triviaSection,
			'CineTrakt original Trivia position',
		);
	}

	triviaSection.classList.remove('cinetrakt-sticky-right-section');
	state.sectionElements?.delete(triviaSection);
	triviaSection.classList.add('cinetrakt-summary-trivia');

	if (!canPlaceCinetraktTriviaBesideSentiment(state, contextualContent, sentimentSection)) {
		unwrapCinetraktSentimentTriviaRow(state);
		if (sentimentSection.nextElementSibling !== triviaSection) {
			sentimentSection.insertAdjacentElement('afterend', triviaSection);
		}
		return;
	}

	let row = state.sentimentTriviaRow;
	if (!row?.isConnected) {
		row?.remove();
		row = document.createElement('div');
		row.className = 'cinetrakt-sentiment-trivia-row';
		sentimentSection.parentNode.insertBefore(row, sentimentSection);
		state.sentimentTriviaRow = row;
	}
	state.sentimentSection = sentimentSection;
	sentimentSection.classList.add('cinetrakt-summary-sentiment');
	row.append(sentimentSection, triviaSection);
	state.summaryContainer.classList.add('cinetrakt-contextual-pair-ready');
}

function restoreCinetraktTriviaToNativeFlow(state) {
	unwrapCinetraktSentimentTriviaRow(state);
	const triviaSection = state.triviaEntry?.element;
	if (!triviaSection) return;

	triviaSection.classList.remove('cinetrakt-summary-trivia');
	restoreCinetraktMovedElement(state.triviaEntry);
	state.triviaEntry = null;
	if (triviaSection.isConnected) {
		triviaSection.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements?.add(triviaSection);
	}
}

function hasCinetraktVisibleBorderRadius(value) {
	return String(value || '')
		.split(/[\s/]+/)
		.some((token) => Number.parseFloat(token) > 0);
}

function getCinetraktPosterBorderRadius(sourceImage, posterContainer) {
	for (let element = sourceImage; element; element = element.parentElement) {
		const borderRadius = getComputedStyle(element).borderRadius;
		if (hasCinetraktVisibleBorderRadius(borderRadius)) return borderRadius;
		if (element === posterContainer) break;
	}
	return '8px';
}

function syncCinetraktPosterBorderRadius(state) {
	const borderRadius = getCinetraktPosterBorderRadius(
		state.posterImage,
		state.posterContainer,
	);
	state.posterStage.style.setProperty('--cinetrakt-poster-border-radius', borderRadius);
}

function markCinetraktResponsiveRightContent(state) {
	state.sectionElements ||= new Set();
	state.mainContent.querySelectorAll('section.section-list-container').forEach((section) => {
		if (section.closest('.trakt-summary-container')) return;
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});
	state.mainContent.querySelectorAll('section.trakt-soundtrack-section').forEach((section) => {
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});

	const specialSectionTitles = new Set(['soundtrack', 'bande originale', 'trivia', 'anecdotes']);
	state.mainContent.querySelectorAll(
		'h1, h2, h3, h4, .trakt-list-title, .trakt-list-inset-title, [class*="section-title"]',
	).forEach((title) => {
		if (!specialSectionTitles.has(title.textContent?.trim().toLowerCase())) return;
		const titleRect = title.getBoundingClientRect();
		let section = title.closest('section');
		for (let element = title.parentElement;
			!section && element && element !== state.mainContent;
			element = element.parentElement) {
			const rect = element.getBoundingClientRect();
			const inset = titleRect.left - rect.left;
			if (rect.width > 0 && inset >= 20 && inset <= 28) section = element;
		}
		if (!section || section.closest('.trakt-summary-container')) return;
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});
	const footer = document.querySelector('footer.trakt-footer, [role="contentinfo"]');
	if (footer) {
		state.footer = footer;
		footer.classList.add('cinetrakt-sticky-right-footer');
	}
}

function scheduleCinetraktStickyPosterLayoutUpdate(delay = 80) {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = window.setTimeout(() => {
		cinetraktStickyPosterResizeTimer = null;
		reconcileCinetraktStickyPosterLayout();
	}, delay);
}

function applyCinetraktStickyPosterDimensions(state, width, height) {
	const {
		summaryContainer,
		posterContainer,
		posterStage,
		mainContent,
		summaryLeft,
		posterSideGap,
	} = state;
	const contentLeft = summaryLeft + width + posterSideGap;
	const listInnerWidth = getRightListInnerWidth(getCinetraktViewportWidth(), contentLeft);

	document.documentElement.style.setProperty('--list-inner-width', `${listInnerWidth}px`, 'important');
	summaryContainer.style.setProperty('--summary-poster-width', `${width}px`, 'important');
	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	posterContainer.style.setProperty('--summary-poster-width', `${width}px`, 'important');
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	posterStage.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	posterStage.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	mainContent.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
	state.footer?.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
}

function clearCinetraktStickyPosterDimensions(state) {
	window.cancelAnimationFrame(state.boundsCorrectionFrame);
	state.boundsCorrectionFrame = null;
	document.documentElement.style.removeProperty('--list-inner-width');
	state.mainContent.style.removeProperty('--watch-on-stremio-sticky-content-left');
	state.footer?.style.removeProperty('--watch-on-stremio-sticky-content-left');

	for (const element of [state.summaryContainer, state.posterContainer, state.posterStage]) {
		for (const property of [
			'--summary-poster-width',
			'--watch-on-stremio-summary-poster-width',
			'--watch-on-stremio-summary-poster-height',
			'--watch-on-stremio-sticky-poster-left',
			'--watch-on-stremio-sticky-poster-top',
		]) {
			element.style.removeProperty(property);
		}
	}
}

function setCinetraktPosterLayoutMode(state, useStickyLayout) {
	const compact = !useStickyLayout;
	document.documentElement.classList.toggle('cinetrakt-poster-layout-compact', compact);
	state.summaryContainer.classList.toggle('cinetrakt-poster-layout-compact', compact);
	state.posterStage.style.setProperty(
		'--cinetrakt-poster-aspect-ratio',
		String(state.posterAspectRatio),
	);
	if (compact) clearCinetraktStickyPosterDimensions(state);
}

function getCinetraktVisibleViewportBottom() {
	if (window.visualViewport) {
		return window.visualViewport.offsetTop + window.visualViewport.height;
	}
	return Math.min(
		document.documentElement.clientHeight || Number.POSITIVE_INFINITY,
		window.innerHeight || Number.POSITIVE_INFINITY,
	);
}

function syncCinetraktPosterDecorationOverflow(state) {
	const posterRect = state.posterContainer.getBoundingClientRect();
	let decorationOverflow = 0;
	state.posterContainer.querySelectorAll('*').forEach((element) => {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return;
		decorationOverflow = Math.max(decorationOverflow, rect.bottom - posterRect.bottom);
	});
	state.posterDecorationOverflow = Math.max(0, decorationOverflow);
	state.posterStage.style.setProperty(
		'--cinetrakt-poster-decoration-overflow',
		`${Math.ceil(state.posterDecorationOverflow)}px`,
	);
	return state.posterDecorationOverflow;
}

function getCinetraktViewportWidth() {
	return getViewportWidth(
		document.documentElement.clientWidth,
		window.innerWidth,
		window.visualViewport?.width,
	);
}

function getCinetraktStickyPosterMetrics({
	summaryContainer,
	posterImage,
	posterAspectRatio,
	posterTop,
	posterDecorationOverflow = 0,
	posterFooterHeight = 0,
	summaryLeftFallback = 0,
}) {
	const viewportHeights = [
		document.documentElement.clientHeight,
		window.innerHeight,
		window.visualViewport?.height,
	].filter((value) => Number.isFinite(value) && value > 0);
	const viewportHeight = Math.floor(viewportHeights.length
		? Math.min(...viewportHeights)
		: window.innerHeight);
	const naturalImageRatio = posterImage.naturalWidth / posterImage.naturalHeight;
	const imageRatio = Number.isFinite(posterAspectRatio) && posterAspectRatio > 0
		? posterAspectRatio
		: naturalImageRatio;
	const sidebarRect = document.querySelector('.trakt-side-navbar')?.getBoundingClientRect();
	const soundtrackCardRect = document.querySelector(
		'.cinetrakt-soundtrack-card:not([hidden])',
	)?.getBoundingClientRect();
	const sidebarVisualRight = soundtrackCardRect?.width > 0
		? soundtrackCardRect.right
		: sidebarRect?.right;
	const summaryLeft = Number.isFinite(sidebarVisualRight) && sidebarVisualRight > 0
		? Math.max(0, Math.round(sidebarVisualRight + CINETRAKT_POSTER_SIDE_GAP))
		: summaryLeftFallback;
	const resolvedPosterTop = Math.max(0, posterTop);
	const posterBottomSafety = CINETRAKT_POSTER_BOTTOM_SAFETY;
	const availableHeight = Math.max(
		1,
		viewportHeight
			- resolvedPosterTop
			- posterBottomSafety
			- posterDecorationOverflow
			- posterFooterHeight,
	);
	const height = Math.floor(availableHeight);
	const width = Math.max(1, Math.floor(height * imageRatio));
	const contentLeft = summaryLeft + width + CINETRAKT_POSTER_SIDE_GAP;

	return {
		contentLeft,
		height,
		imageRatio,
		posterBottomSafety,
		posterSideGap: CINETRAKT_POSTER_SIDE_GAP,
		posterTop: resolvedPosterTop,
		summaryLeft,
		viewportWidth: getCinetraktViewportWidth(),
		width,
	};
}

function scheduleCinetraktStickyPosterBoundsCorrection(state, imageRatio, bottomSafety) {
	window.cancelAnimationFrame(state.boundsCorrectionFrame);
	state.boundsCorrectionFrame = window.requestAnimationFrame(() => {
		state.boundsCorrectionFrame = null;
		if (state !== cinetraktStickyPosterState || !state.posterContainer.isConnected) return;

		const posterRect = state.posterContainer.getBoundingClientRect();
		syncCinetraktPosterDecorationOverflow(state);
		const targetPosterBottom = getCinetraktVisibleViewportBottom()
			- bottomSafety
			- state.posterDecorationOverflow;
		const correctedHeight = Math.floor(targetPosterBottom - posterRect.top);
		if (correctedHeight <= 0 || Math.abs(correctedHeight - posterRect.height) < 0.5) return;

		const correctedWidth = Math.max(1, Math.floor(correctedHeight * imageRatio));
		applyCinetraktStickyPosterDimensions(state, correctedWidth, correctedHeight);
	});
}

function updateCinetraktStickyPosterLayout(state) {
	const { summaryContainer, posterContainer, posterStage, rail } = state;
	if (!summaryContainer.isConnected
		|| !posterContainer.isConnected
		|| !posterStage.isConnected
		|| !rail.isConnected) return;

	attachCinetraktStickyPosterControls(state);
	markCinetraktResponsiveRightContent(state);
	const livePosterImage = state.posterContainer.querySelector('img');
	if (livePosterImage) {
		state.posterImage = livePosterImage;
	}
	syncCinetraktPosterBorderRadius(state);
	syncCinetraktPosterDecorationOverflow(state);
	const posterImage = state.posterImage;
	if (!posterImage?.complete || !posterImage.naturalWidth || !posterImage.naturalHeight) {
		const pendingSource = posterImage?.currentSrc || posterImage?.src || window.location.pathname;
		if (posterImage && posterImage.dataset.watchOnStremioPosterLoadSource !== pendingSource) {
			posterImage.dataset.watchOnStremioPosterLoadSource = pendingSource;
			posterImage.addEventListener('load', () => scheduleCinetraktStickyPosterLayoutUpdate(0), { once: true });
		}
		return;
	}

	const controlsHeight = state.controlsEntry?.element?.getBoundingClientRect().height || 0;
	const controlsGap = controlsHeight > 0 ? 8 : 0;
	const metrics = getCinetraktStickyPosterMetrics({
		summaryContainer,
		posterImage,
		posterAspectRatio: state.posterAspectRatio,
		posterTop: state.posterTop,
		posterDecorationOverflow: state.posterDecorationOverflow,
		posterFooterHeight: controlsHeight + controlsGap,
		summaryLeftFallback: state.summaryLeft,
	});
	const useStickyLayout = canUseStickyLayout(metrics.viewportWidth, metrics.contentLeft);
	setCinetraktPosterLayoutMode(state, useStickyLayout);
	if (!useStickyLayout) {
		restoreCinetraktTriviaToNativeFlow(state);
		return;
	}
	attachCinetraktTriviaBesideSentiment(state);

	state.summaryLeft = metrics.summaryLeft;
	state.posterTop = metrics.posterTop;
	state.posterSideGap = metrics.posterSideGap;
	const railTop = Math.max(8, metrics.posterTop);

	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-left', `${metrics.summaryLeft}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-top', `${railTop}px`);
	applyCinetraktStickyPosterDimensions(state, metrics.width, metrics.height);
	scheduleCinetraktStickyPosterBoundsCorrection(
		state,
		metrics.imageRatio,
		metrics.posterBottomSafety + controlsHeight + controlsGap,
	);
}

function isCinetraktPosterDetailRoute() {
	return window.location.hostname === 'app.trakt.tv'
		&& /^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname);
}

function reconcileCinetraktStickyPosterLayout() {
	if (!cinetraktPosterLayoutRequested
		|| !isCinetraktPosterDetailRoute()) {
		cleanupWatchOnStremioPosterSize();
		return;
	}

	setupWatchOnStremioPosterSize();
}

function getCinetraktSummaryPosterContainer(summaryContainer) {
	if (!summaryContainer) return null;

	return summaryContainer.querySelector(':scope > .trakt-summary-poster-container')
		|| [...summaryContainer.children].find((child) => (
			[...child.classList].some((className) => className.includes('trakt-summary-poster-container'))
		))
		|| null;
}

function setupWatchOnStremioPosterSize() {
	if (!isCinetraktPosterDetailRoute()) return;
	const routeKey = window.location.pathname;

	if (cinetraktStickyPosterState
		&& (cinetraktStickyPosterState.routeKey !== routeKey
			|| !cinetraktStickyPosterState.summaryContainer?.isConnected
			|| !cinetraktStickyPosterState.rail?.isConnected)) {
		cleanupWatchOnStremioPosterSize();
	}
	if (cinetraktStickyPosterState) {
		updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
		return;
	}

	const summaryContainer = document.querySelector('.trakt-summary-container')
		|| document.querySelector('[class*="trakt-summary-container"]');
	const posterContainer = getCinetraktSummaryPosterContainer(summaryContainer);
	const posterImage = posterContainer?.querySelector('img');
	const mainContent = summaryContainer?.closest('main.trakt-content, main');

	if (!summaryContainer || !posterContainer || !posterImage || !mainContent) return;
	if (posterContainer.parentElement !== summaryContainer) return;
	if (!findCinetraktStickyPosterControls(summaryContainer)) return;
	if (!posterImage.complete || !posterImage.naturalWidth || !posterImage.naturalHeight) {
		const pendingSource = posterImage.currentSrc || posterImage.src || routeKey;
		if (posterImage.dataset.watchOnStremioPosterLoadSource !== pendingSource) {
			posterImage.dataset.watchOnStremioPosterLoadSource = pendingSource;
			posterImage.addEventListener('load', () => scheduleCinetraktStickyPosterLayoutUpdate(0), { once: true });
		}
		return;
	}

	const originalPosterRect = posterContainer.getBoundingClientRect();
	const originalPosterImageRect = posterImage.getBoundingClientRect();
	const posterAspectRatio = originalPosterImageRect.width > 0 && originalPosterImageRect.height > 0
		? originalPosterImageRect.width / originalPosterImageRect.height
		: posterImage.naturalWidth / posterImage.naturalHeight;
	const metrics = getCinetraktStickyPosterMetrics({
		summaryContainer,
		posterImage,
		posterAspectRatio,
		posterTop: Math.max(8, originalPosterRect.top - CINETRAKT_POSTER_TOP_REDUCTION),
		summaryLeftFallback: Math.max(0, originalPosterRect.left),
	});
	document.documentElement.classList.add('cinetrakt-poster-layout-enabled');
	injectWatchOnStremioPosterSizeStyles();

	const posterEntry = moveCinetraktElementWithPlaceholder(
		posterContainer,
		'CineTrakt sticky poster position',
	);
	const rail = document.createElement('div');
	rail.id = CINETRAKT_STICKY_POSTER_RAIL_ID;
	const posterStage = document.createElement('div');
	posterStage.className = 'cinetrakt-sticky-poster-stage';
	posterStage.appendChild(posterContainer);
	summaryContainer.prepend(rail);
	rail.appendChild(posterStage);
	summaryContainer.classList.add('watch-on-stremio-poster-size-ready');
	posterContainer.classList.add('watch-on-stremio-summary-poster-sized');
	mainContent.classList.add('cinetrakt-sticky-poster-detail-page');

	cinetraktStickyPosterState = {
		routeKey,
		summaryContainer,
		posterContainer,
		posterStage,
		posterImage,
		posterEntry,
		controlsEntry: null,
		triviaEntry: null,
		sentimentTriviaRow: null,
		sentimentSection: null,
		contextualCardWidth: 0,
		rail,
		mainContent,
		sectionElements: new Set(),
		footer: null,
		boundsCorrectionFrame: null,
		posterDecorationOverflow: 0,
		summaryLeft: metrics.summaryLeft,
		posterTop: metrics.posterTop,
		posterSideGap: metrics.posterSideGap,
		posterAspectRatio,
	};
	syncCinetraktPosterBorderRadius(cinetraktStickyPosterState);
	globalThis.CineTraktTraktStremioUi?.refreshDetailPosterTarget?.();
	updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
}

function cleanupWatchOnStremioPosterSize() {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = null;
	document.documentElement.classList.remove(
		'cinetrakt-poster-layout-enabled',
		'cinetrakt-poster-layout-compact',
	);
	document.documentElement.style.removeProperty('--list-inner-width');
	const state = cinetraktStickyPosterState;
	window.cancelAnimationFrame(state?.boundsCorrectionFrame);
	const summaryContainer = state?.summaryContainer
		|| document.querySelector('.watch-on-stremio-poster-size-ready');
	const posterContainer = state?.posterContainer
		|| document.querySelector('.watch-on-stremio-summary-poster-sized');
	const posterStage = state?.posterStage;

	state?.controlsEntry?.element?.classList.remove('cinetrakt-sticky-poster-controls');
	if (state) restoreCinetraktTriviaToNativeFlow(state);
	restoreCinetraktMovedElement(state?.controlsEntry);
	restoreCinetraktMovedElement(state?.posterEntry);
	state?.rail?.remove();
	state?.mainContent?.classList.remove('cinetrakt-sticky-poster-detail-page');
	state?.mainContent?.style.removeProperty('--watch-on-stremio-sticky-content-left');
	state?.sectionElements?.forEach((section) => {
		section.classList.remove('cinetrakt-sticky-right-section');
	});
	state?.footer?.classList.remove('cinetrakt-sticky-right-footer');
	state?.footer?.style.removeProperty('--watch-on-stremio-sticky-content-left');
	summaryContainer?.classList.remove(
		'watch-on-stremio-poster-size-ready',
		'cinetrakt-poster-layout-compact',
		'cinetrakt-contextual-pair-ready',
	);
	posterContainer?.classList.remove('watch-on-stremio-summary-poster-sized');
	for (const element of [summaryContainer, posterContainer, posterStage]) {
		if (!element) continue;
		for (const property of [
			'--summary-poster-width',
			'--watch-on-stremio-summary-poster-width',
			'--watch-on-stremio-summary-poster-height',
			'--watch-on-stremio-sticky-poster-left',
			'--watch-on-stremio-sticky-poster-top',
			'--cinetrakt-poster-decoration-overflow',
		]) {
			element.style.removeProperty(property);
		}
	}
	cinetraktStickyPosterState = null;
}
	const api = Object.freeze({
		setEnabled(enabled) {
			cinetraktPosterLayoutRequested = Boolean(enabled);
			reconcileCinetraktStickyPosterLayout();
		},
		schedule: scheduleCinetraktStickyPosterLayoutUpdate,
		cleanup: cleanupWatchOnStremioPosterSize,
	});

	globalThis.CineTraktTraktPosterLayout = api;
})();
