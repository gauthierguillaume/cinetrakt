(() => {
	'use strict';
	const SHOW_QUERY = 'query:showSummary:v2';
	const HISTORY_QUERY = 'query:currentUserWatchedShows';
	function seasonHref(route, number, search = '') {
		if (!/^\/shows\/[^/?#]+\/?$/.test(route) || !Number.isInteger(number) || number < 0 || number > 200) return '';
		const params = new URLSearchParams(search);
		params.set('season', String(number)); params.set('view', 'seasons'); params.delete('episode');
		return `${route}?${params}`;
	}
	function fresh(entry, query, maxAge, now = Date.now()) {
		return Array.isArray(entry?.queryKey) && entry.queryKey.includes(query) && entry.state?.status === 'success'
			&& Number.isFinite(entry.state.dataUpdatedAt) && now >= entry.state.dataUpdatedAt && now - entry.state.dataUpdatedAt <= maxAge;
	}
	function showIdFromEntry(entry, route, now) {
		const slug = /^\/shows\/([^/?#]+)\/?$/.exec(route)?.[1];
		return slug && fresh(entry, SHOW_QUERY, 3 * 3600000, now) && entry.queryKey.includes(`dependency:${slug}`)
			&& Number.isInteger(entry.state.data?.id) && entry.state.data.id > 0 ? entry.state.data.id : null;
	}
	function playsFromEntry(entry, showId, now) {
		if (!fresh(entry, HISTORY_QUERY, 12 * 3600000, now) || !Array.isArray(entry.state.data?.pages)) return null;
		for (const page of entry.state.data.pages) {
			const show = page?.entries?.find?.(item => item?.id === showId);
			if (!(show?.playsPerSeason instanceof Map)) continue;
			return new Map([...show.playsPerSeason].filter(([season, plays]) => Number.isInteger(season) && season >= 0 && season <= 200
				&& Number.isInteger(plays) && plays >= 0));
		}
		return null;
	}
	function watchedStatus(aired, plays) {
		return Number.isInteger(aired) && aired > 0 && Number.isInteger(plays) && plays > 0
			? plays >= aired ? 'watched' : 'partial' : '';
	}
	// Read the same native history as Seasons, selecting only this show's counts.
	// Never read credentials, mutate the site's cache, or request the user's history again.
	function readWatched(route, idb = globalThis.indexedDB) {
		const slug = /^\/shows\/([^/?#]+)\/?$/.exec(route)?.[1];
		if (!slug || !idb) return Promise.resolve(null);
		return new Promise(resolve => {
			let db, tx, done = false;
			const finish = value => { if (done) return; done = true; clearTimeout(timeout); db?.close(); resolve(value); };
			const timeout = setTimeout(() => { try { tx?.abort(); } catch {} finish(null); }, 1500);
			try {
				const opened = idb.open('trakt-query');
				opened.onupgradeneeded = () => { opened.transaction.abort(); finish(null); };
				opened.onerror = opened.onblocked = () => finish(null);
				opened.onsuccess = () => {
					db = opened.result;
					if (done) { db.close(); return; }
					if (!db.objectStoreNames.contains('query-cache')) { finish(null); return; }
					tx = db.transaction('query-cache', 'readonly'); const store = tx.objectStore('query-cache');
					let counts = null, newest = -1, summaryAt = -1;
					const keys = store.getAllKeys();
					keys.onsuccess = () => {
						const all = keys.result.filter(k => typeof k === 'string');
						for (const key of all.filter(k => k.includes(JSON.stringify(SHOW_QUERY)) && k.includes(JSON.stringify(`dependency:${slug}`))).slice(0, 8)) {
							const summary = store.get(key);
							summary.onsuccess = () => {
								const id = showIdFromEntry(summary.result, route);
								const at = summary.result?.state?.dataUpdatedAt;
								if (!id || at < summaryAt) return;
								summaryAt = at;
								for (const historyKey of all.filter(k => k.includes(JSON.stringify(HISTORY_QUERY))).slice(0, 8)) {
									const history = store.get(historyKey);
									history.onsuccess = () => {
										const plays = playsFromEntry(history.result, id);
										const updated = history.result?.state?.dataUpdatedAt;
										if (fresh(history.result, HISTORY_QUERY, 12 * 3600000) && updated >= newest) { counts = plays; newest = updated; }
									};
								}
							};
						}
					};
					tx.oncomplete = () => finish(counts);
					tx.onerror = tx.onabort = () => finish(null);
				};
			} catch { finish(null); }
		});
	}
	const api = Object.freeze({ seasonHref, showIdFromEntry, playsFromEntry, watchedStatus, readWatched });
	globalThis.CineTraktSeasonCards = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
