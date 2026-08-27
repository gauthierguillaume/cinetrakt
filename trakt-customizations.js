(() => {
	'use strict';

	const { getCleanText } = globalThis.CineTraktTraktStremioUi;
const CINETRAKT_COLLECTION_HOST_ID = 'cinetrakt-official-collection-host';
const CINETRAKT_COLLECTION_STYLE_ID = 'cinetrakt-official-collection-style';
let cinetraktCollectionPlacement = null;
let cinetraktCollectionRenderProbe = null;
let cinetraktCollectionProbeAttemptedRoute = '';

function injectCinetraktCollectionCardStyles() {
	if (document.getElementById(CINETRAKT_COLLECTION_STYLE_ID)) return;

	const style = document.createElement('style');
	style.id = CINETRAKT_COLLECTION_STYLE_ID;
	style.textContent = `
		#${CINETRAKT_COLLECTION_HOST_ID} {
			box-sizing: border-box;
			margin-top: 20px;
			width: min(100%, var(--cinetrakt-collection-useful-width, 100%));
			max-width: 100%;
			min-width: 0;
			--width-card: 100%;
			--height-card: auto;
		}

		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card,
		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card > .trakt-card-content,
		#${CINETRAKT_COLLECTION_HOST_ID} .trakt-list-summary-card {
			box-sizing: border-box;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card,
		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card > .trakt-card-content {
			height: auto !important;
		}
	`;
	document.head.appendChild(style);
}

function findCinetraktCollectionInsertionTarget() {
	const summary = document.querySelector('.trakt-summary-main-content');
	const synopsis = summary?.querySelector('.line-clamp-content');
	if (!synopsis) return null;
	return synopsis.closest('trakt-spoiler')
		|| synopsis.closest('.trakt-clamped-text')
		|| synopsis;
}

function findCinetraktPopularListsSection() {
	return [...document.querySelectorAll('section.section-list-container, section')].find((section) => {
		return [...section.querySelectorAll('h1, h2, h3, h4, a, button, div, span')]
			.some((element) => /^(Popular Lists|Listes populaires)$/i.test(getCleanText(element.textContent)));
	}) || null;
}

function findCinetraktOfficialCollectionCard() {
	const popularListsSection = findCinetraktPopularListsSection();
	if (!popularListsSection) return null;

	const officialCards = popularListsSection.querySelectorAll(
		'.trakt-list-summary-card[data-variant="official"]',
	);
	for (const officialCard of officialCards) {
		if (!/@Trakt/i.test(officialCard.textContent || '')
			|| officialCard.querySelectorAll('img').length < 2) continue;
		return officialCard.closest('.trakt-card');
	}

	return null;
}

function restoreCinetraktCollectionRenderProbe() {
	if (!cinetraktCollectionRenderProbe) return;

	const { renderFor, placeholder, probe, timer, originalStyle } = cinetraktCollectionRenderProbe;
	window.clearTimeout(timer);
	if (renderFor) {
		if (originalStyle == null) renderFor.removeAttribute('style');
		else renderFor.setAttribute('style', originalStyle);
	}
	if (renderFor?.isConnected && placeholder?.parentNode) {
		placeholder.parentNode.insertBefore(renderFor, placeholder);
	}
	placeholder?.remove();
	probe?.remove();
	cinetraktCollectionRenderProbe = null;
}

function primeCinetraktPopularListsRendering(routeKey) {
	if (cinetraktCollectionRenderProbe?.routeKey === routeKey) return;
	if (cinetraktCollectionProbeAttemptedRoute === routeKey) return;
	restoreCinetraktCollectionRenderProbe();

	const listsWrapper = [...document.querySelectorAll('svelte-css-wrapper')].find((wrapper) => {
		return wrapper.getAttribute('style')?.includes('--height-lists-list');
	});
	const renderFor = listsWrapper?.closest('trakt-render-for');
	if (!renderFor?.parentNode) return;
	cinetraktCollectionProbeAttemptedRoute = routeKey;

	const placeholder = document.createComment('CineTrakt popular lists render position');
	const probe = document.createElement('div');
	const originalStyle = renderFor.getAttribute('style');
	Object.assign(probe.style, {
		position: 'fixed',
		left: '240px',
		top: '160px',
		width: '480px',
		height: '320px',
		overflow: 'hidden',
		opacity: '0',
		pointerEvents: 'none',
		zIndex: '-1',
	});
	Object.assign(renderFor.style, {
		display: 'block',
		width: '480px',
		height: '320px',
		minHeight: '320px',
	});

	renderFor.parentNode.insertBefore(placeholder, renderFor);
	document.body.appendChild(probe);
	probe.appendChild(renderFor);
	const timer = window.setTimeout(() => restoreCinetraktCollectionRenderProbe(), 5000);
	cinetraktCollectionRenderProbe = { routeKey, renderFor, placeholder, probe, timer, originalStyle };
}

function restoreCinetraktOfficialCollectionCard() {
	restoreCinetraktCollectionRenderProbe();
	if (!cinetraktCollectionPlacement) return;

	cinetraktCollectionPlacement.host?.remove();
	cinetraktCollectionPlacement = null;
}

function normalizeCinetraktSvgViewBoxes(root) {
	root?.querySelectorAll('svg[viewBox]').forEach((svg) => {
		const rawViewBox = svg.getAttribute('viewBox')?.trim() || '';
		const exactValues = rawViewBox.split(/[\s,]+/).map(Number);
		const hasValidViewBox = exactValues.length === 4
			&& exactValues.every(Number.isFinite)
			&& exactValues[2] >= 0
			&& exactValues[3] >= 0;
		if (hasValidViewBox) return;

		const recoveredValues = rawViewBox.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number) || [];
		if (recoveredValues.length === 4
			&& recoveredValues.every(Number.isFinite)
			&& recoveredValues[2] >= 0
			&& recoveredValues[3] >= 0) {
			svg.setAttribute('viewBox', recoveredValues.join(' '));
		} else {
			svg.removeAttribute('viewBox');
		}
	});
}

function getCinetraktCollectionPosterImages(collectionCard) {
	const seenSources = new Set();
	return Array.from(collectionCard?.querySelectorAll('img') || []).filter((image) => {
		const source = image.currentSrc || image.src || '';
		const rect = image.getBoundingClientRect();
		const looksLikePoster = /\/posters\//i.test(source)
			|| (rect.width >= 24 && rect.height > rect.width * 1.15);
		if (!looksLikePoster || seenSources.has(source)) return false;
		seenSources.add(source);
		return true;
	}).slice(0, 8);
}

function updateCinetraktCollectionCardWidth(host, collectionCard) {
	if (!host?.isConnected || !collectionCard?.isConnected) return;

	const cardRect = collectionCard.getBoundingClientRect();
	const posterRects = getCinetraktCollectionPosterImages(collectionCard)
		.map((image) => image.getBoundingClientRect())
		.filter((rect) => rect.width > 0 && rect.height > 0);
	if (!cardRect.width || !posterRects.length) return;

	const firstPosterLeft = Math.min(...posterRects.map((rect) => rect.left));
	const lastPosterRight = Math.max(...posterRects.map((rect) => rect.right));
	const horizontalInset = Math.max(12, firstPosterLeft - cardRect.left);
	const usefulWidth = Math.ceil(Math.max(320, lastPosterRight - cardRect.left + horizontalInset));
	host.style.setProperty('--cinetrakt-collection-useful-width', `${usefulWidth}px`);
}

function scheduleCinetraktCollectionCardWidth(host, collectionCard) {
	window.requestAnimationFrame(() => {
		window.requestAnimationFrame(() => updateCinetraktCollectionCardWidth(host, collectionCard));
	});
}

function placeCinetraktOfficialCollectionCard() {
	const routeKey = window.location.pathname;
	const isMoviePage = /^\/movies\/[^/]+\/?$/.test(routeKey);
	if (!isMoviePage) {
		restoreCinetraktOfficialCollectionCard();
		cinetraktCollectionProbeAttemptedRoute = '';
		return;
	}

	if (cinetraktCollectionPlacement
		&& (cinetraktCollectionPlacement.routeKey !== routeKey
			|| !cinetraktCollectionPlacement.host?.isConnected)) {
		restoreCinetraktOfficialCollectionCard();
	}
	if (cinetraktCollectionPlacement) return;

	const insertionTarget = findCinetraktCollectionInsertionTarget();
	const collectionCard = findCinetraktOfficialCollectionCard();
	if (!insertionTarget) return;
	if (!collectionCard) {
		primeCinetraktPopularListsRendering(routeKey);
		return;
	}

	injectCinetraktCollectionCardStyles();
	const host = document.createElement('div');
	host.id = CINETRAKT_COLLECTION_HOST_ID;
	host.dataset.cinetraktRoute = routeKey;
	normalizeCinetraktSvgViewBoxes(collectionCard);
	const collectionCardCopy = collectionCard.cloneNode(true);
	collectionCardCopy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
	collectionCardCopy.querySelectorAll('img').forEach((image) => image.setAttribute('loading', 'eager'));
	normalizeCinetraktSvgViewBoxes(collectionCardCopy);
	restoreCinetraktCollectionRenderProbe();
	insertionTarget.insertAdjacentElement('afterend', host);
	host.appendChild(collectionCardCopy);
	scheduleCinetraktCollectionCardWidth(host, collectionCardCopy);
	cinetraktCollectionPlacement = { routeKey, host };
}

function getCinetraktSidebarEntryWrapper(candidate, boundary) {
	let wrapper = candidate;
	for (let element = candidate.parentElement; element && element !== boundary; element = element.parentElement) {
		const interactiveElements = element.querySelectorAll(
			'a[href], button, [role="link"]:not(a), [role="button"]:not(button)',
		);
		if (interactiveElements.length > 1) break;
		wrapper = element;
	}
	return wrapper;
}

function hideCinetraktUnusedTraktNavigationEntries() {
	const sidebar = document.querySelector('.trakt-side-navbar');
	const bottom = sidebar?.querySelector(':scope > .trakt-side-navbar-bottom');
	const content = sidebar?.querySelector(':scope > .trakt-side-navbar-content');
	if (!bottom && !content) return;

	if (!document.getElementById('cinetrakt-hidden-navigation-style')) {
		const style = document.createElement('style');
		style.id = 'cinetrakt-hidden-navigation-style';
		style.textContent = '.cinetrakt-hidden-navigation-entry { display: none !important; }';
		document.head.appendChild(style);
	}

	const targets = [
		{
			boundary: bottom,
			matches: (labels, href) => labels.some((label) => [
				'library',
				'librairie',
				'bibliothèque',
				'bibliotheque',
			].includes(label)) || /(^|\/)library(?:\/|\?|#|$)/i.test(href),
		},
		{
			boundary: content,
			matches: (labels, href) => labels.some((label) => label === 'collaborations')
				|| /(^|\/)collaborations(?:\/|\?|#|$)/i.test(href),
		},
	];

	for (const { boundary, matches } of targets) {
		if (!boundary) continue;
		for (const candidate of boundary.querySelectorAll(
			'a[href], button, [role="link"]:not(a), [role="button"]:not(button)',
		)) {
			const labels = [
				candidate.textContent,
				candidate.getAttribute('aria-label'),
				candidate.getAttribute('title'),
			]
				.map((value) => value?.trim().toLowerCase() || '')
				.filter(Boolean);
			const href = candidate.getAttribute('href') || '';
			if (!matches(labels, href)) continue;

			getCinetraktSidebarEntryWrapper(candidate, boundary)
				.classList.add('cinetrakt-hidden-navigation-entry');
		}
	}
}
	function restoreCinetraktNavigationEntries() {
		document.querySelectorAll('.cinetrakt-hidden-navigation-entry')
			.forEach((element) => element.classList.remove('cinetrakt-hidden-navigation-entry'));
	}

	const api = Object.freeze({
		update({ collectionEnabled, navigationCleanupEnabled }) {
			if (collectionEnabled) placeCinetraktOfficialCollectionCard();
			else restoreCinetraktOfficialCollectionCard();
			if (navigationCleanupEnabled) hideCinetraktUnusedTraktNavigationEntries();
			else restoreCinetraktNavigationEntries();
		},
		cleanup() {
			restoreCinetraktOfficialCollectionCard();
			restoreCinetraktNavigationEntries();
		},
	});

	globalThis.CineTraktTraktCustomizations = api;
})();
