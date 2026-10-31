(() => {
	'use strict';
	const LEFT_FADE_WIDTH = 72;
	let current = null;
	function targetForRoute(route) {
		const match = /^\/(movies|shows)\/([^/?#]+)\/?$/.exec(route);
		return match ? { kind: match[1], query: `query:${match[1] === 'movies' ? 'movie' : 'show'}Summary:v2`, dependency: `dependency:${match[2]}` } : null;
	}
	function fanartFromEntry(entry, route, now = Date.now()) {
		const target = targetForRoute(route);
		if (!target || !Array.isArray(entry?.queryKey) || !entry.queryKey.includes(target.query) || !entry.queryKey.includes(target.dependency)
			|| entry.state?.status !== 'success' || !Number.isFinite(entry.state.dataUpdatedAt)
			|| now < entry.state.dataUpdatedAt) return '';
		try {
			const url = new URL(entry.state.data?.cover?.url?.medium);
			if (url.origin !== 'https://media.trakt.tv' || url.username || url.password || url.search || url.hash
				|| !new RegExp(`^/images/${target.kind}/\\d{3}/\\d{3}/\\d{3}/fanarts/(?:original|medium|thumb)/[a-z0-9_.-]+$`, 'i').test(url.pathname)) return '';
			url.pathname = url.pathname.replace('/thumb/', '/medium/');
			return url.href;
		} catch { return ''; }
	}
	// Reuse only this fiche's public, native summary cache. No additional API
	// requests, credentials, unrelated query values, or writes to Trakt storage.
	function readFanart(route, idb = globalThis.indexedDB) {
		const target = targetForRoute(route);
		if (!target || !idb) return Promise.resolve('');
		return new Promise(resolve => {
			let db, transaction, done = false;
			const finish = result => { if (done) return; done = true; clearTimeout(timeout); db?.close(); resolve(result); };
			const timeout = setTimeout(() => { try { transaction?.abort(); } catch {} finish(''); }, 1500);
			try {
				const opened = idb.open('trakt-query');
				opened.onupgradeneeded = () => { opened.transaction.abort(); finish(''); };
				opened.onerror = opened.onblocked = () => finish('');
				opened.onsuccess = () => {
					db = opened.result;
					if (done) { db.close(); return; }
					if (!db.objectStoreNames.contains('query-cache')) { finish(''); return; }
					transaction = db.transaction('query-cache', 'readonly'); const store = transaction.objectStore('query-cache');
					let image = '', newest = -1;
					const keys = store.getAllKeys();
					keys.onsuccess = () => {
						for (const key of keys.result.filter(k => typeof k === 'string' && k.includes(JSON.stringify(target.query))
							&& k.includes(JSON.stringify(target.dependency))).slice(0, 8)) {
							const request = store.get(key);
							request.onsuccess = () => {
								const url = fanartFromEntry(request.result, route);
								const at = request.result?.state?.dataUpdatedAt;
								if (url && at > newest) { image = url; newest = at; }
							};
						}
					};
					transaction.oncomplete = () => finish(image);
					transaction.onerror = transaction.onabort = () => finish('');
				};
			} catch { finish(''); }
		});
	}
	function ensureStyles() {
		if (document.getElementById('cinetrakt-fanart-style')) return;
		const style = document.createElement('style'); style.id = 'cinetrakt-fanart-style';
		style.textContent = `
			.cinetrakt-detail-fanart { display: none; pointer-events: none; user-select: none; }
			body.cinetrakt-fanart-active { isolation: isolate; }
			html.cinetrakt-poster-layout-enabled:not(.cinetrakt-poster-layout-compact) body > .cinetrakt-detail-fanart {
				display: block; position: fixed; z-index: -1; top: 0; right: 0; bottom: 0; overflow: hidden; opacity: .5;
				mask-image: linear-gradient(90deg, transparent, #000 ${LEFT_FADE_WIDTH}px);
			}
			.cinetrakt-detail-fanart img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center top; }
			.cinetrakt-detail-fanart::after {
				content: ''; position: absolute; inset: 0;
				background: rgba(0,0,0,.35);
			}
		`;
		document.head.appendChild(style);
	}
	function cleanup() {
		if (!current) return;
		const state = current; current = null;
		window.clearTimeout(state.timer);
		state.resizeObserver?.disconnect();
		state.image?.removeAttribute('src'); state.layer?.remove();
		state.main.classList.remove('cinetrakt-fanart-ready');
		document.body.classList.remove('cinetrakt-fanart-active');
	}
	function align(state) {
		const left = state.main.querySelector('.cinetrakt-sticky-poster-stage')?.getBoundingClientRect().right;
		if (!Number.isFinite(left) || left <= 0) return false;
		// Finish the fade at the poster edge, so the title and all content to
		// its right sit over an evenly visible image, not the transition.
		state.layer.style.left = `${Math.max(0, left - LEFT_FADE_WIDTH)}px`;
		return true;
	}
	function mount(state) {
		if (!state.loaded || state.mounted || !align(state)) return;
		// A fixed body layer must wait for the poster's right edge, but its metadata
		// and image can load in parallel with the poster's layout preparation.
		document.body.appendChild(state.layer); state.mounted = true;
		state.main.classList.add('cinetrakt-fanart-ready'); document.body.classList.add('cinetrakt-fanart-active');
		if (typeof ResizeObserver === 'function') {
			state.resizeObserver = new ResizeObserver(() => { if (current === state) align(state); });
			state.resizeObserver.observe(state.main);
		}
	}
	async function load(state, attempt = 0) {
		const url = await readFanart(state.route);
		if (current !== state || state.overridden || window.location.pathname !== state.route || !state.main.isConnected) return;
		if (!url) {
			// Trakt can persist its successful query after the visible summary.
			// Check early, then allow that delayed write without giving up at 3s.
			if (attempt < 14) state.timer = window.setTimeout(() => load(state, attempt + 1), attempt < 2 ? 250 : 1000);
			return;
		}
		const layer = document.createElement('div'); layer.className = 'cinetrakt-detail-fanart'; layer.setAttribute('aria-hidden', 'true');
		const image = document.createElement('img'); image.alt = ''; image.decoding = 'async'; image.draggable = false; image.fetchPriority = 'high';
		state.layer = layer; state.image = image;
		image.addEventListener('load', () => {
			if (current !== state || state.image !== image || window.location.pathname !== state.route || !state.main.isConnected) return;
			// Main has layout containment for responsive lists, which would anchor
			// a fixed child to the scrolling page. Keep this viewport layer on body.
			state.loaded = true; mount(state);
		}, { once: true });
		image.addEventListener('error', () => {
			if (current !== state || state.image !== image) return;
			// Keep this route settled on failure, rather than retrying the same
			// broken image on every native DOM update.
			layer.remove(); if (current === state) state.main.classList.remove('cinetrakt-fanart-ready');
		}, { once: true });
		layer.appendChild(image); image.src = url;
	}
	function setOverride(route, image) {
		const state = current;
		if (!state || state.route !== route || window.location.pathname !== route || !state.main.isConnected
			|| !image?.complete || !image.naturalWidth
			|| !/^https:\/\/image\.tmdb\.org\/t\/p\/original\/[a-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(image.src)) return false;
		window.clearTimeout(state.timer); state.overridden = true;
		if (!state.layer) {
			state.layer = document.createElement('div'); state.layer.className = 'cinetrakt-detail-fanart';
			state.layer.setAttribute('aria-hidden', 'true');
		}
		state.image?.removeAttribute('src');
		state.layer.replaceChildren(image); state.image = image; state.loaded = true;
		mount(state); return true;
	}
	function update(enabled) {
		const route = window.location.pathname;
		const main = enabled && targetForRoute(route) && document.querySelector('main:has(.trakt-summary-container)');
		if (current && (!main || current.route !== route || current.main !== main)) cleanup();
		if (!main) return;
		if (current) { mount(current); return; }
		ensureStyles(); current = { route, main }; load(current);
	}
	const api = Object.freeze({ update, cleanup, readFanart, fanartFromEntry, setOverride });
	globalThis.CineTraktTraktFanart = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
