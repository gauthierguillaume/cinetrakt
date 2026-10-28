(() => {
	'use strict';


	let nextDataContextCache = null;

	function getImdbTitleIdFromUrl() {
		return window.location.pathname.match(/\/title\/(tt\d+)(?:\/|$)/i)?.[1]?.toLowerCase() || '';
	}

	function normalizeImdbType(type) {
		return String(type || '').toLowerCase().replace(/[^a-z]/g, '');
	}

	function extractImdbId(value) {
		const text = typeof value === 'string' ? value : value?.url || value?.['@id'] || value?.id || '';
		return String(text).match(/(?:\/title\/)?(tt\d+)/i)?.[1]?.toLowerCase() || '';
	}

	function getImdbJsonLdContext(imdbId) {
		const types = [];
		let parentSeriesImdbId = '';

		document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
			try {
				const parsed = JSON.parse(script.textContent || '{}');
				const items = Array.isArray(parsed) ? parsed : [parsed];

				items.forEach((item) => {
					const graphItems = Array.isArray(item?.['@graph']) ? item['@graph'] : [];
					[item, ...graphItems].forEach((entry) => {
						const entryImdbId = extractImdbId(entry);
						if (entryImdbId && entryImdbId !== imdbId) return;

						const entryTypes = Array.isArray(entry?.['@type']) ? entry['@type'] : [entry?.['@type']];
						entryTypes.filter(Boolean).forEach((type) => types.push(normalizeImdbType(type)));

						const parentCandidates = [
							entry?.partOfSeries,
							entry?.partOfTVSeries,
							entry?.partOfSeason?.partOfSeries,
						];
						parentSeriesImdbId ||= parentCandidates.map(extractImdbId).find((id) => id && id !== imdbId) || '';
					});
				});
			} catch (error) {
				// IMDb may replace structured data during client-side navigation.
			}
		});

		return { types, parentSeriesImdbId };
	}

	function findImdbTitleState(value, imdbId) {
		const stack = [value];
		let visited = 0;

		while (stack.length && visited < 50000) {
			const current = stack.pop();
			visited += 1;
			if (!current || typeof current !== 'object') continue;

			const canonicalId = String(current?.meta?.canonicalId || current?.id || '').toLowerCase();
			if (canonicalId === imdbId && current.titleType) return current;

			Object.values(current).forEach((child) => {
				if (child && typeof child === 'object') stack.push(child);
			});
		}

		return null;
	}

	function getImdbNextDataContext(imdbId) {
		const script = document.querySelector('script#__NEXT_DATA__[type="application/json"]');
		const text = script?.textContent || '';
		if (!script || !text) return { types: [], parentSeriesImdbId: '' };

		if (
			nextDataContextCache?.script === script &&
			nextDataContextCache?.textLength === text.length &&
			nextDataContextCache?.imdbId === imdbId
		) {
			return nextDataContextCache.context;
		}

		let context = { types: [], parentSeriesImdbId: '' };
		try {
			const titleState = findImdbTitleState(JSON.parse(text), imdbId);
			const titleType = normalizeImdbType(titleState?.titleType?.id);
			const parentSeriesImdbId = [
				titleState?.series?.series?.id,
				titleState?.series?.id,
				titleState?.parentSeries?.id,
			].map(extractImdbId).find((id) => id && id !== imdbId) || '';

			context = {
				types: titleType ? [titleType] : [],
				parentSeriesImdbId,
			};
		} catch (error) {
			// A later IMDb render pass can provide a complete __NEXT_DATA__ payload.
		}

		nextDataContextCache = { script, textLength: text.length, imdbId, context };
		return context;
	}

	function getParentSeriesImdbId(imdbId, ...contexts) {
		const structuredParentId = contexts.map((context) => context.parentSeriesImdbId).find(Boolean);
		if (structuredParentId && structuredParentId !== imdbId) return structuredParentId;

		const parentLinks = document.querySelectorAll([
			'a[data-testid="hero-title-block__series-link"][href*="/title/tt"]',
			'a[data-testid="hero-subnav-bar-all-episodes-button"][href*="/title/tt"]',
		].join(','));

		for (const link of parentLinks) {
			const parentId = extractImdbId(link.getAttribute('href'));
			if (parentId && parentId !== imdbId) return parentId;
		}

		return '';
	}

	function getImdbMediaContext() {
		const sourceImdbId = getImdbTitleIdFromUrl();
		if (!sourceImdbId) return null;

		const jsonLdContext = getImdbJsonLdContext(sourceImdbId);
		const nextDataContext = getImdbNextDataContext(sourceImdbId);
		const normalizedTypes = [...new Set([...jsonLdContext.types, ...nextDataContext.types])];
		const episodeTypes = new Set(['episode', 'tvepisode']);
		const unsupportedEpisodeTypes = new Set(['podcastepisode']);
		const showTypes = new Set(['tvseries', 'tvminiseries', 'tvshort']);
		const movieTypes = new Set(['movie', 'tvmovie', 'short', 'shortfilm']);
		const isShow = normalizedTypes.some((type) => showTypes.has(type));
		const isMovie = normalizedTypes.some((type) => movieTypes.has(type));
		const isEpisode = normalizedTypes.some((type) => episodeTypes.has(type));

		if (normalizedTypes.some((type) => unsupportedEpisodeTypes.has(type))) return null;
		if (isEpisode) {
			const parentSeriesImdbId = getParentSeriesImdbId(sourceImdbId, nextDataContext, jsonLdContext);
			if (!parentSeriesImdbId) return null;

			return { sourceImdbId, traktImdbId: parentSeriesImdbId, mediaType: 'show' };
		}

		if (isShow === isMovie) return null;
		if (isShow) return { sourceImdbId, traktImdbId: sourceImdbId, mediaType: 'show' };
		if (isMovie) return { sourceImdbId, traktImdbId: sourceImdbId, mediaType: 'movie' };

		return null;
	}

	function buildDirectTraktUrl(context) {
		if (!/^tt\d+$/i.test(context?.traktImdbId || '')) return '';
		if (context.mediaType === 'show') return `https://app.trakt.tv/shows/${context.traktImdbId}`;
		if (context.mediaType === 'movie') return `https://app.trakt.tv/movies/${context.traktImdbId}`;

		return '';
	}

	function findImdbTraktButtonMountPoint() {
		const candidates = [
			...document.querySelectorAll('a#home_img_holder'),
			...document.querySelectorAll('a.imdb-header__logo-link'),
		];
		const logoLink = candidates.find((element) => element.getClientRects().length > 0) ||
			candidates[0] ||
			document.querySelector('svg#home_img')?.closest('a');

		return logoLink?.parentNode ? { container: logoLink.parentNode, reference: logoLink } : null;
	}

	function ensureTraktButtonStyles() {
		if (document.getElementById('cinetrakt-imdb-button-styles')) return;

		const style = document.createElement('style');
		style.id = 'cinetrakt-imdb-button-styles';
		style.textContent = `
			.trakt-header-btn {
				align-items: center;
				border-radius: 6px;
				cursor: pointer;
				display: inline-flex;
				height: 38px;
				justify-content: center;
				margin-left: 12px;
				padding: 0;
				text-decoration: none;
				transition: filter 160ms ease, background-color 160ms ease;
				width: 38px;
				z-index: 10;
			}

			.trakt-header-btn:hover {
				background-color: rgba(255, 255, 255, 0.08);
				filter: brightness(1.08);
			}

			.trakt-header-btn:focus-visible {
				outline: 2px solid #f5c518;
				outline-offset: 2px;
			}

			.trakt-header-btn img {
				display: block;
				flex: 0 0 28px;
				height: 28px;
				object-fit: contain;
				width: 28px;
			}
		`;
		document.head.appendChild(style);
	}

	function insertOrUpdateTraktButtonIMDB() {
		const buttons = [...document.querySelectorAll('.trakt-header-btn')];
		const existingButton = buttons.shift() || null;
		buttons.forEach((button) => button.remove());

		const mountPoint = findImdbTraktButtonMountPoint();
		const mediaContext = getImdbMediaContext();
		const traktUrl = buildDirectTraktUrl(mediaContext);

		if (!mountPoint || !mediaContext || !traktUrl) {
			existingButton?.remove();
			return;
		}

		if (existingButton) {
			existingButton.href = traktUrl;
			existingButton.dataset.cinetraktImdbId = mediaContext.traktImdbId;
			existingButton.dataset.cinetraktSourceImdbId = mediaContext.sourceImdbId;
			existingButton.dataset.cinetraktMediaType = mediaContext.mediaType;
			existingButton.dataset.cinetraktTraktUrl = traktUrl;
			if (existingButton.parentNode !== mountPoint.container) {
				mountPoint.container.insertBefore(existingButton, mountPoint.reference.nextSibling);
			}
			return;
		}

		ensureTraktButtonStyles();
		const traktButton = document.createElement('a');
		traktButton.href = traktUrl;
		traktButton.target = '_blank';
		traktButton.rel = 'noopener noreferrer';
		traktButton.className = 'trakt-header-btn';
		traktButton.dataset.cinetraktImdbId = mediaContext.traktImdbId;
		traktButton.dataset.cinetraktSourceImdbId = mediaContext.sourceImdbId;
		traktButton.dataset.cinetraktMediaType = mediaContext.mediaType;
		traktButton.dataset.cinetraktTraktUrl = traktUrl;
		traktButton.setAttribute('aria-label', 'Open this title on Trakt');
		traktButton.title = 'Open this title on Trakt';
		const traktLogo = document.createElement('img');
		traktLogo.src = chrome.runtime.getURL('assets/trakt-logo.svg');
		traktLogo.alt = '';
		traktLogo.width = 28;
		traktLogo.height = 28;
		traktLogo.setAttribute('aria-hidden', 'true');
		traktButton.appendChild(traktLogo);
		traktButton.addEventListener('keydown', (event) => {
			if (event.key !== ' ') return;
			event.preventDefault();
			window.open(traktButton.href, '_blank', 'noopener,noreferrer');
		});

		mountPoint.container.insertBefore(traktButton, mountPoint.reference.nextSibling);
	}

	function runImdbButtons() {
		if (!globalThis.CineTraktSettings?.loaded) {
			globalThis.CineTraktSettings?.ready.then(runImdbButtons);
			return;
		}
		if (!globalThis.CineTraktSettings.isEnabled('imdbTraktButton')) {
			document.querySelectorAll('.trakt-header-btn').forEach((button) => button.remove());
			return;
		}
		insertOrUpdateTraktButtonIMDB();
	}

	globalThis.CineTraktImdbTraktButton = Object.freeze({ update: runImdbButtons });
})();
