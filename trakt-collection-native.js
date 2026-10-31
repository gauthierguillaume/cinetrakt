(() => {
	'use strict';
	const frame = window.frameElement;
	if (window.top === window || frame?.dataset.cinetraktCollectionMovie !== location.pathname) return;
	const { collectionPath, createCollectionLoader } = globalThis.CineTraktCollectionUtils;
	const path = collectionPath(frame.dataset.cinetraktNativeCollection);
	const cacheName = frame.dataset.cinetraktCollectionCache;
	if (!path || !/^\/movies\/[a-z0-9][a-z0-9-]*\/?$/i.test(location.pathname)
		|| !/^cinetrakt-collection-view-[a-f0-9-]+$/.test(cacheName || '')) return;
	frame.dataset.cinetraktCollectionState = 'initializing';

	// The surrounding page's Related Movies must retain its real data. This
	// native app instance gets a separate, disposable query-cache database.
	if (typeof IDBFactory !== 'undefined') {
		const descriptor = Object.getOwnPropertyDescriptor(IDBFactory.prototype, 'open');
		const original = descriptor?.value;
		if (typeof original === 'function') Object.defineProperty(IDBFactory.prototype, 'open', { ...descriptor, value(name, ...args) {
			return original.call(this, name === 'trakt-query' ? cacheName : name, ...args);
		} });
	}
	const originalFetch = window.fetch.bind(window);
	const load = createCollectionLoader({ fetch: originalFetch, apiKey: frame.dataset.cinetraktCollectionApiKey });
	// Fetch the official metadata and items while Trakt boots, rather than
	// starting that chain only once its lazy Related Movies asks for data.
	const pendingCollection = load(location.pathname, path);
	const relatedPath = `${location.pathname.replace(/\/$/, '')}/related`;
	window.fetch = async (input, init) => {
		let url;
		try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); }
		catch { return originalFetch(input, init); }
		if (!['https://api.trakt.tv', 'https://apiz.trakt.tv'].includes(url.origin) || url.pathname !== relatedPath
			|| String(init?.method || input?.method || 'GET').toUpperCase() !== 'GET') return originalFetch(input, init);
		frame.dataset.cinetraktCollectionState = 'loading';
		const movies = await pendingCollection;
		if (!movies?.length) {
			frame.dataset.cinetraktCollectionState = 'unavailable';
			return new Response('[]', { headers: { 'content-type': 'application/json', 'x-pagination-page-count': '1' } });
		}
		frame.dataset.cinetraktCollectionIds = movies.map(movie => movie.ids.trakt).join(',');
		frame.dataset.cinetraktCollectionState = 'ready';
		return new Response(JSON.stringify(movies), { headers: {
			'content-type': 'application/json', 'x-pagination-page': '1', 'x-pagination-page-count': '1',
			'x-pagination-item-count': String(movies.length), 'x-pagination-limit': String(movies.length),
		} });
	};
})();
