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
	const CHECK_INTERVAL_MS = 250;
	const STOP_AFTER_MS = 45000;

	let lastUrl = '';
	let lastPanel = null;
	let lastRouteKey = '';
	let lastKnownScrollTop = 0;
	let scheduled = false;

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

		if (resetTracking) {
			lastUrl = '';
			lastPanel = null;
			lastRouteKey = '';
			lastKnownScrollTop = 0;
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

		const currentUrl = location.href;
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
		trackPanelScroll(panelRoot);

		if (shouldResetScroll) {
			panelRoot.scrollTop = 0;
		} else if (shouldRestoreScroll) {
			panelRoot.scrollTop = lastKnownScrollTop;
		}

		lastUrl = currentUrl;
		lastRouteKey = routeKey;
		lastPanel = panelRoot;

		return true;
	}

	function scheduleApply() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			applyPanel();
		});
	}

	function start() {
		let intervalId = null;
		let stopTimeoutId = null;

		const observer = new MutationObserver(scheduleApply);
		observer.observe(document.documentElement, { childList: true, subtree: true });

		window.addEventListener('hashchange', () => {
			clearPanelState({ resetTracking: true });
			scheduleApply();
		});

		window.addEventListener('resize', scheduleApply, { passive: true });

		applyPanel();
		intervalId = window.setInterval(applyPanel, CHECK_INTERVAL_MS);
		stopTimeoutId = window.setTimeout(() => {
			window.clearInterval(intervalId);
			window.clearTimeout(stopTimeoutId);
		}, STOP_AFTER_MS);
	}

	start();
})();
