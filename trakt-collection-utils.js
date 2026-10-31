(() => {
	'use strict';

	function isOfficialMovieCollection({ href, title, variant, owner }) {
		if (variant !== 'official' || !/^@?Trakt$/i.test(String(owner || '').trim())) return false;
		let url;
		try { url = new URL(href, 'https://app.trakt.tv'); } catch { return false; }
		if (url.origin !== 'https://app.trakt.tv' && url.origin !== 'https://trakt.tv') return false;
		// Official editorial lists share the same card variant and owner. Require the
		// collection identity in both its canonical list path and its displayed title.
		// Trakt may append the numeric list ID to an otherwise identical collection slug.
		return /^\/lists\/official\/[a-z0-9]+(?:-[a-z0-9]+)*-collection(?:-\d+)?\/?$/i.test(url.pathname)
			&& /\bCollection\s*$/i.test(String(title || '').trim());
	}

	function findUniqueOfficialMovieCollection(candidates) {
		const matches = candidates.filter(isOfficialMovieCollection);
		const paths = new Set(matches.map((candidate) => new URL(candidate.href, 'https://app.trakt.tv').pathname.replace(/\/$/, '')));
		// Never substitute an editorial list or guess between different collections.
		return paths.size === 1 ? matches[0] : null;
	}

	function collectionPath(href) {
		try {
			const url = new URL(href, 'https://app.trakt.tv');
			return ['https://app.trakt.tv', 'https://trakt.tv'].includes(url.origin)
				&& /^\/lists\/official\/[a-z0-9]+(?:-[a-z0-9]+)*-collection(?:-\d+)?\/?$/i.test(url.pathname)
				? url.pathname.replace(/\/$/, '') : '';
		} catch { return ''; }
	}

	function collectionNavigation(href, event) {
		if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return '';
		try {
			const url = new URL(href, 'https://app.trakt.tv');
			if (url.origin === 'https://app.trakt.tv' && collectionPath(url.pathname)) return collectionPath(url.pathname);
			if (url.origin === 'https://app.trakt.tv' && url.pathname === '/discover/mixtape') return url.pathname + url.search;
			return url.origin === 'https://app.trakt.tv' && /^\/movies\/[a-z0-9][a-z0-9-]*\/?$/i.test(url.pathname)
				? url.pathname + url.search + url.hash : '';
		} catch { return ''; }
	}

	function collectionItemCount(value) {
		const text = String(value || '').trim();
		if (!/^[\d\s,]+$/.test(text)) return 0;
		const count = Number(text.replace(/[\s,]/g, ''));
		return Number.isSafeInteger(count) && count > 0 && count <= 2000 ? count : 0;
	}

	function collectionLayout({ count, width, cardWidth, cardHeight, columnGap, rowGap, headerHeight, padding }) {
		if (!Number.isInteger(count) || count < 1 || count > 2000
			|| ![width, cardWidth, cardHeight, headerHeight].every(value => Number.isFinite(value) && value > 0)
			|| ![columnGap, rowGap, padding].every(value => Number.isFinite(value) && value >= 0)) return null;
		const columns = Math.max(1, Math.floor((width - padding * 2 + columnGap) / (cardWidth + columnGap)));
		const rows = Math.ceil(count / columns);
		return { columns, rows, height: Math.ceil(headerHeight + rows * cardHeight + (rows - 1) * rowGap) };
	}

	function createCollectionLoader({ fetch: request, apiKey }) {
		let pending;
		return function load(pathname, href) {
			const path = collectionPath(href);
			if (!/^\/movies\/[a-z0-9][a-z0-9-]*\/?$/i.test(pathname || '') || !path) return Promise.resolve(null);
			if (pending) return pending;
			pending = (async () => {
				const controller = new AbortController();
				const timer = setTimeout(() => controller.abort(), 12000);
				async function pages(url) {
					const result = [];
					for (let page = 1; page <= 20; page++) {
						const response = await request(`https://api.trakt.tv${url}&limit=100&page=${page}`, {
							credentials: 'omit', signal: controller.signal,
							headers: { 'trakt-api-key': apiKey, 'trakt-api-version': '2' },
						});
						if (!response.ok) throw Error('Collection unavailable');
						const rows = await response.json();
						if (!Array.isArray(rows)) throw Error('Invalid collection');
						result.push(...rows);
						const total = Number(response.headers.get('x-pagination-page-count'));
						if (total > 0 ? page >= total : rows.length < 100) return result;
					}
					throw Error('Collection pagination exceeded');
				}
				try {
					const lists = await pages(`${pathname.replace(/\/$/, '')}/lists/official/popular?extended=images`);
					const list = lists.find(value => `/lists/official/${value.ids?.slug}` === path && isOfficialMovieCollection({
						href: path, title: value.name, variant: value.type, owner: value.user?.username,
					}) && Number.isSafeInteger(value.ids?.trakt) && value.ids.trakt > 0);
					if (!list) return null;
					const entries = await pages(`/lists/${list.ids.trakt}/items/movies?extended=full,images,colors&sort_by=rank&sort_how=asc`);
					const seen = new Set();
					return entries.sort((a, b) => (a?.rank || 0) - (b?.rank || 0)).flatMap(item => {
						const movie = item?.type === 'movie' && item.movie;
						if (!Number.isSafeInteger(movie?.ids?.trakt) || movie.ids.trakt <= 0 || seen.has(movie.ids.trakt)) return [];
						seen.add(movie.ids.trakt); return [movie];
					});
				} catch { return null; } finally { clearTimeout(timer); }
			})();
			return pending;
		};
	}

	const api = Object.freeze({ isOfficialMovieCollection, findUniqueOfficialMovieCollection, collectionPath, collectionNavigation, collectionItemCount, collectionLayout, createCollectionLoader });
	globalThis.CineTraktCollectionUtils = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
