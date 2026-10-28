(function () {
    'use strict';


    const {
        getStyleForRating,
        formatRating,
        calculateAverage,
        parseDisplayRating,
    } = globalThis.CineTraktRatingUtils;
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

    `;

    function injectStyles() {
        if (document.getElementById('sg-styles')) return;

        const style = document.createElement('style');
        style.id = 'sg-styles';
        style.textContent = STYLES;
        document.head.appendChild(style);
    }

    function parseRatingText(text) {
        return parseDisplayRating(text) ?? NaN;
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
		if (!globalThis.CineTraktSettings.isEnabled('imdbRatingColors')) return;

        removeOldElements();
        colorizeHeatmap();
        colorizeHistogram();
        colorizeTitlePageRatings();
        buildAverageColumn();
    }

    function initialize() {
        if (globalThis.CineTraktSettings.isEnabled('imdbRatingColors')) injectStyles();
    }

    globalThis.CineTraktImdbRatings = Object.freeze({
        initialize,
        update: runUpdates,
    });
})();
