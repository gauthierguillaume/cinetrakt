function isCineTraktRatingsPopupMode() {
	return new URLSearchParams(window.location.search).get('cinetrakt_ratings_popup') === '1';
}

(() => {
	'use strict';

	console.log('CineTrakt: IMDb module loaded');

	function getJsonLdItems() {
		return Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
			.flatMap((script) => {
				try {
					const parsed = JSON.parse(script.textContent || '{}');
					return Array.isArray(parsed) ? parsed : [parsed];
				} catch (error) {
					return [];
				}
			})
			.filter(Boolean);
	}

	function normalizeJsonLdType(type) {
		const types = Array.isArray(type) ? type : [type];
		const cleanTypes = types.map((value) => String(value || '').toLowerCase());

		if (cleanTypes.some((value) => value.includes('tvseries') || value.includes('series'))) return 'show';
		if (cleanTypes.some((value) => value.includes('movie'))) return 'movie';

		return '';
	}

	function getMetaContent(selector) {
		return document.querySelector(selector)?.getAttribute('content')?.trim() || '';
	}

	function cleanImdbTitle(value) {
		return String(value || '')
			.replace(/\s+-\s+IMDb\s*$/i, '')
			.replace(/\s*\((?:TV Series|TV Mini Series|TV Movie|Video|Podcast Series)?\s*\d{4}.*?\)\s*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function getVisibleImdbTitle() {
		const title =
			document.querySelector('[data-testid="hero__pageTitle"]')?.textContent ||
			document.querySelector('h1')?.textContent ||
			getMetaContent('meta[property="og:title"]') ||
			document.title;

		return cleanImdbTitle(title);
	}

	function getYearFromText(value) {
		const match = String(value || '').match(/\b(18|19|20)\d{2}\b/);
		return match ? match[0] : '';
	}

	function getImdbMetadataFromJsonLd() {
		const item = getJsonLdItems().find((entry) => normalizeJsonLdType(entry?.['@type']) || entry?.name);
		if (!item) return {};

		return {
			title: cleanImdbTitle(item.name || item.headline || ''),
			year: getYearFromText(item.datePublished || item.startDate || ''),
			mediaType: normalizeJsonLdType(item['@type']),
		};
	}

	function getImdbMediaTypeFromDom() {
		const typeText = Array.from(document.querySelectorAll('.ipc-inline-list__item, a, span'))
			.map((item) => item.textContent || '')
			.join(' ');

		if (/TV\s+(Series|Mini Series)|TVSeries|Episode guide/i.test(typeText)) return 'show';
		if (/Movie|Feature Film/i.test(typeText)) return 'movie';

		return '';
	}

	function getImdbYearFromDom() {
		const candidates = [
			getMetaContent('meta[property="og:title"]'),
			document.querySelector('[data-testid="hero__pageTitle"]')?.parentElement?.textContent || '',
			document.querySelector('h1')?.parentElement?.textContent || '',
			document.title,
		];

		for (const candidate of candidates) {
			const year = getYearFromText(candidate);
			if (year) return year;
		}

		return '';
	}

	function getImdbMetadata() {
		const jsonLdMetadata = getImdbMetadataFromJsonLd();
		const title = jsonLdMetadata.title || getVisibleImdbTitle();
		const year = jsonLdMetadata.year || getImdbYearFromDom();
		const mediaType = jsonLdMetadata.mediaType || getImdbMediaTypeFromDom();

		return { title, year, mediaType };
	}

	function slugifyForTrakt(title, year) {
		const titleSlug = String(title || '')
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/['’]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');

		const cleanYear = getYearFromText(year);

		return [titleSlug, cleanYear].filter(Boolean).join('-');
	}

	function buildTraktUrlFromImdbMetadata(metadata) {
		const title = metadata?.title || '';
		const year = metadata?.year || '';
		const slug = slugifyForTrakt(title, year);

		if (slug && metadata?.mediaType === 'movie') {
			return `https://app.trakt.tv/movies/${slug}`;
		}

		if (slug && metadata?.mediaType === 'show') {
			return `https://app.trakt.tv/shows/${slug}`;
		}

		const query = [title, year].filter(Boolean).join(' ').trim();
		if (query) {
			return `https://app.trakt.tv/search?query=${encodeURIComponent(query)}`;
		}

		return 'https://app.trakt.tv/search';
	}

	function insertTraktButtonIMDB() {
		if (document.querySelector('.trakt-header-btn')) return;

		const logoLink = document.querySelector('a#home_img_holder');
		if (!logoLink || !logoLink.parentNode) return;

		const imdbMetadata = getImdbMetadata();
		const traktButton = document.createElement('a');
		traktButton.href = buildTraktUrlFromImdbMetadata(imdbMetadata);
		traktButton.target = '_blank';
		traktButton.rel = 'noopener';
		traktButton.className = 'trakt-header-btn';
		traktButton.innerHTML = `<img src="https://trakt.tv/assets/logos/logomark.square.gradient-b644b16c38ff775861b4b1f58c1230f6a097a2466ab33ae00445a505c33fcb91.svg" alt="Trakt logo">`;

		traktButton.style.display = 'flex';
		traktButton.style.alignItems = 'center';
		traktButton.style.background = 'none';
		traktButton.style.borderRadius = '0';
		traktButton.style.height = '38px';
		traktButton.style.marginLeft = '12px';
		traktButton.style.padding = '0';
		traktButton.style.textDecoration = 'none';
		traktButton.style.transition = 'filter .2s';
		traktButton.style.zIndex = '10';

		const img = traktButton.querySelector('img');
		img.style.width = '28px';
		img.style.height = '28px';
		img.style.borderRadius = '6px';
		img.style.margin = '0';
		img.style.boxShadow = 'none';
		img.style.background = 'none';
		img.style.transition = 'filter .2s';
		img.style.filter = 'grayscale(0.1) brightness(1.03)';

		traktButton.addEventListener('mouseenter', () => { img.style.filter = 'none'; });
		traktButton.addEventListener('mouseleave', () => { img.style.filter = 'grayscale(0.1) brightness(1.03)'; });

		logoLink.parentNode.insertBefore(traktButton, logoLink.nextSibling);
		console.log('CineTrakt: Trakt V3 button inserted after IMDb logo');
	}

	function runImdbButtons() {
		if (isCineTraktRatingsPopupMode()) {
			document.querySelector('.trakt-header-btn')?.remove();
			return;
		}
		insertTraktButtonIMDB();
	}

	document.addEventListener('DOMContentLoaded', runImdbButtons);
	window.addEventListener('load', runImdbButtons);
	setTimeout(runImdbButtons, 1200);
})();

(function () {
    'use strict';

    const DEBOUNCE_TIME = 250;
    const RATINGS_POPUP_PADDING = 16;
    const RATINGS_POPUP_RESIZE_TOLERANCE = 3;
    const RATINGS_POPUP_MAX_SEASON_LOADS = 10;
    const RATINGS_POPUP_SEASON_LOAD_TIMEOUT = 8000;
    const { getStyleForRating, formatRating, calculateAverage } = globalThis.CineTraktRatingsTable;
    let ratingsPopupResizeObserver = null;
    let ratingsPopupMutationObserver = null;
    let ratingsPopupObservedRoot = null;
    let ratingsPopupResizeTimer = null;
    let lastRatingsPopupSize = null;
    let ratingsPopupInitializationRoot = null;
    let ratingsPopupInitializationPromise = null;
    let ratingsPopupInitializationVersion = 0;
    let popupInitializationComplete = false;
    let isAutoLoadingSeasons = false;
    let allSeasonsLoaded = false;

    const STYLES = `
        .sg-rating-cell {
            border-radius: 4px !important;
            background-image: none !important;
            box-shadow: none !important;
            transition: none !important;
        }

        .sg-rating-text {
            font-weight: 600 !important;
            text-shadow: none !important;
        }

        .sg-rating-text:hover,
        .sg-rating-text:focus,
        .sg-rating-text:active {
            text-decoration-color: var(--sg-rating-text-color, currentColor) !important;
            -webkit-text-decoration-color: var(--sg-rating-text-color, currentColor) !important;
        }

        /* IMDb draws the hover underline with pseudo-elements on some cells.
           We only force that existing underline to use the same color as the note text. */
        .sg-rating-text:hover::before,
        .sg-rating-text:hover::after,
        .sg-rating-text:focus::before,
        .sg-rating-text:focus::after,
        .sg-rating-text:active::before,
        .sg-rating-text:active::after {
            background-color: var(--sg-rating-text-color, currentColor) !important;
            border-color: var(--sg-rating-text-color, currentColor) !important;
            color: var(--sg-rating-text-color, currentColor) !important;
        }

        .sg-avg-cell-box,
        .sg-avg-cell-box:hover,
        .sg-avg-cell-box:focus,
        .sg-avg-cell-box:active {
            text-decoration: none !important;
            pointer-events: none !important;
            cursor: default !important;
        }

        .sg-avg-th,
        .sg-avg-td {
            box-sizing: border-box !important;
        }

        .sg-avg-header {
            color: rgba(255,255,255,0.55) !important;
            font-weight: 800 !important;
            letter-spacing: 0.06em !important;
            text-align: center !important;
            white-space: nowrap !important;
        }

        .sg-avg-cell-box {
            box-sizing: border-box !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: transparent !important;
            background-color: transparent !important;
            background-image: none !important;
            border: 0 !important;
            box-shadow: none !important;
            font-weight: 600 !important;
            text-shadow: none !important;
        }

        .sg-main-rating-colored {
            background: transparent !important;
            background-color: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
            border-radius: 0 !important;
        }


        .sg-inline-rating-colored {
            background: transparent !important;
            background-color: transparent !important;
            border: 0 !important;
            box-shadow: none !important;
            text-shadow: none !important;
        }

		html.cinetrakt-ratings-popup-mode,
		body.cinetrakt-ratings-popup-mode {
			min-height: 100% !important;
			background: #121212 !important;
		}

		body.cinetrakt-ratings-popup-mode {
			box-sizing: border-box !important;
			margin: 0 !important;
			padding: ${RATINGS_POPUP_PADDING}px !important;
			display: flex !important;
			align-items: flex-start !important;
			justify-content: center !important;
			overflow: hidden !important;
		}

		.cinetrakt-ratings-popup-loading {
			position: fixed !important;
			inset: 0 !important;
			display: flex !important;
			align-items: center !important;
			justify-content: center !important;
			z-index: 2147483647 !important;
			color: rgba(255, 255, 255, 0.72) !important;
			background: #121212 !important;
			font: 500 14px/1.5 Roboto, Arial, sans-serif !important;
		}

		.cinetrakt-ratings-popup-loading[hidden],
		.cinetrakt-ratings-popup-hidden {
			display: none !important;
		}

		body.cinetrakt-ratings-popup-ready .cinetrakt-ratings-popup-path:not(.cinetrakt-imdb-ratings-popup-content) {
			box-sizing: border-box !important;
			display: block !important;
			width: fit-content !important;
			min-width: 0 !important;
			max-width: none !important;
			margin: 0 !important;
			padding: 0 !important;
		}

		.cinetrakt-imdb-ratings-popup-content {
			box-sizing: border-box !important;
			width: var(--cinetrakt-ratings-popup-root-width) !important;
			max-width: calc(100vw - ${RATINGS_POPUP_PADDING * 2}px) !important;
			max-height: calc(100vh - ${RATINGS_POPUP_PADDING * 2}px) !important;
			margin: 0 auto !important;
			overflow-x: hidden !important;
			overflow-y: auto !important;
			scrollbar-width: none !important;
			-ms-overflow-style: none !important;
			background: #121212 !important;
		}

		.cinetrakt-imdb-ratings-popup-content [data-testid="heatmap__content"] {
			width: var(--cinetrakt-ratings-popup-table-width) !important;
			max-width: none !important;
			overflow-x: auto !important;
			overflow-y: hidden !important;
			scrollbar-width: none !important;
			-ms-overflow-style: none !important;
		}

		.cinetrakt-imdb-ratings-popup-content [data-testid="heatmap__seasons-column"],
		.cinetrakt-imdb-ratings-popup-content [data-sg-avg="true"] {
			visibility: visible !important;
			opacity: 1 !important;
		}

		.cinetrakt-imdb-ratings-popup-content::-webkit-scrollbar,
		.cinetrakt-imdb-ratings-popup-content [data-testid="heatmap__content"]::-webkit-scrollbar {
			display: none !important;
			width: 0 !important;
			height: 0 !important;
		}
    `;

    function debounce(fn, delay) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function injectStyles() {
        if (document.getElementById('sg-styles')) return;

        const style = document.createElement('style');
        style.id = 'sg-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    function parseRatingText(text) {
        if (!text) return NaN;
        const match = text.trim().replace(',', '.').match(/^\d+(?:\.\d+)?/);
        return match ? parseFloat(match[0]) : NaN;
    }


    function getDirectText(element) {
        if (!element) return '';
        return Array.from(element.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent || '')
            .join('')
            .trim();
    }

    function isExactRatingText(text) {
        const clean = String(text || '').trim().replace(',', '.');
        if (!/^\d+(?:\.\d+)?$/.test(clean)) return false;

        const rating = Number(clean);
        return Number.isFinite(rating) && rating >= 1 && rating <= 10;
    }

    function parseRatingFromShortTextFallback(text) {
        const clean = String(text || '').trim().replace(',', '.');
        const match = clean.match(/^(\d+(?:\.\d+)?)\s*(?:\/\s*10)?$/);
        if (!match) return NaN;

        const rating = Number(match[1]);
        return Number.isFinite(rating) && rating >= 1 && rating <= 10 ? rating : NaN;
    }

    function getShortRatingText(element) {
        if (!element) return '';
        const direct = getDirectText(element);
        const text = direct || (element.children.length ? '' : element.textContent || '');
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    function isInsideSeriesGraph(element) {
        return Boolean(element.closest('[data-testid="heatmap__episode-data"], [data-testid="heatmap__seasons-column"]'));
    }

    function isInsidePopularityArea(element) {
        let root = element;

        for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
            const text = (root.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();

            if (!text.includes('POPULARITY')) continue;
            if (text.includes('IMDB RATING') || text.includes('YOUR RATING')) continue;
            if (text.length > 160) continue;

            return true;
        }

        return false;
    }

    function isInsideIgnoredRatingArea(element) {
        return Boolean(element.closest('.sg-rating-text, .sg-avg-cell-box, [data-sg-avg="true"]')) || isInsidePopularityArea(element);
    }

    function applyInlineRatingColor(element, rating) {
        if (!element || !Number.isFinite(rating)) return;

        const style = getStyleForRating(rating);

        element.classList.add('sg-inline-rating-colored');
        element.style.setProperty('color', style.bg, 'important');
        element.style.setProperty('background', 'transparent', 'important');
        element.style.setProperty('background-color', 'transparent', 'important');
        element.style.setProperty('border', '0', 'important');
        element.style.setProperty('box-shadow', 'none', 'important');
        element.style.setProperty('text-shadow', 'none', 'important');
    }

    function colorizeExactRatingElements(root) {
        if (!root) return;

        const candidates = Array.from(root.querySelectorAll('span, div, a, button'));

        candidates.forEach(element => {
            if (isInsideSeriesGraph(element) || isInsideIgnoredRatingArea(element)) return;

            const directText = getDirectText(element);
            const text = directText || (element.children.length ? '' : element.textContent);

            if (!isExactRatingText(text)) return;

            const rating = parseRatingText(text);
            applyInlineRatingColor(element, rating);
        });
    }

    function findSectionByTitle(title) {
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
        const heading = headings.find(el => (el.textContent || '').trim().toLowerCase().startsWith(title.toLowerCase()));

        if (!heading) return null;
        return heading.closest('section') || heading.closest('[data-testid]') || heading.parentElement;
    }

    function getHeatmapParts() {
        const seasonTable = document.querySelector('[data-testid="heatmap__seasons-column"]');
        const episodeTable = document.querySelector('[data-testid="heatmap__episode-data"]');

        if (!seasonTable || !episodeTable) {
            return null;
        }

        const seasonCells = Array.from(seasonTable.querySelectorAll('td.ratings-heatmap__table-data'));
        const episodeRows = Array.from(episodeTable.querySelectorAll('tbody tr'));

        return {
            seasonTable,
            episodeTable,
            seasonCells,
            episodeRows
        };
    }

    function getEpisodeCells(row) {
        return Array.from(row.querySelectorAll('td.ratings-heatmap__table-data'))
            .filter(cell => cell.dataset.sgAvg !== 'true');
    }

	function validateRatingsTableStructure() {
		const parts = getHeatmapParts();
		if (!parts || !parts.seasonCells.length || parts.seasonCells.length !== parts.episodeRows.length) return false;
		const headerHasAverage = !!parts.episodeTable.querySelector('thead tr > th[data-sg-avg="true"]');
		if (!headerHasAverage) return false;

		return parts.episodeRows.every((row, index) => {
			const seasonLabel = String(parts.seasonCells[index]?.textContent || '').trim();
			const averageCell = row.querySelector(':scope > td[data-sg-avg="true"]');
			return /^S?\s*\d+$/i.test(seasonLabel)
				&& !!averageCell?.querySelector('.sg-avg-cell-box')
				&& getEpisodeCells(row).length > 0;
		});
	}

    function hasImdbVerificationPage() {
        const bodyText = String(document.body?.innerText || '').replace(/\s+/g, ' ').toLowerCase();
        return Boolean(document.querySelector('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]'))
            || bodyText.includes('verify that you are not a robot')
            || bodyText.includes('not a robot')
            || bodyText.includes('javascript is disabled')
            || bodyText.includes('robot verification');
    }

    function getRatingsPopupLoadingElement() {
        let loading = document.body.querySelector(':scope > .cinetrakt-ratings-popup-loading');
        if (loading) return loading;

        loading = document.createElement('div');
        loading.className = 'cinetrakt-ratings-popup-loading';
        loading.setAttribute('role', 'status');
        loading.textContent = 'Loading IMDb episode ratings…';
        document.body.appendChild(loading);
        return loading;
    }

    function clearRatingsPopupIsolation() {
        document.querySelectorAll('.cinetrakt-ratings-popup-hidden').forEach(element => {
            element.classList.remove('cinetrakt-ratings-popup-hidden');
        });
        document.querySelectorAll('.cinetrakt-ratings-popup-path').forEach(element => {
            element.classList.remove('cinetrakt-ratings-popup-path');
        });
		document.querySelectorAll('.cinetrakt-imdb-ratings-popup-content').forEach(element => {
			element.classList.remove('cinetrakt-imdb-ratings-popup-content');
			element.style.removeProperty('--cinetrakt-ratings-popup-root-width');
			element.style.removeProperty('--cinetrakt-ratings-popup-table-width');
		});
        document.body.classList.remove('cinetrakt-ratings-popup-ready');
    }

    function disconnectRatingsPopupObservers() {
		ratingsPopupResizeObserver?.disconnect();
		ratingsPopupMutationObserver?.disconnect();
		ratingsPopupResizeObserver = null;
		ratingsPopupMutationObserver = null;
		ratingsPopupObservedRoot = null;
		lastRatingsPopupSize = null;
		if (ratingsPopupResizeTimer !== null) {
			window.clearTimeout(ratingsPopupResizeTimer);
			ratingsPopupResizeTimer = null;
		}
	}

	function configureRatingsPopupContent(root) {
		const tableViewport = root.querySelector('[data-testid="heatmap__content"]');
		const seasonTable = root.querySelector('[data-testid="heatmap__seasons-column"]');
		const episodeTable = root.querySelector('[data-testid="heatmap__episode-data"]');
		if (!tableViewport || !seasonTable || !episodeTable) return false;

		const rootRect = root.getBoundingClientRect();
		const tableRect = tableViewport.getBoundingClientRect();
		const nativeTableWidth = Number(root.dataset.cinetraktPopupNativeTableWidth)
			|| Math.ceil(tableRect.width);
		const horizontalControlsWidth = Number(root.dataset.cinetraktPopupHorizontalControlsWidth)
			|| Math.max(0, Math.ceil(rootRect.width - tableRect.width));
		root.dataset.cinetraktPopupNativeTableWidth = String(nativeTableWidth);
		root.dataset.cinetraktPopupHorizontalControlsWidth = String(horizontalControlsWidth);

		// The season table is absolutely positioned inside IMDb's existing left gutter.
		// The episode table therefore defines the useful viewport width on its own.
		const intrinsicTableWidth = Math.ceil(episodeTable.scrollWidth);
		const tableWidth = Math.min(nativeTableWidth, intrinsicTableWidth);
		root.classList.add('cinetrakt-imdb-ratings-popup-content');
		root.style.setProperty('--cinetrakt-ratings-popup-table-width', `${tableWidth}px`);
		root.style.setProperty('--cinetrakt-ratings-popup-root-width', `${tableWidth + horizontalControlsWidth}px`);
		return true;
	}

	function requestRatingsPopupWindowSize(size) {
		try {
			chrome.runtime.sendMessage({
				type: 'CINETRAKT_RESIZE_IMDB_RATINGS_POPUP',
				width: size.width,
				height: size.height,
			}, () => {
				try {
					void chrome.runtime.lastError;
				} catch (error) {
					return;
				}
			});
		} catch (error) {
			return;
		}
	}

	function sendRatingsPopupSize(root) {
		if (!root.isConnected || root !== ratingsPopupObservedRoot) return;

		const rect = root.getBoundingClientRect();
		const contentWidth = Math.ceil(Math.max(rect.width, root.scrollWidth));
		const contentHeight = Math.ceil(Math.max(rect.height, root.scrollHeight));
		const chromeWidth = Math.max(0, Math.round(window.outerWidth - window.innerWidth));
		const chromeHeight = Math.max(0, Math.round(window.outerHeight - window.innerHeight));
		const size = {
			width: contentWidth + RATINGS_POPUP_PADDING * 2 + chromeWidth,
			height: contentHeight + RATINGS_POPUP_PADDING * 2 + chromeHeight,
		};

		if (lastRatingsPopupSize
			&& Math.abs(lastRatingsPopupSize.width - size.width) <= RATINGS_POPUP_RESIZE_TOLERANCE
			&& Math.abs(lastRatingsPopupSize.height - size.height) <= RATINGS_POPUP_RESIZE_TOLERANCE) return;
		lastRatingsPopupSize = size;
		requestRatingsPopupWindowSize(size);
	}

	function scheduleRatingsPopupResize(root) {
		if (ratingsPopupResizeTimer !== null) window.clearTimeout(ratingsPopupResizeTimer);
		ratingsPopupResizeTimer = window.setTimeout(() => {
			ratingsPopupResizeTimer = null;
			if (configureRatingsPopupContent(root)) sendRatingsPopupSize(root);
		}, 100);
	}

	function observeRatingsPopupContent(root) {
		if (ratingsPopupObservedRoot === root) {
			scheduleRatingsPopupResize(root);
			return;
		}

		disconnectRatingsPopupObservers();
		ratingsPopupObservedRoot = root;
		if (typeof ResizeObserver === 'function') {
			ratingsPopupResizeObserver = new ResizeObserver(() => scheduleRatingsPopupResize(root));
			ratingsPopupResizeObserver.observe(root);
		}
		ratingsPopupMutationObserver = new MutationObserver(() => scheduleRatingsPopupResize(root));
		ratingsPopupMutationObserver.observe(root, { childList: true, subtree: true });
		scheduleRatingsPopupResize(root);
	}

	function getRatingsPopupSeasonCount(root) {
		return root.querySelectorAll('[data-testid="heatmap__seasons-column"] td.ratings-heatmap__table-data').length;
	}

	function getRatingsPopupLoadMoreButton(root) {
		return root.querySelector('[data-testid="heatmap__load-seasons"]');
	}

	function isRatingsPopupLoadMoreButtonReady(button) {
		return !!button
			&& !button.hidden
			&& !button.disabled
			&& button.getAttribute('aria-disabled') !== 'true';
	}

	function waitForRatingsPopupSeasonBatch(root, button, previousSeasonCount, initializationVersion) {
		return new Promise(resolve => {
			let settled = false;
			let timeoutId = null;
			const observer = new MutationObserver(() => {
				if (initializationVersion !== ratingsPopupInitializationVersion
					|| root !== ratingsPopupInitializationRoot
					|| !root.isConnected) {
					finish(false);
					return;
				}
				if (getRatingsPopupSeasonCount(root) > previousSeasonCount) finish(true);
			});

			function finish(loaded) {
				if (settled) return;
				settled = true;
				observer.disconnect();
				if (timeoutId !== null) window.clearTimeout(timeoutId);
				resolve(loaded);
			}

			observer.observe(root, { childList: true, subtree: true });
			timeoutId = window.setTimeout(() => finish(false), RATINGS_POPUP_SEASON_LOAD_TIMEOUT);
			try {
				button.click();
			} catch (error) {
				finish(false);
			}
		});
	}

	function waitForRatingsPopupSettle() {
		return new Promise(resolve => window.setTimeout(resolve, 200));
	}

	function getRatingsPopupStructureSignature(root) {
		const parts = getHeatmapParts();
		if (!root.isConnected || !parts || !root.contains(parts.episodeTable)) return '';
		return [
			parts.seasonCells.length,
			parts.episodeRows.length,
			parts.episodeTable.querySelectorAll('thead th').length,
			getRatingsPopupLoadMoreButton(root) ? 'more' : 'complete',
		].join(':');
	}

	async function waitForStableRatingsPopupStructure(root, initializationVersion) {
		let previousSignature = '';
		let stableSamples = 0;
		for (let attempt = 0; attempt < 8; attempt += 1) {
			await waitForRatingsPopupSettle();
			if (initializationVersion !== ratingsPopupInitializationVersion
				|| root !== ratingsPopupInitializationRoot
				|| !root.isConnected) return false;

			const signature = getRatingsPopupStructureSignature(root);
			stableSamples = signature && signature === previousSignature ? stableSamples + 1 : 0;
			previousSignature = signature;
			if (stableSamples >= 2) return true;
		}
		return false;
	}

	async function autoLoadAllRatingsPopupSeasons(root, initializationVersion) {
		isAutoLoadingSeasons = true;
		allSeasonsLoaded = false;

		for (let iteration = 0; iteration < RATINGS_POPUP_MAX_SEASON_LOADS; iteration += 1) {
			if (initializationVersion !== ratingsPopupInitializationVersion
				|| root !== ratingsPopupInitializationRoot
				|| !root.isConnected) return false;

			const loadMoreButton = getRatingsPopupLoadMoreButton(root);
			if (!loadMoreButton) {
				allSeasonsLoaded = true;
				break;
			}
			if (!isRatingsPopupLoadMoreButtonReady(loadMoreButton)) {
				await waitForRatingsPopupSettle();
				continue;
			}

			const previousSeasonCount = getRatingsPopupSeasonCount(root);
			const loaded = await waitForRatingsPopupSeasonBatch(
				root,
				loadMoreButton,
				previousSeasonCount,
				initializationVersion,
			);
			if (!loaded) break;
			colorizeHeatmap();
			await waitForRatingsPopupSettle();
		}

		if (!getRatingsPopupLoadMoreButton(root)) allSeasonsLoaded = true;
		isAutoLoadingSeasons = false;
		return allSeasonsLoaded;
	}

    function isolateRatingsPopupHeatmap(ratingsRoot) {
        clearRatingsPopupIsolation();

        let current = ratingsRoot;
        while (current && current !== document.body) {
            current.classList.add('cinetrakt-ratings-popup-path');
            const parent = current.parentElement;
            if (!parent) break;

            Array.from(parent.children).forEach(sibling => {
                if (sibling !== current && !sibling.classList.contains('cinetrakt-ratings-popup-loading')) {
                    sibling.classList.add('cinetrakt-ratings-popup-hidden');
                }
            });
            current = parent;
        }

        document.body.classList.add('cinetrakt-ratings-popup-ready');
    }

	function startRatingsPopupInitialization(ratingsRoot, loading) {
		const initializationVersion = ++ratingsPopupInitializationVersion;
		ratingsPopupInitializationRoot = ratingsRoot;
		popupInitializationComplete = false;
		isAutoLoadingSeasons = false;
		allSeasonsLoaded = false;
		disconnectRatingsPopupObservers();
		isolateRatingsPopupHeatmap(ratingsRoot);
		configureRatingsPopupContent(ratingsRoot);
		loading.hidden = false;

		const initialization = (async () => {
			await autoLoadAllRatingsPopupSeasons(ratingsRoot, initializationVersion);
			await waitForStableRatingsPopupStructure(ratingsRoot, initializationVersion);
			if (initializationVersion !== ratingsPopupInitializationVersion
				|| ratingsRoot !== ratingsPopupInitializationRoot
				|| !ratingsRoot.isConnected) return;

			colorizeHeatmap();
			let structureIsValid = false;
			for (let attempt = 0; attempt < 5; attempt += 1) {
				structureIsValid = ensureAverageColumn();
				if (structureIsValid) break;
				await waitForRatingsPopupSettle();
			}
			if (!structureIsValid) return;

			configureRatingsPopupContent(ratingsRoot);
			popupInitializationComplete = true;
			ratingsRoot.dataset.cinetraktRatingsPopupReady = '1';
			observeRatingsPopupContent(ratingsRoot);
			loading.hidden = true;
		})();

		ratingsPopupInitializationPromise = initialization;
		initialization.finally(() => {
			if (ratingsPopupInitializationPromise === initialization) {
				ratingsPopupInitializationPromise = null;
			}
		});
	}

    function setupCineTraktRatingsPopupMode() {
		if (!isCineTraktRatingsPopupMode()) {
			disconnectRatingsPopupObservers();
			return;
		}

        document.documentElement.classList.add('cinetrakt-ratings-popup-mode');
        document.body.classList.add('cinetrakt-ratings-popup-mode');
        const loading = getRatingsPopupLoadingElement();

        if (hasImdbVerificationPage()) {
			disconnectRatingsPopupObservers();
            clearRatingsPopupIsolation();
			document.documentElement.classList.remove('cinetrakt-ratings-popup-mode');
			document.body.classList.remove('cinetrakt-ratings-popup-mode');
			if (document.body.dataset.cinetraktRatingsVerificationSizeRequested !== 'true') {
				document.body.dataset.cinetraktRatingsVerificationSizeRequested = 'true';
				requestRatingsPopupWindowSize({ width: 1000, height: 700 });
			}
            loading.hidden = true;
            return;
        }
		delete document.body.dataset.cinetraktRatingsVerificationSizeRequested;

		const ratingsRoot = document.querySelector('[data-testid="heatmap__root-element"]');
        if (!ratingsRoot || !configureRatingsPopupContent(ratingsRoot)) {
			if (ratingsRoot !== ratingsPopupInitializationRoot) {
				ratingsPopupInitializationVersion += 1;
				ratingsPopupInitializationRoot = null;
				popupInitializationComplete = false;
			}
			disconnectRatingsPopupObservers();
            clearRatingsPopupIsolation();
            loading.hidden = false;
            return;
        }

		if (ratingsRoot !== ratingsPopupInitializationRoot) {
			startRatingsPopupInitialization(ratingsRoot, loading);
			return;
		}

		if (ratingsPopupInitializationPromise && !popupInitializationComplete) {
			loading.hidden = false;
			return;
		}

		if (!popupInitializationComplete) {
			startRatingsPopupInitialization(ratingsRoot, loading);
			return;
		}

		colorizeHeatmap();
		ensureAverageColumn();
		configureRatingsPopupContent(ratingsRoot);
		observeRatingsPopupContent(ratingsRoot);
		loading.hidden = true;
    }

    function colorizeHeatmap() {
        const parts = getHeatmapParts();
        if (!parts) return;

        parts.episodeRows.forEach(row => {
            getEpisodeCells(row).forEach(td => {
                const box = td.querySelector('div');
                const link = td.querySelector('a');
                if (!box || !link) return;

                const rating = parseRatingText(link.textContent);
                if (!Number.isFinite(rating)) return;

                const style = getStyleForRating(rating);

                box.classList.add('sg-rating-cell');
                box.style.setProperty('background-color', style.bg, 'important');
                box.style.setProperty('background-image', 'none', 'important');
                box.style.setProperty('box-shadow', 'none', 'important');

                link.classList.add('sg-rating-text');
                link.textContent = formatRating(rating);
                link.style.setProperty('color', style.text, 'important');
                link.style.setProperty('--sg-rating-text-color', style.text);

                if (link.hasAttribute('title')) {
                    link.removeAttribute('title');
                }
            });
        });
    }

    function calculateAverages() {
        const parts = getHeatmapParts();
        if (!parts) return [];

        const results = [];
        const rowCount = Math.min(parts.seasonCells.length, parts.episodeRows.length);

        for (let i = 0; i < rowCount; i++) {
            const row = parts.episodeRows[i];
            const links = Array.from(row.querySelectorAll('td.ratings-heatmap__table-data a'));
            results.push(calculateAverage(links.map(link => parseRatingText(link.textContent))));
        }

        return results;
    }

    function removeAverageColumn() {
        document.querySelectorAll('[data-sg-avg="true"]').forEach(el => el.remove());
    }

    function setAverageCellValue(avgBox, average) {
		avgBox.style.setProperty('background', 'transparent', 'important');
		avgBox.style.setProperty('background-color', 'transparent', 'important');
		avgBox.style.setProperty('background-image', 'none', 'important');
		avgBox.style.setProperty('border', '0', 'important');
		avgBox.style.setProperty('box-shadow', 'none', 'important');

		if (Number.isFinite(average)) {
			const displayedAvg = formatRating(average);
			const style = getStyleForRating(parseRatingText(displayedAvg));
			avgBox.textContent = displayedAvg;
			avgBox.style.setProperty('color', style.bg, 'important');
		} else {
			avgBox.textContent = '';
			avgBox.style.setProperty('color', 'transparent', 'important');
		}
	}

	function ensureAverageColumn() {
        const parts = getHeatmapParts();
        if (!parts) return false;

        const averages = calculateAverages();
        const headerRow = parts.episodeTable.querySelector('thead tr');
        const firstHeader = headerRow ? headerRow.querySelector('th') : null;

		if (headerRow && firstHeader && !headerRow.querySelector(':scope > th[data-sg-avg="true"]')) {
            const avgHeader = firstHeader.cloneNode(false);
            avgHeader.dataset.sgAvg = 'true';
            avgHeader.classList.add('sg-avg-th', 'sg-avg-header');
            avgHeader.textContent = 'AVG';
            headerRow.insertBefore(avgHeader, firstHeader);
        }

        parts.episodeRows.forEach((episodeRow, index) => {
            const firstRealCell = getEpisodeCells(episodeRow)[0];
            if (!firstRealCell) return;

			let avgCell = episodeRow.querySelector(':scope > td[data-sg-avg="true"]');
			let avgBox = avgCell?.querySelector('.sg-avg-cell-box');
			if (!avgCell || !avgBox) {
				const sourceBox = firstRealCell.querySelector('div');
				if (!sourceBox) return;
				avgCell?.remove();
				avgCell = firstRealCell.cloneNode(false);
				avgCell.dataset.sgAvg = 'true';
				avgCell.classList.add('sg-avg-td');
				avgBox = sourceBox.cloneNode(false);
				avgBox.classList.add('sg-avg-cell-box');
				avgBox.classList.remove('sg-rating-cell');
				avgCell.appendChild(avgBox);
				episodeRow.insertBefore(avgCell, firstRealCell);
			}

			setAverageCellValue(avgBox, averages[index]);
        });

		return validateRatingsTableStructure();
    }

    function buildAverageColumn() {
		removeAverageColumn();
		return ensureAverageColumn();
    }

    function colorizeHistogram() {
        document.querySelectorAll('[data-testid="histogram-container"] path[aria-label]').forEach(path => {
            const label = path.getAttribute('aria-label');
            const match = label && label.match(/^(\d+)/);
            if (!match) return;

            const rating = parseFloat(match[1]);
            if (!Number.isFinite(rating)) return;

            const style = getStyleForRating(rating);
            path.style.setProperty('fill', style.bg, 'important');
            path.style.setProperty('stroke', style.bg, 'important');
        });
    }

    function colorizeMainImdbRating() {
        const roots = Array.from(document.querySelectorAll([
            '[data-testid="hero-rating-bar__aggregate-rating__score"]',
            '[data-testid="hero-rating-bar__aggregate-rating"]',
            '[data-testid="aggregate-rating"]',
            'a[href$="/ratings/"]',
            'a[href*="/ratings/?"]'
        ].join(',')));

        roots.forEach(root => {
            const candidates = Array.from(root.querySelectorAll('span, div'));
            const ratingEl = candidates.find(el => isExactRatingText(getDirectText(el) || el.textContent));

            if (!ratingEl) return;

            const rating = parseRatingText(getDirectText(ratingEl) || ratingEl.textContent);
            if (!Number.isFinite(rating)) return;

            const style = getStyleForRating(rating);

            ratingEl.classList.add('sg-main-rating-colored');
            ratingEl.style.setProperty('color', style.bg, 'important');
            ratingEl.style.setProperty('background', 'transparent', 'important');
            ratingEl.style.setProperty('background-color', 'transparent', 'important');
            ratingEl.style.setProperty('border', '0', 'important');
            ratingEl.style.setProperty('box-shadow', 'none', 'important');
            ratingEl.style.setProperty('padding', '0', 'important');
        });
    }

    function colorizeMainUserRating() {
        const roots = Array.from(document.querySelectorAll([
            '[data-testid="hero-rating-bar__user-rating"]',
            '[data-testid="hero-rating-bar__user-rating__score"]'
        ].join(',')));

        roots.forEach(root => {
            const candidates = Array.from(root.querySelectorAll('span, div, button'));
            const ratingEl = candidates.find(el => isExactRatingText(getDirectText(el) || el.textContent));

            if (!ratingEl) return;

            const rating = parseRatingText(getDirectText(ratingEl) || ratingEl.textContent);
            if (!Number.isFinite(rating)) return;

            const style = getStyleForRating(rating);

            ratingEl.classList.add('sg-main-rating-colored');
            ratingEl.style.setProperty('color', style.bg, 'important');
            ratingEl.style.setProperty('background', 'transparent', 'important');
            ratingEl.style.setProperty('background-color', 'transparent', 'important');
            ratingEl.style.setProperty('border', '0', 'important');
            ratingEl.style.setProperty('box-shadow', 'none', 'important');
            ratingEl.style.setProperty('padding', '0', 'important');
        });
    }

    function colorizeTitlePageEpisodeRatings() {
        const roots = new Set();

        document.querySelectorAll('[data-testid*="episode"], [class*="episode"], [aria-label*="episode" i], [aria-label*="Episode" i]').forEach(root => {
            roots.add(root);
        });

        const episodesSection = findSectionByTitle('Episodes');
        if (episodesSection) roots.add(episodesSection);

        roots.forEach(root => colorizeExactRatingElements(root));
    }

    function colorizeTitlePageAverageRatings() {
        document.querySelectorAll('section, div, span').forEach(root => {
            if (isInsideSeriesGraph(root)) return;

            const text = root.textContent || '';
            if (!text.includes('Average')) return;
            if (!/\d+(?:[.,]\d+)?\s+Average/.test(text)) return;

            colorizeExactRatingElements(root);
        });
    }

    function colorizeRatingsNextToLabels() {
        const wantedLabels = new Set(['IMDB RATING', 'YOUR RATING']);
        const labels = Array.from(document.querySelectorAll('div, span, p'))
            .filter((element) => wantedLabels.has(getDirectText(element).toUpperCase()));

        labels.forEach((label) => {
            let root = label.parentElement;
            for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
                const rootText = (root.textContent || '').replace(/\s+/g, ' ').trim();
                if (!/\d+(?:[.,]\d+)?\s*\/\s*10/.test(rootText)) continue;
                if (rootText.length > 220) continue;

                const candidates = Array.from(root.querySelectorAll('span, div, button, a'))
                    .filter((element) => element !== label && !label.contains(element))
                    .map((element) => ({ element, text: getShortRatingText(element) }))
                    .filter((item) => Number.isFinite(parseRatingFromShortTextFallback(item.text)))
                    .sort((a, b) => a.text.length - b.text.length);

                const candidate = candidates[0];
                if (!candidate) continue;

                const rating = parseRatingFromShortTextFallback(candidate.text);
                applyInlineRatingColor(candidate.element, rating);
                break;
            }
        });
    }



    function removeSlashTenAroundScoreValue(root) {
        if (!root) return;

        const ratingElements = Array.from(root.querySelectorAll('span, div, p'))
            .filter(element => isExactRatingText(getDirectText(element) || element.textContent));

        ratingElements.forEach(ratingEl => {
            let container = ratingEl.parentElement;
            for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
                const text = (container.textContent || '').replace(/\s+/g, ' ').trim();
                if (!/^\d+(?:[.,]\d+)?\s*\/\s*10$/.test(text)) continue;

                let passedRating = false;
                Array.from(container.childNodes).forEach(node => {
                    if (node === ratingEl || (node.nodeType === Node.ELEMENT_NODE && node.contains(ratingEl))) {
                        passedRating = true;
                        return;
                    }

                    if (!passedRating) return;

                    if (node.nodeType === Node.TEXT_NODE) {
                        const nodeText = node.textContent || '';
                        if (/^\s*(?:\/|10)\s*$/.test(nodeText)) node.textContent = '';
                        if (/\/\s*10/.test(nodeText)) node.textContent = nodeText.replace(/\s*\/\s*10\b/g, '');
                        return;
                    }

                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const element = node;
                        const elementText = (element.textContent || '').replace(/\s+/g, ' ').trim();
                        if (/^(?:\/|10|\/\s*10)$/.test(elementText)) {
                            element.textContent = '';
                            element.style.setProperty('display', 'none', 'important');
                        }
                    }
                });

                break;
            }
        });
    }

    function removeSlashTenInRoot(root) {
        if (!root) return;

        let changed = false;

        Array.from(root.querySelectorAll('span, div, p')).forEach(element => {
            if (element.children.length) return;

            const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^\/\s*10$/.test(text)) {
                element.textContent = '';
                element.style.setProperty('display', 'none', 'important');
                changed = true;
            }
        });

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const text = node.textContent || '';
                return /\/\s*10/.test(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            const oldText = node.textContent || '';
            const newText = oldText.replace(/\s*\/\s*10\b/g, '');
            if (newText !== oldText) {
                node.textContent = newText;
                changed = true;
            }
        });

    }

    function hideSlashTenNextToRatingLabels() {
        const wantedLabels = new Set(['IMDB RATING', 'YOUR RATING']);
        const labels = Array.from(document.querySelectorAll('div, span, p'))
            .filter((element) => wantedLabels.has(getDirectText(element).toUpperCase()));

        labels.forEach((label) => {
            let root = label.parentElement;
            for (let depth = 0; root && depth < 6; depth++, root = root.parentElement) {
                const rootText = (root.textContent || '').replace(/\s+/g, ' ').trim();
                if (!/\d+(?:[.,]\d+)?\s*\/\s*10/.test(rootText)) continue;
                if (rootText.length > 240) continue;

                removeSlashTenAroundScoreValue(root);
                removeSlashTenInRoot(root);
                break;
            }
        });

        document.querySelectorAll([
            '[data-testid="hero-rating-bar__aggregate-rating__score"]',
            '[data-testid="hero-rating-bar__aggregate-rating"]',
            '[data-testid="hero-rating-bar__user-rating"]',
            '[data-testid="hero-rating-bar__user-rating__score"]',
            '[data-testid="aggregate-rating"]',
            'a[href$="/ratings/"]',
            'a[href*="/ratings/?"]'
        ].join(',')).forEach(root => {
            removeSlashTenAroundScoreValue(root);
            removeSlashTenInRoot(root);
        });
    }



    function hideSlashTenEverywhereSafe() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const text = node.textContent || '';
                if (!/\/\s*10\b/.test(text)) return NodeFilter.FILTER_REJECT;

                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (parent.closest('script, style, textarea, input')) return NodeFilter.FILTER_REJECT;

                const context = parent.closest('[data-testid*="rating" i], [class*="rating" i], a[href*="/ratings"]');
                const around = (parent.closest('section, div, a')?.textContent || '').replace(/\s+/g, ' ').trim();

                if (context) return NodeFilter.FILTER_ACCEPT;
                if (around.length <= 260 && /(?:IMDb Rating|Your Rating|IMDb rating|Your rating|IMDB RATING|YOUR RATING)/i.test(around)) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                if (/^\s*\/\s*10\s*$/.test(text)) return NodeFilter.FILTER_ACCEPT;

                return NodeFilter.FILTER_REJECT;
            }
        });

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            node.textContent = (node.textContent || '').replace(/\s*\/\s*10\b/g, '');
        });
    }

    function resetPopularityColors() {
        document.querySelectorAll('.sg-inline-rating-colored, .sg-main-rating-colored').forEach(element => {
            if (!isInsidePopularityArea(element)) return;

            element.classList.remove('sg-inline-rating-colored', 'sg-main-rating-colored');
            element.style.removeProperty('color');
            element.style.removeProperty('background');
            element.style.removeProperty('background-color');
            element.style.removeProperty('border');
            element.style.removeProperty('box-shadow');
            element.style.removeProperty('text-shadow');
            element.style.removeProperty('padding');
        });
    }

    function colorizeTitlePageRatings() {
        colorizeMainImdbRating();
        colorizeMainUserRating();
        colorizeRatingsNextToLabels();
        colorizeTitlePageEpisodeRatings();
        colorizeTitlePageAverageRatings();
        hideSlashTenNextToRatingLabels();
        document.querySelectorAll('[data-testid="hero-rating-bar__aggregate-rating__score"], [data-testid="hero-rating-bar__user-rating__score"]').forEach(removeSlashTenAroundScoreValue);
        hideSlashTenEverywhereSafe();
        resetPopularityColors();
    }

    function removeOldElements() {
        document.getElementById('sg-legend-container')?.remove();

        document.querySelectorAll('.sg-rating-legend, .sg-legend, [data-sg-legend="true"]').forEach(el => el.remove());

        removeAverageColumn();
    }

    function runUpdates() {
		if (isCineTraktRatingsPopupMode()) {
			setupCineTraktRatingsPopupMode();
			return;
		}

        removeOldElements();
        colorizeHeatmap();
        colorizeHistogram();
        colorizeTitlePageRatings();
        buildAverageColumn();
    }

    function init() {
        injectStyles();
		if (isCineTraktRatingsPopupMode()) {
			document.documentElement.classList.add('cinetrakt-ratings-popup-mode');
			document.body.classList.add('cinetrakt-ratings-popup-mode');
			getRatingsPopupLoadingElement();
		}
        runUpdates();

        const lazyUpdate = debounce(runUpdates, DEBOUNCE_TIME);

        const observer = new MutationObserver(mutations => {
            const shouldUpdate = mutations.some(mutation => {
                if (mutation.type !== 'childList') return false;

                const added = Array.from(mutation.addedNodes);
                return added.some(node => {
                    if (!(node instanceof HTMLElement)) return false;
                    if (node.id === 'sg-average-column-table') return false;
                    return true;
                });
            });

            if (shouldUpdate) lazyUpdate();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    init();
})();
