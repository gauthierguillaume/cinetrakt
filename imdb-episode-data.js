(() => {
	'use strict';
	if (window.top !== window || !globalThis.CineTraktImdbPage.isRatingsDataMode()) return;
	const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;
	const imdbId = window.location.pathname.match(/\/title\/(tt\d{7,})\/ratings\//)?.[1];
	if (!imdbId) return;
	let stopped = false;
	window.addEventListener('pagehide', () => { stopped = true; }, { once: true });
	const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
	function readEpisodes() {
		const seasons = [...document.querySelectorAll('[data-testid="heatmap__seasons-column"] td.ratings-heatmap__table-data')];
		const rows = [...document.querySelectorAll('[data-testid="heatmap__episode-data"] tbody tr')];
		const episodes = [];
		for (let index = 0; index < rows.length; index++) {
			const number = String(seasons[index]?.textContent || '').trim().match(/^S?\s*(\d+)$/i);
			if (!number) continue;
			for (const link of rows[index].querySelectorAll('a[aria-label][href*="/title/tt"]')) {
				const label = link.getAttribute('aria-label') || '';
				const identity = label.match(/^Season\s+(\d+)\s+Episode\s+(\d+),/i);
				const id = link.getAttribute('href')?.match(/^\/title\/(tt\d{7,})\//)?.[1];
				if (!identity || Number(identity[1]) !== Number(number[1]) || !id) continue;
				const text = link.textContent.trim();
				const rating = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
				episodes.push({ season: Number(identity[1]), episode: Number(identity[2]), imdbId: id, rating });
			}
		}
		return episodes;
	}
	function loadButton() {
		return document.querySelector('[data-testid="heatmap__load-seasons"], [aria-label="Load additional seasons"]')
			|| document.querySelector('[aria-label="Load additional episodes"]');
	}
	async function collect() {
		const deadline = Date.now() + 40000;
		let totalEpisodes = 0;
		try { totalEpisodes = JSON.parse(document.querySelector('script#__NEXT_DATA__')?.textContent || '{}')
			.props?.pageProps?.contentData?.heatmapData?.totalEpisodes || 0; } catch { /* DOM can still supply the table. */ }
		await delay(750); // Let IMDb hydrate its server-rendered paging controls.
		let lastClick = 0, lastCount = -1, unchangedAt = Date.now();
		while (!stopped && Date.now() < deadline) {
			const episodes = readEpisodes();
			const button = loadButton();
			if (episodes.length !== lastCount) { lastCount = episodes.length; unchangedAt = Date.now(); }
			if (episodes.length && !button && (!totalEpisodes || episodes.length >= totalEpisodes)) {
				return { imdbId, episodes, totalEpisodes: totalEpisodes || episodes.length, complete: true };
			}
			if (document.querySelector('iframe[src*="captcha" i], [id*="captcha" i]')
				|| /verify that you are not a robot|robot verification/i.test(document.body.innerText)) throw new Error('verification');
			if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && Date.now() - lastClick > 2500) {
				button.click(); lastClick = Date.now();
			}
			if (episodes.length && Date.now() - unchangedAt > 12000) break;
			await delay(250);
		}
		return { imdbId, episodes: readEpisodes(), totalEpisodes, complete: false };
	}
	globalThis.CineTraktSettings.ready.then(async () => {
		let data, error;
		try {
			if (!globalThis.CineTraktSettings.isEnabled('imdbEpisodeRatingsPopup')) throw new Error('unavailable');
			data = await collect();
		} catch (failure) { error = failure.message; }
		if (stopped) return;
		chrome.runtime.sendMessage({ type: MESSAGE_TYPES.IMDB_EPISODES_RESULT, data, error }, () => { void chrome.runtime.lastError; });
	});
})();
