(() => {
	'use strict';

	const { getCleanText } = globalThis.CineTraktTraktStremioUi;
const CINETRAKT_COLLECTION_HOST_ID = 'cinetrakt-official-collection-host';
const CINETRAKT_COLLECTION_STYLE_ID = 'cinetrakt-official-collection-style';
let cinetraktCollectionPlacement = null;
let cinetraktCollectionRenderProbe = null;
let cinetraktCollectionProbeAttemptedRoute = '';
let cinetraktCollectionDiscoveryObserver = null;

function setCinetraktReactionsHidden(enabled) {
	if (!document.getElementById('cinetrakt-hidden-reactions-style')) {
		const style = document.createElement('style');
		style.id = 'cinetrakt-hidden-reactions-style';
		style.textContent = `
			html.cinetrakt-hide-media-reactions .trakt-summary-container .trakt-summary-social-row .trakt-reactions-popover-trigger {
				display: none !important;
			}
		`;
		document.head.appendChild(style);
	}
	document.documentElement.classList.toggle('cinetrakt-hide-media-reactions',
		Boolean(enabled) && /^\/(movies|shows)\/[^/]+\/?$/.test(window.location.pathname));
}

function injectCinetraktCollectionCardStyles() {
	if (document.getElementById(CINETRAKT_COLLECTION_STYLE_ID)) return;
	const style = document.createElement('style'); style.id = CINETRAKT_COLLECTION_STYLE_ID;
	style.textContent = `
		#${CINETRAKT_COLLECTION_HOST_ID} {
			grid-column: 1 / -1; width: 100%; min-width: 0;
			margin: 0; padding: 0; background: transparent;
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
	return [...document.querySelectorAll('section.section-list-container')].find((section) => {
		return [...section.querySelectorAll('.trakt-list-title-wrapper, h1, h2, h3, h4')]
			.some((element) => /^(Popular Lists|Listes populaires)$/i.test(getCleanText(element.textContent)));
	}) || null;
}

function findCinetraktOfficialCollectionCard() {
	const popularListsSection = findCinetraktPopularListsSection();
	if (!popularListsSection) return null;

	const officialCards = popularListsSection.querySelectorAll(
		'.trakt-list-summary-card[data-variant="official"]',
	);
	const candidates = Array.from(officialCards, (officialCard) => {
		const titleLink = officialCard.querySelector('.list-content > a[href]');
		return {
			href: titleLink?.getAttribute('href'),
			title: getCleanText(titleLink?.textContent || ''),
			variant: officialCard.getAttribute('data-variant'),
			owner: getCleanText(officialCard.querySelector('.owner-item p:last-child')?.textContent || ''),
			card: officialCard.closest('.trakt-card'),
		};
	});
	return globalThis.CineTraktCollectionUtils.findUniqueOfficialMovieCollection(candidates)?.card || null;
}

function restoreCinetraktCollectionRenderProbe() {
	if (!cinetraktCollectionRenderProbe) return;

	const { renderFor, placeholder, probe, timer, originalStyle, observer, onScroll } = cinetraktCollectionRenderProbe;
	cinetraktCollectionRenderProbe = null;
	window.clearTimeout(timer);
	observer.disconnect();
	window.removeEventListener('scroll', onScroll, true);
	window.removeEventListener('wheel', onScroll, true);
	window.removeEventListener('touchmove', onScroll, true);
	if (renderFor) {
		if (originalStyle == null) renderFor.removeAttribute('style');
		else renderFor.setAttribute('style', originalStyle);
	}
	if (renderFor?.isConnected && placeholder?.parentNode) {
		placeholder.parentNode.insertBefore(renderFor, placeholder);
	}
	placeholder?.remove();
	probe?.remove();
	globalThis.CineTraktTraktRuntime?.schedule('collection-preload-finished', 0);
}

function primeCinetraktPopularListsRendering(routeKey) {
	if (cinetraktCollectionRenderProbe?.routeKey === routeKey) return;
	restoreCinetraktCollectionRenderProbe();

	const listsWrapper = [...document.querySelectorAll('svelte-css-wrapper')].find((wrapper) => {
		return wrapper.getAttribute('style')?.includes('--height-lists-list');
	});
	const renderFor = listsWrapper?.closest('trakt-render-for');
	if (!renderFor?.parentNode) {
		// The list section may mount after the summary, inside a native container
		// already styled by CineTrakt (and therefore ignored by the shared observer).
		if (!cinetraktCollectionDiscoveryObserver) {
			cinetraktCollectionDiscoveryObserver = new MutationObserver(() => {
				if (!document.querySelector('svelte-css-wrapper[style*="--height-lists-list"]')) return;
				cinetraktCollectionDiscoveryObserver.disconnect();
				cinetraktCollectionDiscoveryObserver = null;
				globalThis.CineTraktTraktRuntime?.schedule('collection-row-ready', 0);
			});
			cinetraktCollectionDiscoveryObserver.observe(document.body, { childList: true, subtree: true });
		}
		return;
	}
	cinetraktCollectionDiscoveryObserver?.disconnect();
	cinetraktCollectionDiscoveryObserver = null;
	const cardSelector = '.trakt-list-item-container > svelte-css-wrapper > .trakt-card';
	const cards = [...listsWrapper.querySelectorAll(cardSelector)];
	if (cards.length && cards.every((card) => card.querySelector('.trakt-list-summary-card'))) return;
	const attemptKey = `${routeKey}|${cards.length}`;
	if (cinetraktCollectionProbeAttemptedRoute === attemptKey) return;
	cinetraktCollectionProbeAttemptedRoute = attemptKey;

	const placeholder = document.createComment('CineTrakt popular lists render position');
	const probe = document.createElement('div');
	probe.id = 'cinetrakt-collection-render-probe';
	const probeStyle = document.createElement('style');
	probeStyle.textContent = `
		#cinetrakt-collection-render-probe .trakt-list-item-container {
			display: grid !important;
			grid-template-columns: minmax(0, 1fr) !important;
			overflow: visible !important;
		}
		#cinetrakt-collection-render-probe .trakt-list-item-container > svelte-css-wrapper > .trakt-card {
			grid-area: 1 / 1 !important;
		}
	`;
	// Each list card is also lazy-rendered. Overlap them only inside this invisible
	// probe so later cards become observable without scrolling the native carousel.
	probe.appendChild(probeStyle);
	const originalStyle = renderFor.getAttribute('style');
	Object.assign(probe.style, {
		position: 'fixed',
		left: '0',
		top: '0',
		width: 'min(480px, 100vw)',
		height: 'min(400px, 100vh)',
		overflow: 'hidden',
		opacity: '0',
		pointerEvents: 'none',
		zIndex: '-1',
	});
	Object.assign(renderFor.style, {
		display: 'block',
		width: '100%',
		height: '100%',
		minHeight: '0',
	});

	renderFor.parentNode.insertBefore(placeholder, renderFor);
	document.body.appendChild(probe);
	probe.appendChild(renderFor);
	const initialScrollTop = document.scrollingElement?.scrollTop || 0;
	const onScroll = (event) => {
		// Carousel initialization emits scroll events too. Only a page scroll or
		// the user's scrolling gesture should interrupt background preloading.
		if (event?.type === 'scroll' && event.target !== document) return;
		if (event?.type === 'scroll'
			&& (document.scrollingElement?.scrollTop || 0) === initialScrollTop) return;
		restoreCinetraktCollectionRenderProbe();
	};
	const observer = new MutationObserver(() => {
		if (cinetraktCollectionRenderProbe?.probe !== probe) return;
		const renderedCards = [...listsWrapper.querySelectorAll(cardSelector)];
		if (renderedCards.length && renderedCards.every((card) => card.querySelector('.trakt-list-summary-card'))) {
			restoreCinetraktCollectionRenderProbe();
		}
	});
	// No collection is a normal result. Release the native row as soon as its cards
	// are rendered, and always before waiting could interfere with page scrolling.
	// The section itself can arrive after the other page data. Give it time to
	// mount, without withholding the row when the user starts scrolling.
	const timer = window.setTimeout(onScroll, 8000);
	cinetraktCollectionRenderProbe = { routeKey, renderFor, placeholder, probe, timer, originalStyle, observer, onScroll };
	observer.observe(renderFor, { childList: true, subtree: true });
	window.addEventListener('scroll', onScroll, { capture: true, passive: true });
	window.addEventListener('wheel', onScroll, { capture: true, passive: true });
	window.addEventListener('touchmove', onScroll, { capture: true, passive: true });
}

function restoreCinetraktOfficialCollectionCard() {
	cinetraktCollectionDiscoveryObserver?.disconnect();
	cinetraktCollectionDiscoveryObserver = null;
	restoreCinetraktCollectionRenderProbe();
	if (!cinetraktCollectionPlacement) return;
	cinetraktCollectionPlacement.dispose?.();
	cinetraktCollectionPlacement.host?.remove();
	cinetraktCollectionPlacement = null;
}

function placeCinetraktOfficialCollectionCard() {
	const routeKey = window.location.pathname;
	if (!/^\/movies\/[^/]+\/?$/.test(routeKey)) {
		restoreCinetraktOfficialCollectionCard(); cinetraktCollectionProbeAttemptedRoute = ''; return;
	}
	if (cinetraktCollectionPlacement && (cinetraktCollectionPlacement.routeKey !== routeKey
		|| !cinetraktCollectionPlacement.host?.isConnected)) restoreCinetraktOfficialCollectionCard();
	if (cinetraktCollectionPlacement) return;
	const insertionTarget = findCinetraktCollectionInsertionTarget();
	const collectionCard = findCinetraktOfficialCollectionCard();
	if (!insertionTarget) return;
	if (!collectionCard) { primeCinetraktPopularListsRendering(routeKey); return; }
	const titleLink = collectionCard.querySelector('.list-content > a[href]');
	const href = globalThis.CineTraktCollectionUtils.collectionPath(titleLink?.getAttribute('href'));
	const title = getCleanText(titleLink?.textContent);
	if (!href || !title) return;
	injectCinetraktCollectionCardStyles();
	const host = document.createElement('section'); host.id = CINETRAKT_COLLECTION_HOST_ID;
	host.className = 'cinetrakt-collection-section'; host.dataset.cinetraktRoute = routeKey;
	host.setAttribute('aria-label', title);
	const body = document.createElement('div'); body.className = 'cinetrakt-native-section-body';
	host.appendChild(body);
	restoreCinetraktCollectionRenderProbe();
	const summaryContainer = insertionTarget.closest('.trakt-summary-container');
	// Preserve the native summary/contextual row, including Where to Watch.
	// The collection spans the next available row, after both native columns.
	if (summaryContainer) summaryContainer.appendChild(host);
	else insertionTarget.insertAdjacentElement('afterend', host);
	const state = { routeKey, host }; cinetraktCollectionPlacement = state;
	state.dispose = globalThis.CineTraktNativeSection.mount({ host: body, href, title, route: routeKey,
		portal: true, itemCount: globalThis.CineTraktCollectionUtils.collectionItemCount(collectionCard.querySelector('.count-item')?.textContent),
		countNode: collectionCard.querySelector('.count-item') });
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
			matches: (labels, href) => labels.some((label) => ['shared', 'collaborations'].includes(label))
				|| /(^|\/)(?:shared|collaborations)(?:\/|\?|#|$)/i.test(href),
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
		update({ collectionEnabled, navigationCleanupEnabled, hideReactionsEnabled }) {
			setCinetraktReactionsHidden(hideReactionsEnabled);
			if (collectionEnabled) placeCinetraktOfficialCollectionCard();
			else restoreCinetraktOfficialCollectionCard();
			if (navigationCleanupEnabled) hideCinetraktUnusedTraktNavigationEntries();
			else restoreCinetraktNavigationEntries();
		},
		cleanup() {
			document.documentElement.classList.remove('cinetrakt-hide-media-reactions');
			restoreCinetraktOfficialCollectionCard();
			restoreCinetraktNavigationEntries();
		},
	});

	globalThis.CineTraktTraktCustomizations = api;
})();
