(() => {
	'use strict';

	/*
		CineTrakt - panneau compact pour Stremio Web v5

		Ce script ne s'active QUE quand l'URL contient wos_stream_panel=1.
		Il ne modifie pas Stremio Web quand tu l'ouvres normalement.

		Objectif : garder uniquement la vraie liste utile :
		- streams-list-container : liste des streams d'un film / épisode ;
		- videos-list-container  : liste des épisodes d'une série / saison.

		Important : on évite les heuristiques lourdes et les vieux noms instables.
		Les classes Svelte changent, mais les fragments "streams-list-container" / "videos-list-container"
		sont ceux que tu as montrés dans DevTools sur la nouvelle UI.
	*/

	const STYLE_ID = 'wos-stremio-panel-style';
	const ACTIVE_CLASS = 'wos-stremio-panel-active';
	const ROOT_CLASS = 'wos-stremio-panel-root';
	const HIDDEN_CLASS = 'wos-stremio-panel-hidden';
	const NO_PLAY_CLASS = 'wos-stremio-sources-no-play';
	const STREAM_CARDS_CLASS = 'wos-stremio-source-cards';
	const THEME_CLASS = 'wos-stremio-trakt-theme';
	const TITLE_HIGHLIGHT = 'cinetrakt-stream-title';
	const SIZE_HIGHLIGHT = 'cinetrakt-stream-size';
	const DISCOVERY_RETRY_DELAYS = Object.freeze([80, 160, 320, 640, 1200, 2400, 4000]);

	let lastPanel = null;
	let lastRouteKey = '';
	let lastKnownScrollTop = 0;
	let scheduled = false;
	let retryTimer = null;
	let retryIndex = 0;
	let animationFrame = null;

	function hasPanelFlag() {
		try {
			if (new URLSearchParams(location.search).get('wos_stream_panel') === '1') return true;
			const hash = location.hash || '';
			const queryIndex = hash.indexOf('?');
			if (queryIndex === -1) return false;
			return new URLSearchParams(hash.slice(queryIndex + 1)).get('wos_stream_panel') === '1';
		} catch (error) {
			return false;
		}
	}

	if (!hasPanelFlag()) return;

	function isDetailRoute() {
		return location.hostname === 'web.stremio.com' && location.hash.includes('/detail/');
	}

	function injectStyle() {
		if (document.getElementById(STYLE_ID)) return;

		const style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = `
			html.${ACTIVE_CLASS},
			html.${ACTIVE_CLASS} body {
				width: 100% !important;
				min-width: 0 !important;
				margin: 0 !important;
				padding: 0 !important;
				overflow: hidden !important;
				background: #080512 !important;
			}

			html.${ACTIVE_CLASS} .${HIDDEN_CLASS} {
				display: none !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS} {
				position: fixed !important;
				inset: 0 !important;
				z-index: 2147483647 !important;
				width: 100vw !important;
				height: 100vh !important;
				max-width: none !important;
				max-height: none !important;
				min-width: 0 !important;
				min-height: 0 !important;
				margin: 0 !important;
				padding: 10px 8px 24px 8px !important;
				box-sizing: border-box !important;
				overflow-x: hidden !important;
				overflow-y: auto !important;
				background: #080512 !important;
				border-radius: 0 !important;
				transform: none !important;
				filter: none !important;
				backdrop-filter: none !important;
				-webkit-backdrop-filter: none !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS} * {
				max-width: 100% !important;
				box-sizing: border-box !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS} [class*="select-choices"],
			html.${ACTIVE_CLASS} .${ROOT_CLASS} [class*="season-bar"],
			html.${ACTIVE_CLASS} .${ROOT_CLASS} [class*="search-bar"] {
				position: sticky !important;
				top: 0 !important;
				z-index: 5 !important;
				background: #080512 !important;
				padding-bottom: 8px !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS} img {
				max-width: 90px !important;
				height: auto !important;
			}

			html.${ACTIVE_CLASS}.${NO_PLAY_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] > svg[class*="icon-"] {
				display: none !important;
			}

			html.${ACTIVE_CLASS}.${NO_PLAY_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] > [class*="description-container-"] {
				display: block !important;
				min-width: 0 !important;
				white-space: pre-wrap !important;
				overflow-wrap: anywhere !important;
				overflow: visible !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS}[class*="streams-list-container"] {
				padding: 8px 4px 20px !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} [class*="streams-container-"] {
				padding: 0 !important;
				min-width: 0 !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] {
				width: 100% !important;
				min-width: 0 !important;
				margin: 0 0 6px !important;
				padding: 8px 6px !important;
				gap: 6px !important;
				align-items: stretch !important;
				border: 1px solid rgba(201, 183, 239, 0.13) !important;
				border-radius: 10px !important;
				background: rgba(201, 183, 239, 0.045) !important;
				transition: background-color 120ms ease, border-color 120ms ease;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"]:hover,
			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"]:focus-visible {
				background: rgba(168, 85, 247, 0.12) !important;
				border-color: rgba(192, 132, 252, 0.55) !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] > [class*="info-container-"] {
				width: 7rem !important;
				max-width: 34% !important;
				min-width: 0 !important;
				padding-right: 4px !important;
				border-right: 1px solid rgba(201, 183, 239, 0.16) !important;
				overflow: visible !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] [class*="addon-name-"] {
				white-space: pre-wrap !important;
				overflow-wrap: anywhere !important;
				overflow: visible !important;
			}

			html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] > [class*="description-container-"] {
				display: block !important;
				min-width: 0 !important;
				align-self: center !important;
				font-size: 0.95em !important;
				white-space: pre-wrap !important;
				overflow-wrap: anywhere !important;
				overflow: visible !important;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS},
			html.${ACTIVE_CLASS}.${THEME_CLASS} body,
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS},
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} [class*="select-choices"],
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} [class*="season-bar"],
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} [class*="search-bar"] {
				background: #17141b !important;
				color: #ebe7ef !important;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] {
				background: #100e13 !important;
				border-color: rgba(192, 132, 252, 0.18) !important;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} a[class*="stream-container-"]:hover,
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} a[class*="stream-container-"]:focus-visible {
				background: #281b33 !important;
				border-color: #a855f7 !important;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] [class*="addon-name-"],
			html.${ACTIVE_CLASS}.${THEME_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] > [class*="description-container-"] {
				line-height: 1.5 !important;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS} ::highlight(${TITLE_HIGHLIGHT}) {
				color: #a855f7;
			}

			html.${ACTIVE_CLASS}.${THEME_CLASS} ::highlight(${SIZE_HIGHLIGHT}) {
				color: #f2cc60;
			}

			@media (prefers-reduced-motion: reduce) {
				html.${ACTIVE_CLASS}.${STREAM_CARDS_CLASS} .${ROOT_CLASS} a[class*="stream-container-"] {
					transition: none !important;
				}
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS}::-webkit-scrollbar {
				width: 8px !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS}::-webkit-scrollbar-thumb {
				background: rgba(255, 255, 255, 0.18) !important;
				border-radius: 999px !important;
			}

			html.${ACTIVE_CLASS} .${ROOT_CLASS}::-webkit-scrollbar-track {
				background: transparent !important;
			}
		`;
		document.documentElement.appendChild(style);
	}

	function clearPanelState({ resetTracking = false } = {}) {
		document.querySelectorAll(`.${ROOT_CLASS}`).forEach((element) => element.classList.remove(ROOT_CLASS));
		document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => element.classList.remove(HIDDEN_CLASS));
		document.documentElement.classList.remove(ACTIVE_CLASS);
		document.documentElement.classList.remove(NO_PLAY_CLASS);
		document.documentElement.classList.remove(STREAM_CARDS_CLASS);
		document.documentElement.classList.remove(THEME_CLASS);
		clearStreamHighlights();

		if (resetTracking) {
			lastPanel = null;
			lastRouteKey = '';
			lastKnownScrollTop = 0;
			retryIndex = 0;
		}
	}

	function getHashParts() {
		const hashRoute = (location.hash || '').replace(/^#/, '').split('?')[0];
		return hashRoute.split('/').filter(Boolean);
	}

	function isSeriesRootRoute() {
		const parts = getHashParts();
		return parts[0] === 'detail' && parts[1] === 'series' && parts.length === 3;
	}

	function getRouteKey() {
		const hashRoute = (location.hash || '').replace(/^#/, '').split('?')[0];
		return `${location.pathname}#${hashRoute}`;
	}

	function isUsablePanel(element) {
		if (!element || !(element instanceof HTMLElement)) return false;
		if (!document.documentElement.contains(element)) return false;
		if (element === document.body || element === document.documentElement) return false;

		const className = String(element.className || '').toLowerCase();
		const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
		const hasKnownClass = className.includes('streams-list-container') || className.includes('videos-list-container');

		if (!hasKnownClass) return false;
		if (element.children.length < 1 && text.length < 2) return false;

		return true;
	}

	function findFirstUsable(selectors) {
		for (const selector of selectors) {
			const candidates = Array.from(document.querySelectorAll(selector));
			const usable = candidates.find(isUsablePanel);
			if (usable) return usable;
		}
		return null;
	}

	function findPanelRoot() {
		const streamsPanel = findFirstUsable([
			'[class*="streams-list-container"]',
			'[class*="streams-list"]',
		]);

		const videosPanel = findFirstUsable([
			'[class*="videos-list-container"]',
			'[class*="videos-list"]',
		]);

		return isSeriesRootRoute() ? (videosPanel || streamsPanel) : (streamsPanel || videosPanel);
	}

	function hideEverythingExcept(panelRoot) {
		panelRoot.classList.add(ROOT_CLASS);

		let current = panelRoot;
		while (current && current !== document.body && current !== document.documentElement) {
			const parent = current.parentElement;
			if (!parent) break;

			Array.from(parent.children).forEach((child) => {
				if (child !== current && !child.contains(current)) {
					child.classList.add(HIDDEN_CLASS);
				}
			});

			current = parent;
		}
	}

	function trackPanelScroll(panelRoot) {
		if (!panelRoot || panelRoot.dataset.watchOnStremioScrollTracked === 'true') return;

		panelRoot.dataset.watchOnStremioScrollTracked = 'true';
		panelRoot.addEventListener('scroll', () => {
			lastKnownScrollTop = panelRoot.scrollTop || 0;
		}, { passive: true });
	}

	function clearStreamHighlights() {
		globalThis.CSS?.highlights?.delete(TITLE_HIGHLIGHT);
		globalThis.CSS?.highlights?.delete(SIZE_HIGHLIGHT);
	}

	function getTextRange(element, offsets) {
		if (!element || offsets.end <= offsets.start) return null;
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		let position = 0;
		let started = false;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			const end = position + node.textContent.length;
			if (!started && offsets.start < end) {
				range.setStart(node, offsets.start - position);
				started = true;
			}
			if (started && offsets.end <= end) {
				range.setEnd(node, offsets.end - position);
				return range;
			}
			position = end;
		}
		return null;
	}

	function applyStreamHighlights(panelRoot) {
		if (!globalThis.CineTraktSettings.isEnabled('stremioTraktTheme')) {
			clearStreamHighlights();
			return;
		}
		if (!globalThis.CSS?.highlights || typeof Highlight !== 'function') return;
		const titles = [];
		const sizes = [];
		const formatting = globalThis.CineTraktStreamFormatting;
		panelRoot.querySelectorAll('a[class*="stream-container-"]').forEach((card) => {
			const info = card.querySelector('[class*="addon-name-"]');
			const description = card.querySelector('[class*="description-container-"]');
			const fileSizes = formatting.getFileSizeRanges(info?.textContent);
			// Metadata addons (IMDb, BasedOn, etc.) are not stream titles.
			if (!card.hasAttribute('download') && fileSizes.length === 0) return;
			const title = getTextRange(description, formatting.getTitleRange(description?.textContent));
			if (title) titles.push(title);
			fileSizes.forEach((offsets) => {
				const size = getTextRange(info, offsets);
				if (size) sizes.push(size);
			});
		});
		// Native text nodes and links stay intact, including their tooltip and events.
		CSS.highlights.set(TITLE_HIGHLIGHT, new Highlight(...titles));
		CSS.highlights.set(SIZE_HIGHLIGHT, new Highlight(...sizes));
	}

	function applyPanel() {
		if (!isDetailRoute()) {
			clearPanelState({ resetTracking: true });
			return false;
		}

		injectStyle();

		const panelRoot = findPanelRoot();
		if (!panelRoot) {
			// Très important : si la nouvelle UI n'a pas encore rendu la liste,
			// on ne masque rien. Ça évite la fenêtre blanche.
			clearPanelState();
			return false;
		}

		const routeKey = getRouteKey();
		const routeChanged = routeKey !== lastRouteKey;
		const panelChanged = panelRoot !== lastPanel;
		const shouldResetScroll = routeChanged;
		const shouldRestoreScroll = !routeChanged && panelChanged && lastKnownScrollTop > 0;

		if (routeChanged) {
			clearPanelState();
			lastKnownScrollTop = 0;
		}

		hideEverythingExcept(panelRoot);
		document.documentElement.classList.add(ACTIVE_CLASS);
		document.documentElement.classList.toggle(NO_PLAY_CLASS,
			globalThis.CineTraktSettings.isEnabled('stremioHidePlayIcon'));
		document.documentElement.classList.toggle(STREAM_CARDS_CLASS,
			globalThis.CineTraktSettings.isEnabled('stremioStreamCards'));
		document.documentElement.classList.toggle(THEME_CLASS,
			globalThis.CineTraktSettings.isEnabled('stremioTraktTheme'));
		applyStreamHighlights(panelRoot);
		trackPanelScroll(panelRoot);

		if (shouldResetScroll) {
			panelRoot.scrollTop = 0;
		} else if (shouldRestoreScroll) {
			panelRoot.scrollTop = lastKnownScrollTop;
		}

		lastRouteKey = routeKey;
		lastPanel = panelRoot;

		return true;
	}

	function clearDiscoveryRetry() {
		window.clearTimeout(retryTimer);
		retryTimer = null;
	}

	function scheduleDiscoveryRetry() {
		if (retryTimer !== null || retryIndex >= DISCOVERY_RETRY_DELAYS.length) return;
		const delay = DISCOVERY_RETRY_DELAYS[retryIndex];
		retryIndex += 1;
		retryTimer = window.setTimeout(() => {
			retryTimer = null;
			scheduleApply();
		}, delay);
	}

	function scheduleApply() {
		if (scheduled) return;
		scheduled = true;
		animationFrame = requestAnimationFrame(() => {
			animationFrame = null;
			scheduled = false;
			if (applyPanel()) {
				clearDiscoveryRetry();
				retryIndex = 0;
			} else if (isDetailRoute()) {
				scheduleDiscoveryRetry();
			}
		});
	}

	function start() {
		const observer = new MutationObserver(scheduleApply);
		observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });

		const handleRouteChange = () => {
			clearDiscoveryRetry();
			clearPanelState({ resetTracking: true });
			scheduleApply();
		};
		window.addEventListener('hashchange', handleRouteChange);
		window.addEventListener('popstate', handleRouteChange);
		globalThis.navigation?.addEventListener('currententrychange', handleRouteChange);

		window.addEventListener('resize', scheduleApply, { passive: true });
		window.addEventListener('pagehide', () => {
			observer.disconnect();
			clearDiscoveryRetry();
			if (animationFrame !== null) cancelAnimationFrame(animationFrame);
		}, { once: true });

		scheduleApply();
	}

	globalThis.CineTraktSettings.ready.then(() => {
		if (!globalThis.CineTraktSettings.isEnabled('stremioCompactPanel')) return;
		start();
	});
})();
