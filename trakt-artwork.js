(() => {
	'use strict';
	const artwork = globalThis.CineTraktTmdbArtwork;
	let current = null;
	const icons = {
		posters: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="m8 16 4-5 4 5M8 6h8"/>',
		backdrops: '<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m3 18 6-6 4 4 3-5 6 7"/>',
	};
	function styles() {
		if (document.getElementById('cinetrakt-artwork-style')) return;
		const style = document.createElement('style'); style.id = 'cinetrakt-artwork-style';
		style.textContent = `
			.cinetrakt-artwork-tools { position:absolute; top:10px; right:10px; display:flex; gap:6px; z-index:8; opacity:0; pointer-events:none; transition:opacity .12s; }
			.trakt-summary-poster:hover > .cinetrakt-artwork-tools, .cinetrakt-artwork-tools:focus-within { opacity:1; pointer-events:auto; }
			.cinetrakt-artwork-tools button { display:grid; place-items:center; width:32px; height:32px; padding:6px; border:1px solid #ffffff30; border-radius:8px; background:#111015da; color:#fff; cursor:pointer; }
			.cinetrakt-artwork-tools button:hover, .cinetrakt-artwork-tools button:focus-visible { border-color:var(--cinetrakt-accent); color:var(--cinetrakt-accent); outline:none; }
			.cinetrakt-artwork-tools button:disabled { opacity:.5; cursor:wait; }
			.cinetrakt-artwork-tools svg { width:20px; height:20px; fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
			.cinetrakt-poster-variant { position:absolute!important; inset:0!important; width:100%!important; height:100%!important; object-fit:cover!important; pointer-events:none!important; z-index:2; border-radius:var(--cinetrakt-poster-border-radius,24px); }
			.cinetrakt-artwork-notice { position:absolute; right:0; top:40px; width:max-content; max-width:240px; padding:8px 10px; border-radius:8px; background:#111015ed; color:#fff; font:13px/1.4 system-ui,sans-serif; pointer-events:none; }
			.cinetrakt-artwork-notice:empty { display:none; }
			@media (hover:none) { .cinetrakt-artwork-tools { opacity:1; pointer-events:auto; } }
		`;
		document.head.appendChild(style);
	}
	function live(state) { return current === state && state.poster.isConnected && window.location.pathname === state.route; }
	function notify(state, text) {
		if (!live(state)) return;
		clearTimeout(state.noticeTimer); state.notice.textContent = text;
		state.noticeTimer = setTimeout(() => { state.notice.textContent = ''; }, 5000);
	}
	function catalog(state) {
		if (!state.catalog) state.catalog = new Promise((resolve, reject) => {
			try {
				chrome.runtime.sendMessage({ type: globalThis.CineTraktExtensionProtocol.MESSAGE_TYPES.GET_DETAIL_ARTWORK, pathname: state.route }, result => {
					if (chrome.runtime.lastError || !result?.ok) { reject(new Error(result?.error || 'network')); return; }
					resolve(result);
				});
			} catch { reject(new Error('network')); }
		}).then(result => {
			state.pools = { posters: artwork.createPool(result.posters), backdrops: artwork.createPool(result.backdrops) };
			return result;
		}).catch(error => { state.catalog = null; throw error; });
		return state.catalog;
	}
	function preload(state, path) {
		return new Promise((resolve, reject) => {
			const image = document.createElement('img'); image.alt = ''; image.decoding = 'async';
			image.draggable = false; image.referrerPolicy = 'no-referrer';
			const finish = (error) => {
				clearTimeout(timer); image.onload = image.onerror = null; state.pending.delete(cancel);
				if (error) { image.removeAttribute('src'); reject(new Error('image')); } else resolve(image);
			};
			const cancel = () => finish(true);
			const timer = setTimeout(cancel, 15000); state.pending.add(cancel);
			image.onload = () => finish(false); image.onerror = cancel;
			image.src = artwork.IMAGE_BASE + path;
		});
	}
	async function change(state, kind) {
		if (!live(state) || state.buttons[kind].disabled) return;
		const button = state.buttons[kind]; button.disabled = true; button.setAttribute('aria-busy', 'true');
		try {
			if (kind === 'backdrops' && document.documentElement.classList.contains('cinetrakt-poster-layout-compact')) {
				notify(state, 'Le fond est disponible dans la mise en page Grande affiche.'); return;
			}
			const result = await catalog(state);
			if (!live(state)) return;
			const path = state.pools[kind].next(state.selected[kind]);
			if (!path) {
				notify(state, kind === 'posters' ? `Aucune autre affiche disponible en ${result.language.toUpperCase()}.` : 'Aucun autre fond sans texte disponible.'); return;
			}
			const image = await preload(state, path);
			if (!live(state)) return;
			if (kind === 'posters') {
				image.className = 'cinetrakt-poster-variant'; state.posterImage?.remove();
				state.poster.appendChild(image); state.posterImage = image;
			} else if (!globalThis.CineTraktTraktFanart?.setOverride(state.route, image)) {
				throw new Error('image');
			}
			state.selected[kind] = path;
			state.notice.textContent = '';
		} catch (error) {
			const messages = {
				'missing-credential': 'Ajoute ta clé TMDB dans les réglages CineTrakt, rubrique Nouvel onglet.',
				credential: 'La clé TMDB est refusée. Vérifie-la dans les réglages CineTrakt.',
				'no-id': 'Cette fiche ne possède pas de référence TMDB disponible.',
				image: 'Impossible de charger cette image. Tu peux réessayer.',
			};
			notify(state, messages[error.message] || 'TMDB est indisponible pour le moment. Tu peux réessayer.');
		} finally { button.disabled = false; button.removeAttribute('aria-busy'); }
	}
	function cleanup({ restore = true } = {}) {
		if (!current) return;
		const state = current; current = null;
		clearTimeout(state.noticeTimer); for (const cancel of [...state.pending]) cancel();
		state.tools.remove(); state.posterImage?.remove();
		if (restore && state.selected.backdrops && window.location.pathname === state.route) {
			globalThis.CineTraktTraktFanart?.cleanup();
			globalThis.CineTraktTraktFanart?.update(globalThis.CineTraktSettings?.isEnabled('traktPosterLayout') !== false);
		}
	}
	function update(enabled) {
		const route = window.location.pathname;
		const poster = enabled && /^\/(movies|shows)\/[^/]+\/?$/.test(route) && document.querySelector('.trakt-summary-poster:has(img)');
		if (current && (!poster || current.route !== route || current.poster !== poster)) cleanup();
		if (!poster || current) return;
		styles();
		const tools = document.createElement('div'); tools.className = 'cinetrakt-artwork-tools';
		const notice = document.createElement('span'); notice.className = 'cinetrakt-artwork-notice'; notice.setAttribute('role', 'status');
		const state = { route, poster, tools, notice, buttons: {}, selected: {}, pending: new Set() }; current = state;
		for (const kind of ['posters', 'backdrops']) {
			const button = document.createElement('button'); button.type = 'button';
			button.title = kind === 'posters' ? 'Autre affiche TMDB (aléatoire)' : 'Autre fond TMDB (sans texte, aléatoire)';
			button.setAttribute('aria-label', button.title);
			button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[kind]}</svg>`;
			button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void change(state, kind); });
			state.buttons[kind] = button; tools.appendChild(button);
		}
		tools.appendChild(notice); poster.appendChild(tools);
	}
	globalThis.CineTraktTraktArtwork = Object.freeze({ update, cleanup });
})();
