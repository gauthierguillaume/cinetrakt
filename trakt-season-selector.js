(() => {
	'use strict';
	let state = null, requested = false, observer = null, failedRoute = '';
	const HOST_ID = 'cinetrakt-season-selector';
	const LANDSCAPE = 'svelte-css-wrapper[style*="--height-landscape-list"] section.section-list-container';

	function cleanup() {
		observer?.disconnect(); observer = null;
		document.documentElement.classList.remove('cinetrakt-season-posters-enabled');
		if (!state) return;
		state.episodes?.classList.remove('cinetrakt-season-episodes-replaced');
		state.dispose?.(); state.host.remove(); state = null;
	}

	function attach() {
		if (!state) return;
		const main = document.querySelector('main');
		const episodes = main?.querySelector(LANDSCAPE);
		if (!episodes) return;
		const href = episodes.querySelector('a[href]')?.getAttribute('href');
		if (href && new URL(href, 'https://app.trakt.tv').pathname !== state.route) return;
		// The native action menu can mount after its header. Its temporary
		// absence must not be mistaken for a single-season show.
		if (!episodes.querySelector('[role="combobox"]')) return;
		if (state.episodes === episodes) return;
		state.episodes?.classList.remove('cinetrakt-season-episodes-replaced');
		let before = episodes;
		while (before.parentElement && before.parentElement !== main) before = before.parentElement;
		// The frame lives in a stable body portal: moving its empty layout host
		// cannot reload the native app already loading in parallel.
		main.insertBefore(state.host, before); state.host.hidden = false;
		state.episodes = episodes; episodes.classList.add('cinetrakt-season-episodes-replaced');
		state.dispose?.refresh?.();
		observer?.disconnect(); observer = null;
	}

	function update(enabled) {
		requested = Boolean(enabled);
		if (!requested) failedRoute = '';
		const route = window.location.pathname;
		if (!requested || !/^\/shows\/[^/]+\/?$/.test(route) || window.innerWidth <= 768 || failedRoute === route) { cleanup(); return; }
		if (state && (state.route !== route || !state.host.isConnected || (state.episodes && !state.episodes.isConnected))) cleanup();
		document.documentElement.classList.add('cinetrakt-season-posters-enabled');
		if (!document.body) {
			if (!observer) { observer = new MutationObserver(() => update(requested)); observer.observe(document.documentElement, { childList: true, subtree: true }); }
			return;
		}
		const season = new URLSearchParams(window.location.search).get('season');
		if (state) { state.dispose?.setSeason?.(season); attach(); return; }
		observer?.disconnect(); observer = null;
		const host = document.createElement('section'); host.id = HOST_ID; host.hidden = true;
		host.setAttribute('aria-label', 'Seasons');
		const body = document.createElement('div'); body.className = 'cinetrakt-native-section-body';
		body.style.height = 'calc(var(--height-poster-list-sm, 260px) + var(--ni-40, 40px) + var(--list-header-gap, 6px) + 10px)';
		host.appendChild(body); document.body.appendChild(host);
		const next = { route, episodes: null, host, dispose: null }; state = next;
		next.dispose = globalThis.CineTraktNativeSection.mount({ host: body, kind: 'seasons', route, title: 'Seasons', season, portal: true,
			onReady() { if (state === next) attach(); },
			onUnavailable() { if (state === next) { failedRoute = route; cleanup(); } },
		});
		attach();
		if (state === next && !next.episodes) {
			observer = new MutationObserver(attach);
			observer.observe(document.documentElement, { childList: true, subtree: true });
		}
	}

	const resize = () => update(requested);
	window.addEventListener('resize', resize, { passive: true });
	window.addEventListener('pagehide', () => { cleanup(); window.removeEventListener('resize', resize); }, { once: true });
	globalThis.CineTraktSettings?.ready.then(values => update(values.traktSeasonPosters));
	globalThis.CineTraktSeasonSelector = Object.freeze({ update, cleanup });
})();
