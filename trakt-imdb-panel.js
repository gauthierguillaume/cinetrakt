(() => {
	'use strict';
	const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;
	const ratings = globalThis.CineTraktRatingUtils;
	const { normalizeSnapshot, buildTableModel } = globalThis.CineTraktEpisodeRatings;
	const seasonCards = globalThis.CineTraktSeasonCards;
	let current = null;
	let nextRequest = 0;

	function ensureStyles() {
		if (document.getElementById('cinetrakt-imdb-panel-styles')) return;
		const style = document.createElement('style');
		style.id = 'cinetrakt-imdb-panel-styles';
		style.textContent = `
			.trakt-drawer.cinetrakt-imdb-panel-active { width: min(var(--cinetrakt-imdb-panel-width, 400px), calc(100vw - 32px)) !important; max-width: 100vw !important; }
			.cinetrakt-imdb-panel-active .trakt-drawer-title > :not(.cinetrakt-imdb-panel-title),
			.cinetrakt-imdb-panel-active .trakt-drawer-content > :not(.cinetrakt-imdb-panel-content) { display: none !important; }
			.cinetrakt-imdb-panel-active .trakt-drawer-content { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
			.cinetrakt-imdb-panel-content { display: flex; flex-direction: column; flex: 1; min-height: 0; gap: 12px; }
			.cinetrakt-imdb-panel-retry { align-self: flex-start; flex-shrink: 0; appearance: none; border: 0; background: transparent; color: var(--color-text-secondary, #a09ba6); font: inherit; font-size: 12px; cursor: pointer; padding: 4px 0; }
			.cinetrakt-imdb-panel-retry:hover { color: var(--cinetrakt-accent-text, #a699ff); }
			.cinetrakt-imdb-panel-status { color: var(--color-text-secondary, #a09ba6); font-size: 14px; padding: 16px 0; }
			.cinetrakt-imdb-panel-status[hidden], .cinetrakt-imdb-panel-retry[hidden] { display: none; }
			.cinetrakt-imdb-panel-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; border-radius: var(--border-radius-m, 12px); }
			.cinetrakt-imdb-panel-table { --season-surface: rgba(255,255,255,.035); --season-border: rgba(166,153,255,.16); border-collapse: separate; border-spacing: 8px 0; table-layout: fixed; width: max-content; margin: 0; font-variant-numeric: tabular-nums; }
			.cinetrakt-imdb-panel-table th, .cinetrakt-imdb-panel-table td { box-sizing: border-box; min-width: 116px; width: 116px; padding: 4px 7px; text-align: center; border: 0; }
			.cinetrakt-imdb-panel-table td, .cinetrakt-imdb-panel-table .cinetrakt-season-heading { background: var(--season-surface); border-inline: 1px solid var(--season-border); }
			.cinetrakt-imdb-panel-table th { font-size: 12px; color: var(--color-text-secondary, #a09ba6); font-weight: 600; white-space: nowrap; }
			.cinetrakt-imdb-panel-table thead { position: sticky; top: 0; z-index: 2; background: var(--color-background, #17151d); }
			.cinetrakt-imdb-panel-table thead th { height: 32px; }
			.cinetrakt-imdb-panel-table .cinetrakt-season-heading { border-top: 1px solid var(--season-border); border-radius: 8px 8px 0 0; padding: 8px 7px 10px; color: var(--color-text-primary, #f8f7fa); }
			.cinetrakt-imdb-season-card { display: block; width: 100px; position: relative; color: inherit; text-decoration: none; white-space: normal; text-align: left; font-weight: 500; }
			.cinetrakt-imdb-panel-table .cinetrakt-season-poster { display: block; position: relative; width: 100px; height: 150px; margin: 0; border-radius: var(--border-radius-card, 8px); overflow: hidden; background: rgba(0,0,0,.25); color: var(--color-text-secondary, #a09ba6); line-height: 150px; text-align: center; font-size: 20px; }
			.cinetrakt-season-poster img { display: block; position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
			.cinetrakt-imdb-season-card-label { display: block; padding-top: 10px; font: 500 12px/16px var(--font-family, Roboto, Arial, sans-serif); }
			.cinetrakt-imdb-season-card-subtitle { display: block; color: var(--color-text-secondary, #a09ba6); font: 500 12px/16px var(--font-family, Roboto, Arial, sans-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.cinetrakt-season-watched { display: flex; align-items: center; justify-content: center; position: absolute; top: 142px; left: 38px; width: 24px; height: 16px; border-radius: 24px; background: var(--color-background-indicator-tag, #f8f7fa); color: var(--color-text-indicator-tag, #39363d); }
			.cinetrakt-season-watched svg { width: 12.5px; height: 12.5px; }
			.cinetrakt-season-watched[data-indicator="partial"] { background: linear-gradient(to right, var(--color-background-indicator-tag, #f8f7fa) 50%, var(--color-background-indicator-remainder-tag, #88838e) 50%); }
			.cinetrakt-season-watched[hidden], .cinetrakt-imdb-season-card-subtitle[hidden] { display: none; }
			.cinetrakt-imdb-panel-table a.cinetrakt-imdb-season-card:hover { outline: none; }
			.cinetrakt-imdb-season-card:hover .cinetrakt-season-poster, .cinetrakt-imdb-season-card:focus-visible .cinetrakt-season-poster { outline: 2px solid var(--cinetrakt-accent-text, #a699ff); outline-offset: 0; }
			.cinetrakt-imdb-panel-table tbody tr:last-child td { border-bottom: 1px solid var(--season-border); border-radius: 0 0 8px 8px; padding-bottom: 8px; }
			.cinetrakt-imdb-panel-table tbody th { position: sticky; left: 0; background: var(--color-background, #17151d); z-index: 1; }
			.cinetrakt-imdb-panel-table .cinetrakt-episode-score { display: flex; align-items: center; justify-content: center; width: 100px; height: 40px; border-radius: 6px; font-size: 18px; font-weight: 650; text-decoration: none; }
			.cinetrakt-imdb-panel-table a:hover { outline: 2px solid var(--cinetrakt-accent-text, #a699ff); outline-offset: 1px; }
			.cinetrakt-imdb-panel-table a:focus-visible { outline: 2px solid var(--cinetrakt-accent-focus, #a699ff); outline-offset: 1px; }
			.cinetrakt-imdb-panel-table .cinetrakt-episode-average { font-size: 18px; font-weight: 650; height: 44px; border-bottom: 1px solid var(--season-border); }
			.cinetrakt-imdb-panel-table .cinetrakt-episode-average-label { white-space: normal; line-height: 1.25; }
			.cinetrakt-imdb-panel-table .cinetrakt-episode-empty { color: var(--color-text-secondary, #a09ba6); opacity: .45; }
		`;
		document.head.appendChild(style);
	}

	function cleanup() {
		if (!current) return;
		const state = current; current = null;
		state.observer?.disconnect();
		window.clearTimeout(state.timer);
		window.clearTimeout(state.watchedTimer);
		window.removeEventListener('pagehide', cleanup);
		document.removeEventListener('click', handleNativeRatingsClick, true);
		state.drawer?.classList.remove('cinetrakt-imdb-panel-active');
		state.drawer?.style.removeProperty('--cinetrakt-imdb-panel-width');
		if (state.requestId) send({ type: MESSAGE_TYPES.CANCEL_IMDB_EPISODES, imdbId: state.imdbId, requestId: state.requestId });
		state.title?.remove(); state.content?.remove();
	}

	function sync(enabled = true) {
		if (!current) return;
		if (!enabled || window.location.pathname !== current.route
			|| (current.drawer && (!current.drawer.isConnected || !current.content.isConnected
				|| new URLSearchParams(window.location.search).get('view') !== 'ratings'))) cleanup();
	}

	function handleNativeRatingsClick(event) {
		// A normal click on Trakt's arrow must still show its original ratings.
		if (event.isTrusted && event.target.closest?.('a[aria-label="View ratings breakdown"]')) cleanup();
	}

	function send(message, callback) {
		try {
			chrome.runtime.sendMessage(message, response => {
				const error = chrome.runtime.lastError;
				callback?.(error ? null : response);
			});
		} catch { callback?.(null); }
	}

	function render(state, snapshot) {
		const model = buildTableModel(snapshot, ratings, 116);
		const score = (value, average = false) => {
			const style = ratings.getStyleForRating(value);
			return style ? `style="${average ? 'color' : 'background'}:${style.bg};${average ? '' : `color:${style.text};`}"` : '';
		};
		const table = document.createElement('table'); table.className = 'cinetrakt-imdb-panel-table';
		table.setAttribute('aria-label', 'Notes IMDb par saison et épisode');
		table.innerHTML = `<thead><tr><th scope="col" aria-label="Épisodes"></th>${model.seasons.map(s => `<th scope="col" class="cinetrakt-season-heading"><a class="cinetrakt-imdb-season-card" data-sveltekit-noscroll data-sveltekit-keepfocus data-sveltekit-replacestate href="${seasonCards.seasonHref(state.route, s.number)}"><span class="cinetrakt-season-poster" data-season-poster="${s.number}" aria-hidden="true">—</span><span class="cinetrakt-season-watched" hidden></span><span class="cinetrakt-imdb-season-card-label">${s.number === 0 ? 'Specials' : `Season ${s.number}`}</span><span class="cinetrakt-imdb-season-card-subtitle" hidden></span></a></th>`).join('')}</tr>
			<tr><th scope="row" class="cinetrakt-episode-average-label">Moyenne<br>par saison</th>${model.seasons.map(s => `<td class="cinetrakt-episode-average" ${score(s.average, true)}>${s.average == null ? '—' : ratings.formatRating(s.average)}</td>`).join('')}</tr></thead>
			<tbody>${Array.from({ length: model.episodeCount }, (_, i) => {
				const episode = i + 1;
				return `<tr><th scope="row">E${episode}</th>${model.seasons.map(s => {
					const item = s.episodes.get(episode);
					if (!item) return '<td class="cinetrakt-episode-empty" aria-label="Aucun épisode">—</td>';
					const label = item.rating == null ? 'Pas de note' : ratings.formatRating(item.rating);
					return `<td><a class="cinetrakt-episode-score" href="https://www.imdb.com/title/${item.imdbId}/" target="_blank" rel="noopener noreferrer" aria-label="Saison ${s.number}, épisode ${episode} : ${label}" ${score(item.rating)}>${item.rating == null ? '—' : label}</a></td>`;
				}).join('')}</tr>`;
			}).join('')}</tbody>`;
		state.scroll.replaceChildren(table);
		state.table = table;
		applyPosters(state);
		state.drawer.style.setProperty('--cinetrakt-imdb-panel-width', `${model.width}px`);
		state.status.hidden = snapshot.complete;
		state.retry.hidden = snapshot.complete;
		if (!snapshot.complete) state.status.textContent = `Chargement partiel : ${snapshot.episodes.length} épisodes sur ${snapshot.totalEpisodes}. Les moyennes attendent le tableau complet.`;
	}

	function applyPosters(state) {
		if (!state.table) return;
		for (const slot of state.table.querySelectorAll('[data-season-poster]')) {
			const number = Number(slot.dataset.seasonPoster);
			const card = slot.closest('.cinetrakt-imdb-season-card');
			const subtitle = card.querySelector('.cinetrakt-imdb-season-card-subtitle');
			const title = state.details?.[number]?.title;
			subtitle.textContent = typeof title === 'string' ? title : ''; subtitle.hidden = !subtitle.textContent;
			card.title = subtitle.textContent;
			const badge = card.querySelector('.cinetrakt-season-watched');
			const watched = seasonCards.watchedStatus(state.details?.[number]?.aired, state.watched?.get(number));
			badge.hidden = !watched;
			badge.setAttribute('aria-label', watched === 'watched' ? 'Saison vue' : 'Saison partiellement vue');
			badge.dataset.indicator = watched;
			badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.5166 3.15137L8.94531 16.9404L12.0098 19.5117L10.7246 21.0439L0 12.0449L1.28516 10.5127L7.41309 15.6553L18.9844 1.86523L20.5166 3.15137ZM23.5801 5.72168L13.2949 17.9785L11.7637 16.6924L22.0479 4.43652L23.5801 5.72168ZM8.45312 11.3057L7.16699 12.8379L2.57129 8.98145L3.85645 7.44922L8.45312 11.3057Z"/></svg>';
			const url = globalThis.CineTraktSeasonRatings.normalizeSeasonPosterUrl(state.posters?.[number]);
			if (!url || slot.querySelector('img')) continue;
			const image = document.createElement('img');
			image.width = 100; image.height = 150; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
			image.addEventListener('error', () => { image.remove(); slot.title = 'Affiche indisponible'; }, { once: true });
			image.src = url; slot.appendChild(image);
		}
	}

	function loadPosters(state) {
		send({ type: MESSAGE_TYPES.GET_SHOW_SEASON_RATINGS, pathname: state.route }, response => {
			sync(); if (current !== state || !response?.ok) return;
			state.posters = response.posters;
			state.details = response.details;
			applyPosters(state);
		});
	}

	async function loadWatched(state, retry = true) {
		const watched = await seasonCards.readWatched(state.route);
		if (current !== state) return;
		state.watched = watched; applyPosters(state);
		if (!watched && retry) state.watchedTimer = window.setTimeout(() => loadWatched(state, false), 1500);
	}

	function load(state) {
		if (current !== state || state.requestId) return;
		const requestId = String(++nextRequest); state.requestId = requestId;
		state.status.hidden = false; state.retry.hidden = true;
		state.status.textContent = 'Chargement des notes IMDb…';
		send({ type: MESSAGE_TYPES.GET_IMDB_EPISODES, imdbId: state.imdbId, requestId }, response => {
			sync(); if (current !== state || state.requestId !== requestId) return;
			state.requestId = null;
			const data = response?.ok && normalizeSnapshot(response.data, state.imdbId);
			if (data) { render(state, data); return; }
			state.retry.hidden = false;
			state.status.textContent = response?.error === 'verification'
				? 'IMDb demande une vérification. Ouvrez IMDb dans un onglet, puis réessayez.'
				: 'Les notes IMDb ne sont pas disponibles pour le moment. Vous pouvez réessayer.';
		});
	}

	function mount(state) {
		if (state !== current || window.location.pathname !== state.route) return false;
		if (state.drawer) return true;
		const nativeContent = document.querySelector('.trakt-drawer .trakt-ratings-drawer-content');
		const drawer = nativeContent?.closest('.trakt-drawer');
		const titleHost = drawer?.querySelector('.trakt-drawer-title');
		const contentHost = drawer?.querySelector('.trakt-drawer-content');
		if (!titleHost || !contentHost) return false;
		state.observer.disconnect(); window.clearTimeout(state.timer);
		state.drawer = drawer;
		// Preserve Trakt's real heading element classes and native typography.
		state.title = titleHost.querySelector('h1')?.cloneNode(false) || document.createElement('h1');
		state.title.classList.add('cinetrakt-imdb-panel-title'); state.title.textContent = 'IMDb Ratings';
		state.content = document.createElement('div'); state.content.className = 'cinetrakt-imdb-panel-content';
		state.retry = document.createElement('button'); state.retry.type = 'button'; state.retry.className = 'cinetrakt-imdb-panel-retry';
		state.retry.textContent = 'Réessayer'; state.retry.hidden = true;
		state.retry.addEventListener('click', () => load(state));
		state.status = document.createElement('p'); state.status.className = 'cinetrakt-imdb-panel-status';
		state.status.setAttribute('role', 'status'); state.status.textContent = 'Chargement du tableau IMDb…';
		state.scroll = document.createElement('div'); state.scroll.className = 'cinetrakt-imdb-panel-scroll';
		state.scroll.tabIndex = 0; state.scroll.setAttribute('aria-label', 'Tableau des épisodes IMDb');
		state.content.append(state.status, state.retry, state.scroll);
		titleHost.appendChild(state.title); contentHost.appendChild(state.content);
		drawer.classList.add('cinetrakt-imdb-panel-active');
		state.observer = new MutationObserver(() => sync());
		state.observer.observe(document.body, { childList: true });
		loadPosters(state);
		loadWatched(state);
		load(state);
		return true;
	}

	function open(imdbId) {
		if (!/^tt\d{7,}$/.test(imdbId)) return false;
		const trigger = document.querySelector('a[aria-label="View ratings breakdown"]');
		if (!trigger) return false;
		if (current?.imdbId === imdbId && current.route === window.location.pathname) return true;
		cleanup(); ensureStyles();
		const state = { imdbId, route: window.location.pathname };
		current = state;
		state.observer = new MutationObserver(() => mount(state));
		state.observer.observe(document.body, { childList: true, subtree: true });
		state.timer = window.setTimeout(cleanup, 4000);
		window.addEventListener('pagehide', cleanup, { once: true });
		document.addEventListener('click', handleNativeRatingsClick, true);
		if (!mount(state)) trigger.click();
		return true;
	}

	globalThis.CineTraktImdbPanel = Object.freeze({ open, sync, cleanup });
})();
