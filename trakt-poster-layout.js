(() => {
	'use strict';
const CINETRAKT_STICKY_POSTER_RAIL_ID = 'cinetrakt-sticky-poster-rail';
let cinetraktStickyPosterState = null;
let cinetraktStickyPosterResizeTimer = null;

function injectWatchOnStremioPosterSizeStyles() {
	if (document.getElementById('watch-on-stremio-poster-size-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-poster-size-styles';
	style.textContent = `
		/* Colonne fixe CineTrakt : commandes et affiche restent visibles pendant que
		   le résumé et les sections suivantes défilent dans la partie droite. */
		.trakt-summary-container.watch-on-stremio-poster-size-ready,
		[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
			grid-template-columns:
				minmax(0, 1fr)
				minmax(220px, 320px) !important;
			width: 100% !important;
			max-width: 100% !important;
			margin-left: 0 !important;
			align-items: start !important;
		}

		html.cinetrakt-poster-layout-enabled,
		html.cinetrakt-poster-layout-enabled body {
			max-width: 100% !important;
			overflow-x: clip !important;
		}

		main.cinetrakt-sticky-poster-detail-page {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
			padding-left: var(--watch-on-stremio-sticky-content-left) !important;
			padding-right: 24px !important;
			overflow-x: clip !important;
		}

		main.cinetrakt-sticky-poster-detail-page > * {
			box-sizing: border-box !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		#${CINETRAKT_STICKY_POSTER_RAIL_ID} {
			box-sizing: border-box !important;
			position: fixed !important;
			left: var(--watch-on-stremio-sticky-poster-left) !important;
			top: var(--watch-on-stremio-sticky-poster-top) !important;
			width: var(--watch-on-stremio-summary-poster-width) !important;
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

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized {
			width: var(--watch-on-stremio-summary-poster-width) !important;
			max-width: var(--watch-on-stremio-summary-poster-width) !important;
			height: var(--watch-on-stremio-summary-poster-height) !important;
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

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized img {
			width: 100% !important;
			height: 100% !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			object-fit: contain !important;
		}

		.watch-on-stremio-poster-size-ready .trakt-summary-content,
		.watch-on-stremio-poster-size-ready [class*="trakt-summary-content"] {
			grid-column: 1 !important;
			width: auto !important;
			min-width: 0 !important;
		}

		.watch-on-stremio-poster-size-ready .trakt-summary-contextual-content,
		.watch-on-stremio-poster-size-ready [class*="trakt-summary-contextual-content"] {
			grid-column: 2 !important;
			min-width: 0 !important;
		}

		main.cinetrakt-sticky-poster-detail-page .cinetrakt-sticky-right-section {
			box-sizing: border-box !important;
			margin: 0 0 0 -24px !important;
			width: calc(100% + 24px) !important;
			max-width: calc(100% + 24px) !important;
			min-width: 0 !important;
		}

		.cinetrakt-sticky-right-footer {
			box-sizing: border-box !important;
			margin-left: var(--watch-on-stremio-sticky-content-left) !important;
			width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 24px) !important;
			max-width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 24px) !important;
			min-width: 0 !important;
			padding-left: 48px !important;
			padding-right: 24px !important;
		}

		.cinetrakt-sticky-right-footer .trakt-footer-content,
		.cinetrakt-sticky-right-footer .trakt-footer-grid {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		@media (max-width: 1000px) {
			.trakt-summary-container.watch-on-stremio-poster-size-ready,
			[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
				grid-template-columns: minmax(0, 1fr) !important;
			}

			.watch-on-stremio-poster-size-ready .trakt-summary-contextual-content,
			.watch-on-stremio-poster-size-ready [class*="trakt-summary-contextual-content"] {
				grid-column: 1 !important;
			}
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
			state.rail.insertBefore(attachedControls, state.posterContainer);
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
	state.rail.insertBefore(controls, state.posterContainer);
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
	const footer = document.querySelector('footer, [role="contentinfo"]');
	if (footer) {
		state.footer = footer;
		footer.classList.add('cinetrakt-sticky-right-footer');
	}
}

function scheduleCinetraktStickyPosterLayoutUpdate(delay = 80) {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = window.setTimeout(() => {
		cinetraktStickyPosterResizeTimer = null;
		if (cinetraktStickyPosterState) {
			updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
		}
	}, delay);
}

function applyCinetraktStickyPosterDimensions(state, width, height) {
	const {
		summaryContainer,
		posterContainer,
		mainContent,
		summaryLeft,
	} = state;
	const contentLeft = summaryLeft + width + 32;

	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	mainContent.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
	state.footer?.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
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

function scheduleCinetraktStickyPosterBoundsCorrection(state, imageRatio, bottomSafety) {
	window.cancelAnimationFrame(state.boundsCorrectionFrame);
	state.boundsCorrectionFrame = window.requestAnimationFrame(() => {
		state.boundsCorrectionFrame = null;
		if (state !== cinetraktStickyPosterState || !state.posterContainer.isConnected) return;

		const posterRect = state.posterContainer.getBoundingClientRect();
		let decorationOverflow = 0;
		state.posterContainer.querySelectorAll('*')
			.forEach((element) => {
				const rect = element.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				decorationOverflow = Math.max(decorationOverflow, rect.bottom - posterRect.bottom);
			});
		state.posterDecorationOverflow = Math.max(0, decorationOverflow);
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
	const { summaryContainer, posterContainer, posterImage, rail, mainContent } = state;
	if (!summaryContainer.isConnected || !posterContainer.isConnected || !rail.isConnected) return;

	attachCinetraktStickyPosterControls(state);
	markCinetraktResponsiveRightContent(state);
	if (!posterImage.complete || !posterImage.naturalWidth || !posterImage.naturalHeight) {
		const pendingSource = posterImage.currentSrc || posterImage.src || window.location.pathname;
		if (posterImage.dataset.watchOnStremioPosterLoadSource !== pendingSource) {
			posterImage.dataset.watchOnStremioPosterLoadSource = pendingSource;
			posterImage.addEventListener('load', () => scheduleCinetraktStickyPosterLayoutUpdate(0), { once: true });
		}
		return;
	}

	const viewportHeights = [
		document.documentElement.clientHeight,
		window.innerHeight,
		window.visualViewport?.height,
	].filter((value) => Number.isFinite(value) && value > 0);
	const viewportHeight = Math.floor(viewportHeights.length
		? Math.min(...viewportHeights)
		: window.innerHeight);
	const imageRatio = posterImage.naturalWidth / posterImage.naturalHeight;
	const summaryRect = summaryContainer.getBoundingClientRect();
	const sidebarRect = document.querySelector('.trakt-side-navbar')?.getBoundingClientRect();
	const configuredSideGap = Number.parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue('--layout-distance-side'),
	);
	const sidebarGap = Number.isFinite(configuredSideGap) ? configuredSideGap : 24;
	const summaryLeft = sidebarRect?.width > 0
		? Math.max(0, Math.round(sidebarRect.right + sidebarGap))
		: state.summaryLeft;
	if (window.scrollY < 2) state.posterTop = Math.max(0, summaryRect.top + 38);
	state.summaryLeft = summaryLeft;
	const posterTop = state.posterTop;
	const controlsHeight = state.controlsEntry?.element?.getBoundingClientRect().height || 0;
	const controlsGap = controlsHeight > 0 ? 8 : 0;
	const railTop = Math.max(8, posterTop - controlsHeight - controlsGap);
	const posterBottomSafety = 24;
	const availableHeight = Math.max(
		1,
		viewportHeight - posterTop - posterBottomSafety - state.posterDecorationOverflow,
	);
	const finalHeight = Math.floor(availableHeight);
	const finalWidth = Math.max(1, Math.floor(finalHeight * imageRatio));

	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-left', `${summaryLeft}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-top', `${railTop}px`);
	applyCinetraktStickyPosterDimensions(state, finalWidth, finalHeight);
	scheduleCinetraktStickyPosterBoundsCorrection(state, imageRatio, posterBottomSafety);
}

function setupWatchOnStremioPosterSize() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname)) return;
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
	const posterContainer = summaryContainer?.querySelector('.trakt-summary-poster-container')
		|| summaryContainer?.querySelector('[class*="trakt-summary-poster-container"]');
	const posterImage = posterContainer?.querySelector('img');
	const mainContent = summaryContainer?.closest('main.trakt-content, main');

	if (!summaryContainer || !posterContainer || !posterImage || !mainContent) return;

	injectWatchOnStremioPosterSizeStyles();

	// Nettoyage des essais précédents, au cas où une ancienne version a laissé des classes/styles.
	summaryContainer.classList.remove('watch-on-stremio-summary-layout-ready', 'watch-on-stremio-large-poster-page');
	posterContainer.classList.remove('watch-on-stremio-poster-size-target', 'watch-on-stremio-poster-tilt-card');
	for (const property of ['transform', 'filter', 'box-shadow', 'transition', 'will-change', 'perspective', 'transform-origin', 'z-index']) {
		posterContainer.style.removeProperty(property);
	}

	const originalPosterRect = posterContainer.getBoundingClientRect();
	const posterEntry = moveCinetraktElementWithPlaceholder(
		posterContainer,
		'CineTrakt sticky poster position',
	);
	const rail = document.createElement('div');
	rail.id = CINETRAKT_STICKY_POSTER_RAIL_ID;
	summaryContainer.prepend(rail);
	rail.appendChild(posterContainer);
	summaryContainer.classList.add('watch-on-stremio-poster-size-ready');
	posterContainer.classList.add('watch-on-stremio-summary-poster-sized');
	mainContent.classList.add('cinetrakt-sticky-poster-detail-page');

	cinetraktStickyPosterState = {
		routeKey,
		summaryContainer,
		posterContainer,
		posterImage,
		posterEntry,
		controlsEntry: null,
		rail,
		mainContent,
		sectionElements: new Set(),
		footer: null,
		boundsCorrectionFrame: null,
		posterDecorationOverflow: 0,
		summaryLeft: Math.max(0, originalPosterRect.left),
		posterTop: Math.max(0, originalPosterRect.top),
	};
	updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
}

function cleanupWatchOnStremioPosterSize() {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = null;
	document.documentElement.classList.remove('cinetrakt-poster-layout-enabled');
	const state = cinetraktStickyPosterState;
	window.cancelAnimationFrame(state?.boundsCorrectionFrame);
	const summaryContainer = state?.summaryContainer
		|| document.querySelector('.watch-on-stremio-poster-size-ready');
	const posterContainer = state?.posterContainer
		|| document.querySelector('.watch-on-stremio-summary-poster-sized');

	state?.controlsEntry?.element?.classList.remove('cinetrakt-sticky-poster-controls');
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
	summaryContainer?.classList.remove('watch-on-stremio-poster-size-ready');
	posterContainer?.classList.remove('watch-on-stremio-summary-poster-sized');
	for (const element of [summaryContainer, posterContainer]) {
		if (!element) continue;
		for (const property of [
			'--watch-on-stremio-summary-poster-width',
			'--watch-on-stremio-summary-poster-height',
			'--watch-on-stremio-sticky-poster-left',
			'--watch-on-stremio-sticky-poster-top',
		]) {
			element.style.removeProperty(property);
		}
	}
	cinetraktStickyPosterState = null;
}
	const api = Object.freeze({
		setEnabled(enabled) {
			document.documentElement.classList.toggle('cinetrakt-poster-layout-enabled', enabled);
			if (enabled) setupWatchOnStremioPosterSize();
			else cleanupWatchOnStremioPosterSize();
		},
		schedule: scheduleCinetraktStickyPosterLayoutUpdate,
		cleanup: cleanupWatchOnStremioPosterSize,
	});

	globalThis.CineTraktTraktPosterLayout = api;
})();
