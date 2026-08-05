(() => {
	'use strict';

	const page = globalThis.CineTraktImdbPage;

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

			.trakt-header-btn svg {
				display: block;
				height: 28px;
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
		traktButton.innerHTML = `
			<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
				<path fill="oklch(56.1% .205 314.2)" d="M48 11.26v25.47C48 42.95 42.95 48 36.73 48H11.26C5.04 48 0 42.95 0 36.73V11.26C0 5.04 5.04 0 11.26 0h25.47a11.24 11.24 0 0 1 9.62 5.4c.18.29.34.59.5.89.33.68.6 1.39.79 2.14.1.37.18.76.23 1.15.09.54.13 1.11.13 1.68Z" />
				<path fill="#fff" d="m13.62 17.97 7.92 7.92 1.47-1.47-7.92-7.92-1.47 1.47Zm-.7.7-1.46 1.46 14.4 14.4 1.46-1.47L23 28.75 46.35 5.4c-.36-.6-.78-1.16-1.25-1.68L21.54 27.28l-8.62-8.61Zm15.09 13.7 1.47-1.46-2.16-2.16L47.64 8.43c-.19-.75-.46-1.46-.79-2.14L24.39 28.75l3.62 3.62ZM47.87 9.58 28.7 28.75l1.47 1.46L48 12.38v-1.12c0-.57-.04-1.14-.13-1.68ZM25.16 22.27l-7.92-7.92-1.47 1.47 7.92 7.92 1.47-1.47Zm16.16 12.85c0 3.42-2.78 6.2-6.2 6.2H12.88c-3.42 0-6.2-2.78-6.2-6.2V12.88c0-3.42 2.78-6.21 6.2-6.21h20.78V4.6H12.88c-4.56 0-8.28 3.71-8.28 8.28v22.24c0 4.56 3.71 8.28 8.28 8.28h22.24c4.56 0 8.28-3.71 8.28-8.28v-3.51h-2.07v3.51Z" />
			</svg>
		`;
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
		if (page.isRatingsPopupMode()) {
			document.querySelectorAll('.trakt-header-btn').forEach((button) => button.remove());
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
