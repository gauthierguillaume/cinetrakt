(() => {
	'use strict';
	const COLLECTORS_KEY = 'cinetraktImdbEpisodeCollectors';
	function createLoader(environment = globalThis) {
		const { chrome, CineTraktEpisodeRatings: utils, CineTraktExtensionProtocol: { MESSAGE_TYPES: types } } = environment;
		const jobs = new Map(), cache = new Map();
		const validId = id => /^tt\d{7,}$/.test(id);
		const readError = () => Boolean(chrome.runtime.lastError);
		function persistJobs() {
			chrome.storage?.session?.set({ [COLLECTORS_KEY]: [...jobs.values()].filter(job => Number.isInteger(job.tabId))
				.map(job => ({ tabId: job.tabId, imdbId: job.imdbId })) }, readError);
		}
		function sourceAllowed(sender, requireShow = true) {
			try { const url = new URL(sender.tab?.url || sender.url);
				return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && url.origin === 'https://app.trakt.tv'
					&& (!requireShow || /^\/shows\/[^/]+\/?$/.test(url.pathname));
			} catch { return false; }
		}
		function matchesLoader(tab, imdbId) {
			try { const url = new URL(tab.url);
				return url.origin === 'https://www.imdb.com' && url.pathname === `/title/${imdbId}/ratings/`
					&& url.searchParams.get('cinetrakt_ratings_data') === '1';
			} catch { return false; }
		}
		function finish(job, response) {
			if (jobs.get(job.key) !== job) return;
			jobs.delete(job.key); environment.clearTimeout(job.timer);
			persistJobs();
			if (Number.isInteger(job.tabId)) chrome.tabs.get(job.tabId, tab => {
				if (!readError() && tab && !tab.active && matchesLoader(tab, job.imdbId)) chrome.tabs.remove(tab.id, readError);
			});
			try { job.reply(response); } catch { /* The source page may already be closed. */ }
		}
		function handleMessage(message, sender, reply) {
			if (![types.GET_IMDB_EPISODES, types.CANCEL_IMDB_EPISODES, types.IMDB_EPISODES_RESULT].includes(message?.type)) return false;
			if (message.type === types.IMDB_EPISODES_RESULT) {
				const job = [...jobs.values()].find(item => item.tabId === sender.tab?.id);
				if (!job || sender.frameId !== 0 || !matchesLoader({ url: sender.url }, job.imdbId)) { reply({ ok: false }); return false; }
				const data = utils.normalizeSnapshot(message.data, job.imdbId);
				if (data?.complete) {
					cache.set(job.imdbId, { data, until: Date.now() + 10 * 60 * 1000 });
					if (cache.size > 8) cache.delete(cache.keys().next().value);
				}
				reply({ ok: true }); finish(job, data ? { ok: true, data } : { ok: false, error: message.error === 'verification' ? 'verification' : 'unavailable' });
				return false;
			}
			if (!sourceAllowed(sender, message.type !== types.CANCEL_IMDB_EPISODES) || !validId(message.imdbId)
				|| typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 80) {
				reply({ ok: false }); return false;
			}
			const key = `${sender.tab.id}:${message.requestId}`;
			if (message.type === types.CANCEL_IMDB_EPISODES) {
				const job = jobs.get(key); if (job) finish(job, { ok: false, error: 'cancelled' });
				reply({ ok: true }); return false;
			}
			const cached = cache.get(message.imdbId);
			if (cached?.until > Date.now()) { reply({ ok: true, data: cached.data }); return false; }
			for (const job of jobs.values()) if (job.sourceTabId === sender.tab.id) finish(job, { ok: false, error: 'cancelled' });
			if (jobs.size >= 3) { reply({ ok: false, error: 'busy' }); return false; }
			const job = { key, imdbId: message.imdbId, sourceTabId: sender.tab.id, reply };
			jobs.set(key, job);
			job.timer = environment.setTimeout(() => finish(job, { ok: false, error: 'timeout' }), 45000);
			chrome.tabs.create({ url: `https://www.imdb.com/title/${job.imdbId}/ratings/?cinetrakt_ratings_data=1`,
				active: false, windowId: sender.tab.windowId }, tab => {
				if (readError() || !tab?.id) { finish(job, { ok: false, error: 'unavailable' }); return; }
				job.tabId = tab.id;
				persistJobs();
				// Closing the panel can race the creation callback. Only our newly
				// created, still inactive collector tab is eligible for removal.
				if (jobs.get(key) !== job) chrome.tabs.get(tab.id, current => {
					if (!readError() && current && !current.active && matchesLoader(current, job.imdbId)) chrome.tabs.remove(tab.id, readError);
				});
			});
			return true;
		}
		function tabRemoved(id) {
			for (const job of jobs.values()) if (id === job.tabId || id === job.sourceTabId) finish(job, { ok: false, error: 'cancelled' });
		}
		return Object.freeze({ handleMessage, tabRemoved });
	}
	function start(environment = globalThis) {
		const { chrome } = environment;
		const loader = createLoader(environment);
		// A worker/extension restart must not strand its temporary IMDb tabs.
		// Persist only IDs we created and preserve a tab the user has taken over.
		const ready = new Promise(resolve => {
			chrome.storage.session.get(COLLECTORS_KEY, stored => {
				void chrome.runtime.lastError;
				const records = Array.isArray(stored?.[COLLECTORS_KEY]) ? stored[COLLECTORS_KEY].slice(0, 3) : [];
				Promise.all(records.map(record => new Promise(done => {
					if (!Number.isInteger(record?.tabId) || !/^tt\d{7,}$/.test(record.imdbId)) { done(); return; }
					chrome.tabs.get(record.tabId, tab => {
						const error = chrome.runtime.lastError;
						if (!error && tab && !tab.active && tab.url === `https://www.imdb.com/title/${record.imdbId}/ratings/?cinetrakt_ratings_data=1`) {
							chrome.tabs.remove(tab.id, () => { void chrome.runtime.lastError; done(); });
						} else done();
					});
				}))).then(() => chrome.storage.session.remove(COLLECTORS_KEY, () => { void chrome.runtime.lastError; resolve(); }));
			});
		});
		chrome.runtime.onMessage.addListener((message, sender, reply) => {
			const types = environment.CineTraktExtensionProtocol.MESSAGE_TYPES;
			if (![types.GET_IMDB_EPISODES, types.CANCEL_IMDB_EPISODES, types.IMDB_EPISODES_RESULT].includes(message?.type)) return false;
			ready.then(() => loader.handleMessage(message, sender, reply)); return true;
		});
		chrome.tabs.onRemoved.addListener(loader.tabRemoved);
		return ready;
	}
	const api = Object.freeze({ createLoader, start });
	globalThis.CineTraktImdbEpisodeLoader = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
