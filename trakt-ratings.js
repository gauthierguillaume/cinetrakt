(() => {
	'use strict';
	const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;

	const {
		getCurrentScreenBounds: getCurrentScreenBoundsForPopup,
		sendRuntimeMessage: sendCinetraktRuntimeMessage,
	} = globalThis.CineTraktStremioOpen;
	const {
		getImdbIdFromPage,
		getCachedImdbId: getCachedTraktImdbId,
		getShowSlugFromUrl: getShowSlugFromTraktUrl,
		resolveImdbIdFromMediaUrl: getImdbIdFromTraktMediaUrl,
		resolveImdbIdFromShowUrl: getImdbIdFromTraktShowUrl,
	} = globalThis.CineTraktTraktStremioUi;
	const {
		formatRating: formatWatchOnStremioRatingValue,
		getStarFillRatios: getWatchOnStremioStarRatiosFromRating,
		parseDisplayRating,
	} = globalThis.CineTraktRatingUtils;

	function isCinetraktFeatureEnabled(key) {
		return globalThis.CineTraktSettings?.isEnabled(key) !== false;
	}

	let cinetraktRatingColorsEnabled = null;

	function setCinetraktTextIfChanged(element, value) {
		const nextText = String(value ?? '');
		if (element && element.textContent !== nextText) element.textContent = nextText;
	}

	function setCinetraktDatasetIfChanged(element, key, value) {
		const nextValue = String(value);
		if (element?.dataset && element.dataset[key] !== nextValue) {
			element.dataset[key] = nextValue;
		}
	}

	function setCinetraktImportantStyleIfChanged(element, property, value) {
		if (!element) return;
		if (
			element.style.getPropertyValue(property) !== value
			|| element.style.getPropertyPriority(property) !== 'important'
		) {
			element.style.setProperty(property, value, 'important');
		}
	}

	function removeCinetraktStyleIfPresent(element, property) {
		if (!element) return;
		if (
			element.style.getPropertyValue(property)
			|| element.style.getPropertyPriority(property)
		) {
			element.style.removeProperty(property);
		}
	}

	function toggleCinetraktClass(element, className, enabled) {
		if (element && element.classList.contains(className) !== enabled) {
			element.classList.toggle(className, enabled);
		}
	}
/*
	TRAKT V3 — colorisation des notes sur les fiches films / séries.
	On cible uniquement le bloc officiel des ratings Trakt :
	Trakt %, IMDb /10, Rotten Tomatoes %, PopcornMeter %, etc.
*/
function getWatchOnStremioRatingColor(rating) {
	return globalThis.CineTraktRatingUtils.getStyleForRating(rating)
		|| globalThis.CineTraktRatingUtils.COLORS[1];
}

function parseWatchOnStremioTraktRatingValue(text) {
	return parseDisplayRating(text) ?? NaN;
}

function colorizeWatchOnStremioTraktValue(valueElement) {
	if (!valueElement) return;

	const text = (valueElement.textContent || "").trim();
	const rating = parseWatchOnStremioTraktRatingValue(text);
	if (!Number.isFinite(rating)) return;

	const color = getWatchOnStremioRatingColor(rating).bg;

	setCinetraktDatasetIfChanged(valueElement, 'watchOnStremioRatingColored', 'true');
	setCinetraktImportantStyleIfChanged(valueElement, 'color', color);
	setCinetraktImportantStyleIfChanged(valueElement, 'text-decoration-color', color);
	setCinetraktImportantStyleIfChanged(valueElement, 'text-shadow', 'none');
}

function colorizeTraktSummaryRatings() {
	if (window.location.hostname !== "app.trakt.tv") return;
	if (!/^\/(shows|movies)\//.test(window.location.pathname)) return;

	const summaryRatings = document.querySelector(".trakt-summary-ratings, [class*='trakt-summary-ratings']");
	if (!summaryRatings) return;

	// Structure Trakt actuelle : .rating-value > p.bold
	// On colorise seulement la valeur, jamais le vote count.
	summaryRatings.querySelectorAll("[class*='rating-value']").forEach((ratingValueBox) => {
		const valueElement = ratingValueBox.querySelector("p, span, div") || ratingValueBox;
		colorizeWatchOnStremioTraktValue(valueElement);
	});
}

function colorizeTraktImdbRatings() {
	// Ancien nom conservé pour ne pas toucher au reste du fichier.
	// Maintenant ça colorise les 4 notes du bloc Trakt, pas seulement IMDb.
	colorizeTraktSummaryRatings();
}


function injectWatchOnStremioTraktRatingStyles() {
	if (document.getElementById('watch-on-stremio-trakt-rating-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-trakt-rating-styles';
	style.textContent = `
		.wos-personal-rating-value {
			display: inline-flex !important;
			align-items: center !important;
			font-weight: 700 !important;
			line-height: 1 !important;
		}
		.wos-personal-star-colored,
		.wos-personal-star-colored button,
		.wos-personal-star-colored svg {
			color: inherit !important;
		}
	`;
	document.head.appendChild(style);
}


function getWatchOnStremioStarFillRatio(starUnit) {
	if (!starUnit) return 0;

	// Sur Trakt V3, le vrai état de l'étoile est sur le wrapper :
	// <div class="trakt-rate-button ..." data-star-fill="full|half|none">
	// Il ne faut PAS se baser sur le <button aria-label="Rate with 4 stars">,
	// sinon on lit le bouton de vote possible, pas la note déjà choisie.
	const dataFill = String(starUnit.getAttribute?.('data-star-fill') || '').toLowerCase();

	if (dataFill === 'full') return 1;
	if (dataFill === 'half') return 0.5;
	if (dataFill === 'none') return 0;

	const stateText = [
		starUnit.getAttribute?.('data-state'),
		starUnit.getAttribute?.('data-fill'),
		starUnit.getAttribute?.('data-rating-state'),
		starUnit.getAttribute?.('aria-checked'),
		starUnit.getAttribute?.('aria-pressed'),
		starUnit.getAttribute?.('aria-current'),
		starUnit.className,
	].join(' ').toLowerCase();

	if (/\b(half|partial)\b/.test(stateText)) return 0.5;
	if (/\b(full|filled|active|selected|rated|true|current)\b/.test(stateText)) return 1;
	if (/\b(empty|none|false)\b/.test(stateText)) return 0;

	return 0;
}

function getWatchOnStremioTraktStarUnits(starsBox) {
	if (!starsBox) return [];

	// Important : on prend les wrappers avec data-star-fill, pas les boutons internes.
	// Les boutons indiquent "Rate with X stars" et ne représentent pas forcément la note actuelle.
	const units = Array.from(starsBox.querySelectorAll('[data-star-fill]'));

	const dataStarUnits = units
		.filter((element) => element.getAttribute('data-star-fill') !== null)
		.slice(0, 5);

	if (dataStarUnits.length) return dataStarUnits;

	const buttonUnits = Array.from(starsBox.querySelectorAll('button[aria-label*="star" i], button[aria-label*="rate" i], [role="button"][aria-label*="star" i], [role="button"][aria-label*="rate" i]'))
		.map((button) => button.closest('[data-state], [data-fill], [data-rating-state], [class*="star"], [class*="rate-button"]') || button)
		.filter((element, index, list) => element && list.indexOf(element) === index)
		.slice(0, 5);

	if (buttonUnits.length) return buttonUnits;

	return Array.from(starsBox.querySelectorAll('svg'))
		.map((svg) => svg.closest('[class*="star"], [class*="rate-button"], button, [role="button"]') || svg)
		.filter((element, index, list) => element && list.indexOf(element) === index)
		.slice(0, 5);
}

function setWatchOnStremioStarColor(starUnit, color, enabled) {
	if (!starUnit) return;

	toggleCinetraktClass(starUnit, 'wos-personal-star-colored', enabled);

	// Important pour les demi-étoiles Trakt :
	// on ne force jamais fill/stroke sur les <path>/<rect>.
	// Trakt gère déjà full / half / none avec data-star-fill + un clipPath.
	// On change seulement currentColor sur le wrapper, le bouton et le svg,
	// comme ça une demi-étoile reste vraiment une demi-étoile.
	const colorTargets = [starUnit, ...starUnit.querySelectorAll('button, svg')];
	const shapeTargets = starUnit.querySelectorAll('path, rect, use');

	colorTargets.forEach((element) => {
		if (enabled) {
			setCinetraktImportantStyleIfChanged(element, 'color', color);
		} else {
			removeCinetraktStyleIfPresent(element, 'color');
		}
	});

	shapeTargets.forEach((element) => {
		// Nettoie les anciennes versions qui forçaient le remplissage complet.
		removeCinetraktStyleIfPresent(element, 'fill');
		removeCinetraktStyleIfPresent(element, 'stroke');
		removeCinetraktStyleIfPresent(element, 'color');
	});
}

function getWatchOnStremioPersonalRatingLabel(rateNowBox) {
	if (!rateNowBox) return null;

	// Structure actuelle Trakt :
	// <div class="trakt-rate-now ...">
	//   <span class="bold">Rate</span>
	//   <div class="trakt-rate-actions">...</div>
	// </div>
	// On cible d'abord ce span direct pour éviter de modifier un élément interne aux étoiles.
	const directLabel = rateNowBox.querySelector(':scope > span.bold, :scope > span[class*="bold"]');
	if (directLabel) return directLabel;

	return Array.from(rateNowBox.children).find((element) => {
		const text = (element.textContent || '').trim();
		return element.tagName.toLowerCase() === 'span' && (text === 'Rate' || /^\d+(?:\.\d+)?$/.test(text));
	}) || null;
}

function getWatchOnStremioPersonalRatingFromMetadata(rateNowBox, starsBox) {
	const candidates = [rateNowBox, starsBox, ...Array.from(starsBox?.querySelectorAll?.('button, [role="button"], [aria-label], [title], [data-rating], [data-value], [data-score]') || [])];

	for (const element of candidates) {
		if (!element) continue;

		const values = [
			{ source: 'data', value: element.getAttribute?.('data-rating') },
			{ source: 'data', value: element.getAttribute?.('data-value') },
			{ source: 'data', value: element.getAttribute?.('data-score') },
			{ source: 'label', value: element.getAttribute?.('aria-label') },
			{ source: 'label', value: element.getAttribute?.('title') },
		];

		for (const { source, value } of values) {
			const text = String(value || '').replace(',', '.');
			if (source === 'label' && /\brate\s+with\b/i.test(text)) continue;
			if (source === 'label' && !/\b(your|rated|current|selected|rating)\b/i.test(text)) continue;

			const outOfTen = text.match(/(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*10/i);
			if (outOfTen) {
				const rating = Number(outOfTen[1]);
				if (Number.isFinite(rating) && rating > 0 && rating <= 10) return rating;
			}

			const stars = text.match(/(\d+(?:\.\d+)?)\s*stars?/i);
			if (stars) {
				const rating = Number(stars[1]) * 2;
				if (Number.isFinite(rating) && rating > 0 && rating <= 10) return rating;
			}
		}
	}

	return NaN;
}

function colorizeTraktPersonalRating() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\//.test(window.location.pathname)) return;

	injectWatchOnStremioTraktRatingStyles();

	document.querySelectorAll('.trakt-rate-now, [class*="trakt-rate-now"]').forEach((rateNowBox) => {
		const starsBox = rateNowBox.querySelector('[class*="trakt-rating-stars"], [class*="trakt-ratings-stars"]');
		if (!starsBox) return;

		const starUnits = getWatchOnStremioTraktStarUnits(starsBox).slice(0, 5);
		if (!starUnits.length) return;

		let starTotal = 0;
		const ratios = starUnits.map((starUnit) => {
			const ratio = getWatchOnStremioStarFillRatio(starUnit);
			starTotal += ratio;
			return ratio;
		});

		const label = getWatchOnStremioPersonalRatingLabel(rateNowBox);
		if (!label) return;
		if (!label.dataset.cinetraktOriginalRatingLabel) {
			setCinetraktDatasetIfChanged(
				label,
				'cinetraktOriginalRatingLabel',
				label.textContent || 'Rate',
			);
		}

		let rating10 = NaN;
		let effectiveRatios = ratios;

		if (starTotal <= 0) {
			rating10 = getWatchOnStremioPersonalRatingFromMetadata(rateNowBox, starsBox);
			effectiveRatios = getWatchOnStremioStarRatiosFromRating(rating10, starUnits.length);

			if (!Number.isFinite(rating10)) {
				toggleCinetraktClass(label, 'wos-personal-rating-value', false);
				setCinetraktTextIfChanged(label, 'Rate');
				removeCinetraktStyleIfPresent(label, 'color');
				removeCinetraktStyleIfPresent(label, 'text-shadow');
				starUnits.forEach((starUnit) => setWatchOnStremioStarColor(starUnit, '', false));
				return;
			}
		} else {
			rating10 = Math.round(starTotal * 2 * 10) / 10;
		}

		const color = getWatchOnStremioRatingColor(rating10).bg;

		toggleCinetraktClass(label, 'wos-personal-rating-value', true);
		setCinetraktDatasetIfChanged(label, 'watchOnStremioPersonalRating', 'true');
		setCinetraktTextIfChanged(label, formatWatchOnStremioRatingValue(rating10));
		setCinetraktImportantStyleIfChanged(label, 'color', color);
		setCinetraktImportantStyleIfChanged(label, 'text-shadow', 'none');

		starUnits.forEach((starUnit, index) => {
			setWatchOnStremioStarColor(starUnit, color, effectiveRatios[index] > 0);
		});
	});
}

function resetTraktRatingColors() {
	document.querySelectorAll('[data-watch-on-stremio-rating-colored="true"]').forEach((element) => {
		element.style.removeProperty('color');
		element.style.removeProperty('text-decoration-color');
		element.style.removeProperty('text-shadow');
		delete element.dataset.watchOnStremioRatingColored;
	});

	document.querySelectorAll('[data-cinetrakt-original-rating-label]').forEach((label) => {
		label.textContent = label.dataset.cinetraktOriginalRatingLabel || 'Rate';
		delete label.dataset.cinetraktOriginalRatingLabel;
		delete label.dataset.watchOnStremioPersonalRating;
		label.classList.remove('wos-personal-rating-value');
		label.style.removeProperty('color');
		label.style.removeProperty('text-shadow');
	});

	document.querySelectorAll('.wos-personal-star-colored').forEach((starUnit) => {
		setWatchOnStremioStarColor(starUnit, '', false);
	});
}



/* Sur la fiche, CineTrakt garde uniquement IMDb. Le clic sur la note ouvre
	IMDb, tandis que la flèche native voisine conserve le panneau Ratings. */
function injectWatchOnStremioTraktMoreRatingsStyles() {
	if (document.getElementById('watch-on-stremio-trakt-more-ratings-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-trakt-more-ratings-styles';
	style.textContent = `
		.wos-trakt-rating-hidden {
			display: none !important;
		}

		.trakt-summary-ratings.wos-trakt-ratings-imdb-only {
			display: inline-flex !important;
			align-items: center !important;
		}

		.wos-imdb-direct-link {
			cursor: pointer !important;
		}

		.wos-imdb-ratings-popup-row {
			display: inline-flex !important;
			flex-flow: row nowrap !important;
			align-items: center !important;
			width: max-content !important;
			max-width: 100% !important;
			vertical-align: middle !important;
		}

		.wos-imdb-ratings-popup-button {
			appearance: none !important;
			box-sizing: border-box !important;
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			flex: 0 0 auto !important;
			width: 38px !important;
			height: 24px !important;
			margin: 0 0 0 6px !important;
			padding: 0 !important;
			border: 0 !important;
			border-radius: 5px !important;
			color: rgba(255, 255, 255, 0.52) !important;
			background: transparent !important;
			box-shadow: none !important;
			outline: none !important;
			cursor: pointer !important;
			pointer-events: auto !important;
			position: relative !important;
			z-index: 3 !important;
			transition: background-color 140ms ease, color 140ms ease, transform 140ms ease !important;
		}

		.wos-imdb-ratings-popup-button:hover {
			color: rgba(255, 255, 255, 0.9) !important;
			background: rgba(255, 255, 255, 0.08) !important;
			border: 0 !important;
			box-shadow: none !important;
			transform: scale(1.04) !important;
		}

		.wos-imdb-ratings-popup-button:focus-visible {
			outline: 1px solid rgba(255, 255, 255, 0.72) !important;
			outline-offset: 2px !important;
		}

		.wos-imdb-ratings-popup-button svg {
			display: block !important;
			width: 31px !important;
			height: 15px !important;
			pointer-events: none !important;
			transform: scale(1) !important;
			transform-origin: center !important;
			transition: transform 140ms ease !important;
		}

		.wos-imdb-ratings-popup-button rect {
			fill: currentColor !important;
			transition: fill 160ms ease !important;
		}

		.wos-imdb-ratings-popup-button .wos-grid-blue { fill: #3b82f6 !important; }
		.wos-imdb-ratings-popup-button .wos-grid-green { fill: #22c55e !important; }
		.wos-imdb-ratings-popup-button .wos-grid-yellow { fill: #eab308 !important; }
		.wos-imdb-ratings-popup-button .wos-grid-pink { fill: #ec4899 !important; }
		.wos-imdb-ratings-popup-button .wos-grid-purple { fill: #8b5cf6 !important; }

		.wos-imdb-ratings-popup-button:hover svg,
		.wos-imdb-ratings-popup-button:focus-visible svg {
			transform: scale(1.04) !important;
		}

		.wos-imdb-ratings-popup-button[hidden] {
			display: none !important;
		}
	`;
	document.head.appendChild(style);
}

function isWatchOnStremioImdbRatingItem(ratingItem) {
	if (!ratingItem) return false;

	const link = ratingItem.querySelector('a[href*="imdb.com/title/tt"], a[href*="imdb.com/title/"]');
	if (link) return true;

	const text = (ratingItem.textContent || '').toLowerCase();
	if (text.includes('imdb')) return true;
	const svgTitle = Array.from(ratingItem.querySelectorAll('svg title'))
		.some((title) => (title.textContent || '').toLowerCase().includes('imdb'));
	if (svgTitle) return true;

	const img = ratingItem.querySelector('img[alt*="IMDb" i], svg[aria-label*="IMDb" i], [title*="IMDb" i]');
	if (img) return true;

	// Trakt's current inline IMDb mark has no accessible label. Its official
	// logo geometry is distinctive and more stable than generated Svelte classes.
	const imdbLogo = Array.from(ratingItem.querySelectorAll('svg')).some((svg) => {
		const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
		if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) return false;
		const [, , width, height] = viewBox;
		const usesImdbYellow = Array.from(svg.querySelectorAll('[fill]'))
			.some((element) => (element.getAttribute('fill') || '').toLowerCase() === '#f6c700');
		return width > 500 && height > 250 && width / height > 1.8 && usesImdbYellow;
	});
	return imdbLogo;
}

function getWatchOnStremioTraktRatingItems(summaryRatings) {
	if (!summaryRatings) return [];
	const rowRatings = Array.from(summaryRatings.querySelectorAll('rating[data-variant="row"]'));
	if (rowRatings.length) return rowRatings;

	return Array.from(summaryRatings.children).filter((child) => {
		if (child.classList?.contains('wos-trakt-ratings-toggle')) return false;
		if (child.classList?.contains('wos-imdb-ratings-popup-button')) return false;
		if (child.matches?.('rating, [class*="rating"]')) return true;
		return !!child.querySelector?.('[class*="rating-value"], a[href*="imdb.com/title/"]');
	});
}

function getWatchOnStremioImdbRatingsId(summaryRatings) {
	const imdbLink = summaryRatings?.querySelector('a[href*="imdb.com/title/tt"]');
	const imdbFromRatings = imdbLink?.href?.match(/tt\d{7,}/i)?.[0];
	if (imdbFromRatings) return imdbFromRatings;

	const showSlug = getShowSlugFromTraktUrl(window.location.href);
	return getCachedTraktImdbId(showSlug) || getImdbIdFromPage() || '';
}

function openWatchOnStremioImdbTitle(imdbId) {
	if (!/^tt\d{7,}$/.test(imdbId)) return false;

	const link = document.createElement('a');
	link.href = `https://www.imdb.com/title/${imdbId}/`;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.hidden = true;
	document.body.appendChild(link);
	link.click();
	link.remove();
	return true;
}

function bindWatchOnStremioImdbDirectLink(imdbItem, imdbId) {
	if (!imdbItem || !/^tt\d{7,}$/.test(imdbId)) return;

	imdbItem.classList.add('wos-imdb-direct-link');
	imdbItem.dataset.cinetraktImdbId = imdbId;
	imdbItem.setAttribute('title', 'Open on IMDb');

	if (imdbItem.dataset.cinetraktImdbDirectBound === 'true') return;
	imdbItem.dataset.cinetraktImdbDirectBound = 'true';
	imdbItem.addEventListener('click', (event) => {
		const directImdbId = imdbItem.dataset.cinetraktImdbId || '';
		if (!isCinetraktFeatureEnabled('traktRatingsToggle')
			|| !/^tt\d{7,}$/.test(directImdbId)) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		openWatchOnStremioImdbTitle(directImdbId);
	}, true);
}

function resetWatchOnStremioImdbDirectLinks() {
	document.querySelectorAll('.wos-imdb-direct-link').forEach((item) => {
		item.classList.remove('wos-imdb-direct-link');
		item.removeAttribute('data-cinetrakt-imdb-id');
		item.removeAttribute('title');
	});
}

function openWatchOnStremioImdbRatingsPopup(imdbId) {
	if (!/^tt\d{7,}$/.test(imdbId)) return;

	sendCinetraktRuntimeMessage({
		type: MESSAGE_TYPES.OPEN_IMDB_RATINGS_POPUP,
		imdbId,
		screenBounds: getCurrentScreenBoundsForPopup(),
	});
}

function createWatchOnStremioImdbRatingsPopupButton(imdbId) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'wos-imdb-ratings-popup-button';
	button.dataset.imdbId = imdbId;
	button.setAttribute('aria-label', 'Open IMDb episode ratings');
	button.setAttribute('title', 'Open IMDb episode ratings');
	button.innerHTML = `
		<svg viewBox="0 0 31 15" width="31" height="15" aria-hidden="true" focusable="false">
			<rect class="wos-grid-blue" x="0" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="4" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="8" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="12" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="16" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="20" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="24" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="28" y="0" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="0" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="4" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="8" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="12" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="16" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="20" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="24" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="28" y="4" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="0" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="4" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="8" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="12" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="16" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="20" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="24" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="28" y="8" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="0" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="4" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="8" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-yellow" x="12" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-pink" x="16" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-purple" x="20" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-blue" x="24" y="12" width="3" height="3" rx="0.75"></rect>
			<rect class="wos-grid-green" x="28" y="12" width="3" height="3" rx="0.75"></rect>
		</svg>
	`;
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		openWatchOnStremioImdbRatingsPopup(button.dataset.imdbId || '');
	});
	return button;
}

function updateWatchOnStremioTraktRatingsVisibility(summaryRatings) {
	if (!summaryRatings) return;

	const ratingItems = getWatchOnStremioTraktRatingItems(summaryRatings);
	const imdbItem = ratingItems.find(isWatchOnStremioImdbRatingItem);

	ratingItems.forEach((item) => {
		if (item === imdbItem) {
			item.classList.remove('wos-trakt-rating-hidden');
		} else {
			item.classList.add('wos-trakt-rating-hidden');
		}
	});
	summaryRatings.classList.toggle('wos-trakt-ratings-imdb-only', !!imdbItem);
}

function getWatchOnStremioRatingsPopupPlacementAnchor(summaryRatings) {
	const nativeInteractive = summaryRatings.closest(
		'a[href], button, [role="button"], [role="link"]',
	);
	return nativeInteractive || summaryRatings;
}

function unwrapWatchOnStremioRatingsPopupRow(row) {
	if (!row?.parentNode) {
		row?.remove();
		return;
	}

	const parent = row.parentNode;
	row.querySelector(':scope > .wos-imdb-ratings-popup-button')?.remove();
	while (row.firstChild) parent.insertBefore(row.firstChild, row);
	row.remove();
}

function resetWatchOnStremioRatingsPopupRows(exceptRow = null) {
	document.querySelectorAll('.wos-imdb-ratings-popup-row').forEach((row) => {
		if (row === exceptRow) return;

		if (row.dataset.cinetraktRatingsPopupRow === 'true') {
			unwrapWatchOnStremioRatingsPopupRow(row);
		} else {
			// Nettoie la classe posée par l'ancienne implémentation sur le gros
			// conteneur de résumé. C'est elle qui mettait titre / notes / Activities
			// sur la même ligne.
			row.classList.remove('wos-imdb-ratings-popup-row');
		}
	});
}

function ensureWatchOnStremioRatingsPopupRow(placementAnchor) {
	if (!placementAnchor?.parentNode) return null;

	const currentParent = placementAnchor.parentElement;
	if (
		currentParent?.classList.contains('wos-imdb-ratings-popup-row')
		&& currentParent.dataset.cinetraktRatingsPopupRow === 'true'
	) {
		resetWatchOnStremioRatingsPopupRows(currentParent);
		return currentParent;
	}

	resetWatchOnStremioRatingsPopupRows();

	const row = document.createElement('span');
	row.className = 'wos-imdb-ratings-popup-row';
	row.dataset.cinetraktRatingsPopupRow = 'true';
	placementAnchor.parentNode.insertBefore(row, placementAnchor);
	row.appendChild(placementAnchor);
	return row;
}

function getWatchOnStremioCanonicalRatingsPopupButton() {
	const buttons = [...document.querySelectorAll('.wos-imdb-ratings-popup-button')];
	const popupButton = buttons.shift() || null;
	buttons.forEach((button) => button.remove());
	return popupButton;
}

function setupWatchOnStremioTraktMoreRatingsToggle() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\//.test(window.location.pathname)) return;

	const summaryRatings = document.querySelector('.trakt-summary-ratings, [class*="trakt-summary-ratings"]');
	if (!summaryRatings) return;

	injectWatchOnStremioTraktMoreRatingsStyles();

	const ratingItems = getWatchOnStremioTraktRatingItems(summaryRatings);
	const imdbItem = ratingItems.find(isWatchOnStremioImdbRatingItem);
	if (!imdbItem) return;
	const ratingsToggleEnabled = isCinetraktFeatureEnabled('traktRatingsToggle');
	const ratingsPopupEnabled = isCinetraktFeatureEnabled('imdbEpisodeRatingsPopup');
	const directImdbId = getWatchOnStremioImdbRatingsId(summaryRatings);

	summaryRatings.querySelector(':scope > .wos-trakt-ratings-toggle')?.remove();
	if (ratingsToggleEnabled && directImdbId) {
		bindWatchOnStremioImdbDirectLink(imdbItem, directImdbId);
	} else if (!ratingsToggleEnabled) {
		resetWatchOnStremioImdbDirectLinks();
	}

	if (ratingsToggleEnabled && !directImdbId
		&& summaryRatings.dataset.cinetraktImdbDirectRequestedRoute !== window.location.pathname) {
		const route = window.location.pathname;
		summaryRatings.dataset.cinetraktImdbDirectRequestedRoute = route;
		getImdbIdFromTraktMediaUrl(window.location.href).then((resolvedImdbId) => {
			if (!resolvedImdbId || window.location.pathname !== route) return;
			bindWatchOnStremioImdbDirectLink(imdbItem, resolvedImdbId);
		});
	}

	const isShowPage = /^\/shows\/[^/]+\/?$/.test(window.location.pathname);
	let popupButton = getWatchOnStremioCanonicalRatingsPopupButton();
	const imdbId = isShowPage && ratingsPopupEnabled ? getWatchOnStremioImdbRatingsId(summaryRatings) : '';

	if (popupButton && (!isShowPage || !ratingsPopupEnabled)) {
		popupButton.remove();
		popupButton = null;
	}
	if (imdbId && !popupButton) {
		popupButton = createWatchOnStremioImdbRatingsPopupButton(imdbId);
	}
	if (imdbId && popupButton && popupButton.dataset.imdbId !== imdbId) {
		popupButton.dataset.imdbId = imdbId;
	}

	if (popupButton) {
		const placementAnchor = getWatchOnStremioRatingsPopupPlacementAnchor(summaryRatings);
		const popupRow = ensureWatchOnStremioRatingsPopupRow(placementAnchor);
		if (popupRow && placementAnchor.nextElementSibling !== popupButton) {
			// Le bouton natif IMDb + flèche reste intact. La Heatmap est son
			// frère immédiat, donc visuellement juste à droite de la flèche.
			placementAnchor.insertAdjacentElement('afterend', popupButton);
		}
	} else {
		resetWatchOnStremioRatingsPopupRows();
	}

	if (ratingsPopupEnabled && isShowPage && !imdbId
		&& summaryRatings.dataset.cinetraktImdbIdRequestedRoute !== window.location.pathname) {
		const route = window.location.pathname;
		summaryRatings.dataset.cinetraktImdbIdRequestedRoute = route;
		getImdbIdFromTraktShowUrl(window.location.href).then((resolvedImdbId) => {
			if (resolvedImdbId && window.location.pathname === route) {
				globalThis.CineTraktTraktRuntime?.schedule('imdb-id-resolved', 0);
			}
		});
	}

	if (ratingsToggleEnabled) {
		updateWatchOnStremioTraktRatingsVisibility(summaryRatings);
	} else {
		ratingItems.forEach((item) => item.classList.remove('wos-trakt-rating-hidden'));
		summaryRatings.classList.remove('wos-trakt-ratings-imdb-only');
	}
}

function resetTraktRatingsControls() {
	document.querySelectorAll('.wos-trakt-ratings-toggle, .wos-imdb-ratings-popup-button')
		.forEach((element) => element.remove());
	resetWatchOnStremioImdbDirectLinks();
	document.querySelectorAll('.wos-trakt-rating-hidden')
		.forEach((element) => element.classList.remove('wos-trakt-rating-hidden'));
	document.querySelectorAll('.wos-trakt-ratings-imdb-only')
		.forEach((element) => element.classList.remove('wos-trakt-ratings-imdb-only'));
	resetWatchOnStremioRatingsPopupRows();
}
	const api = Object.freeze({
		setColorsEnabled(enabled) {
			const nextEnabled = Boolean(enabled);
			if (nextEnabled) {
				colorizeTraktImdbRatings();
				colorizeTraktPersonalRating();
			} else if (cinetraktRatingColorsEnabled !== false) {
				resetTraktRatingColors();
			}
			cinetraktRatingColorsEnabled = nextEnabled;
		},
		setControlsEnabled({ toggleEnabled, popupEnabled }) {
			if (toggleEnabled || popupEnabled) setupWatchOnStremioTraktMoreRatingsToggle();
			else resetTraktRatingsControls();
		},
	});

	globalThis.CineTraktTraktRatings = api;
})();
