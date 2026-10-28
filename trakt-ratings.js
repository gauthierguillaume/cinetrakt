(() => {
	'use strict';
	const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;

	const {
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
	let cinetraktRatingObserver = null;
	const CINETRAKT_USER_RATING_SELECTOR = '.trakt-user-rating, .social-activity-summary-rating, .trakt-tag:has(.trakt-star-fill)';

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
		.cinetrakt-personal-rating-label { margin-inline-end: 8px; }
		.cinetrakt-rating-native-value { display: none !important; }
		.cinetrakt-user-rating-colored,
		.cinetrakt-user-rating-colored .trakt-rating-icon,
		.cinetrakt-user-rating-colored svg {
			color: var(--cinetrakt-rating-color) !important;
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
	const currentUnits = Array.from(starsBox.querySelectorAll('[data-rating-group-item]'));
	if (currentUnits.length) return currentUnits.slice(0, 5);

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
	const generatedLabel = rateNowBox.querySelector('.cinetrakt-personal-rating-label');
	if (generatedLabel) return generatedLabel;
	if (!rateNowBox) return null;

	// Structure actuelle Trakt :
	// <div class="trakt-rate-now ...">
	//   <span class="bold">Rate</span>
	//   <div class="trakt-rate-actions">...</div>
	// </div>
	// On cible d'abord ce span direct pour éviter de modifier un élément interne aux étoiles.
	const directLabel = rateNowBox.querySelector(':scope > span.bold, :scope > span[class*="bold"]');
	if (directLabel) return directLabel;

	const legacyLabel = Array.from(rateNowBox.children).find((element) => {
		const text = (element.textContent || '').trim();
		return element.tagName.toLowerCase() === 'span' && (text === 'Rate' || /^\d+(?:\.\d+)?$/.test(text));
	});
	if (legacyLabel) return legacyLabel;
	const starsBox = rateNowBox.querySelector('.trakt-rating-stars, .trakt-ratings-stars');
	if (!starsBox) return null;
	const label = document.createElement('span');
	label.className = 'cinetrakt-personal-rating-label';
	starsBox.before(label);
	return label;
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

		const slider = starsBox.querySelector('[data-rating-group-root][aria-valuemax="5"]');
		const sliderValue = slider ? Number(slider.getAttribute('aria-valuenow')) : NaN;
		if (Number.isFinite(sliderValue) && sliderValue >= 0 && sliderValue <= 5) {
			rating10 = sliderValue * 2;
			effectiveRatios = getWatchOnStremioStarRatiosFromRating(rating10, starUnits.length);
			if (rating10 === 0) {
				setCinetraktTextIfChanged(label, '');
				starUnits.forEach((starUnit) => setWatchOnStremioStarColor(starUnit, '', false));
				return;
			}
		} else if (starTotal <= 0) {
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

// These native badges are shared by social drawers, home activity, reviews,
// profile ratings and card footers. Keep their original value intact so that
// rerenders, disabling the feature and repeated updates never double it twice.
function colorizeTraktUserRatings() {
	injectWatchOnStremioTraktRatingStyles();
	document.querySelectorAll(CINETRAKT_USER_RATING_SELECTOR).forEach((badge) => {
		const nativeValue = [...badge.querySelectorAll(':scope > span, :scope > p')].find((value) =>
			!value.classList.contains('cinetrakt-rating-value') && /^\d+(?:[.,]\d+)?$/.test(value.textContent.trim()));
		if (!nativeValue) {
			badge.querySelector(':scope > .cinetrakt-rating-value')?.remove();
			badge.querySelectorAll('.cinetrakt-rating-native-value').forEach((value) => value.classList.remove('cinetrakt-rating-native-value'));
			badge.classList.remove('cinetrakt-user-rating-colored');
			badge.style.removeProperty('--cinetrakt-rating-color');
			return;
		}
		const text = nativeValue.textContent.trim().replace(',', '.');
		const rating5 = /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : NaN;
		if (!Number.isFinite(rating5) || rating5 <= 0 || rating5 > 5) return;
		const rating10 = rating5 * 2;
		let label = badge.querySelector(':scope > .cinetrakt-rating-value');
		if (!label) {
			label = document.createElement('span');
			label.className = 'cinetrakt-rating-value bold no-wrap';
			nativeValue.after(label);
		}
		toggleCinetraktClass(nativeValue, 'cinetrakt-rating-native-value', true);
		toggleCinetraktClass(badge, 'cinetrakt-user-rating-colored', true);
		setCinetraktTextIfChanged(label, formatWatchOnStremioRatingValue(rating10));
		label.setAttribute('aria-label', `${formatWatchOnStremioRatingValue(rating10)} out of 10`);
		setCinetraktImportantStyleIfChanged(badge, '--cinetrakt-rating-color', getWatchOnStremioRatingColor(rating10).bg);
	});
}

function observeTraktRatingValues() {
	if (cinetraktRatingObserver || typeof MutationObserver !== 'function') return;
	cinetraktRatingObserver = new MutationObserver((mutations) => {
		if (mutations.some((mutation) => mutation.type === 'attributes'
			? mutation.target.matches('[data-rating-group-root]')
			: mutation.target.parentElement?.closest(CINETRAKT_USER_RATING_SELECTOR)
				&& !mutation.target.parentElement?.closest('.cinetrakt-rating-value'))) {
			globalThis.CineTraktTraktRuntime?.schedule('rating-value-change', 0);
		}
	});
	cinetraktRatingObserver.observe(document.body, {
		subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-valuenow'],
	});
}

function resetTraktRatingColors() {
	cinetraktRatingObserver?.disconnect();
	cinetraktRatingObserver = null;
	document.querySelectorAll('.cinetrakt-personal-rating-label, .cinetrakt-rating-value').forEach((label) => label.remove());
	document.querySelectorAll('.cinetrakt-rating-native-value').forEach((value) => value.classList.remove('cinetrakt-rating-native-value'));
	document.querySelectorAll('.cinetrakt-user-rating-colored').forEach((badge) => {
		badge.classList.remove('cinetrakt-user-rating-colored');
		badge.style.removeProperty('--cinetrakt-rating-color');
	});
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



/* La fiche conserve IMDb et ajoute la note Letterboxd fournie par Trakt.
   La flèche native conserve le panneau Ratings. */
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

		.cinetrakt-rating-cards { display: inline-flex; flex-wrap: wrap; max-width: 100%; gap: var(--gap-s, 12px); }
		.cinetrakt-rating-card {
			box-sizing: border-box;
			display: flex;
			flex: 0 0 auto;
			flex-direction: column;
			justify-content: center;
			align-items: center;
			gap: var(--gap-s, 12px);
			width: 112px;
			min-height: 110px;
			padding: var(--ni-16, 16px) var(--ni-12, 12px);
			background: var(--color-card-background, #100e13);
			border-radius: var(--border-radius-m, 12px);
			color: var(--color-foreground, #faf9fc);
			text-align: center;
			text-decoration: none;
		}
		.cinetrakt-rating-card .cinetrakt-rating-logo {
			display: block; height: var(--ni-28, 28px); width: auto; max-width: 100%;
			transition: transform 160ms ease;
		}
		.cinetrakt-rating-card:hover .cinetrakt-rating-logo { transform: scale(1.1); }
		.cinetrakt-rating-card:hover { text-decoration: none; }
		.cinetrakt-rating-card:focus-visible {
			outline: 2px solid var(--cinetrakt-accent-focus);
			outline-offset: 3px;
		}
		.cinetrakt-rating-info { display: flex; flex-direction: column; align-items: center; gap: var(--gap-xs, 6px); }
		.cinetrakt-rating-score { font-size: var(--ni-20, 20px); font-weight: 700; line-height: .9; font-variant-numeric: tabular-nums; }
		.cinetrakt-rating-votes {
			display: inline-flex; align-items: center; gap: var(--gap-xxs, 4px);
			min-height: var(--font-size-text, 14px); color: var(--color-text-secondary, #a09ba6);
			font-size: var(--font-size-tag, 10px); font-weight: 700; line-height: .9;
		}
		.cinetrakt-rating-votes img { display: block; width: 10px; height: 10px; }
		.cinetrakt-rating-votes[hidden] { display: none; }

		.wos-imdb-ratings-popup-row {
			display: inline-flex !important;
			flex-flow: row nowrap !important;
			align-items: center !important;
			width: max-content !important;
			max-width: 100% !important;
			vertical-align: middle !important;
		}
		.wos-imdb-ratings-popup-row:has(.cinetrakt-rating-cards) { flex-wrap: wrap !important; gap: 8px; }

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
	const openDirectLink = (event) => {
		if (event.type === 'auxclick' && event.button !== 1) return;
		const directImdbId = imdbItem.dataset.cinetraktImdbId || '';
		if (!isCinetraktFeatureEnabled('traktRatingsToggle')
			|| !/^tt\d{7,}$/.test(directImdbId)) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		openWatchOnStremioImdbTitle(directImdbId);
	};
	imdbItem.addEventListener('click', openDirectLink, true);
	// Middle click dispatches auxclick, not click. Cancel the enclosing native
	// ratings link so it cannot open a second copy of the current Trakt page.
	imdbItem.addEventListener('auxclick', openDirectLink, true);
}

function resetWatchOnStremioImdbDirectLinks() {
	document.querySelectorAll('.wos-imdb-direct-link').forEach((item) => {
		item.classList.remove('wos-imdb-direct-link');
		item.removeAttribute('data-cinetrakt-imdb-id');
		item.removeAttribute('title');
	});
}

function createWatchOnStremioImdbRatingsPopupButton(imdbId) {
	return globalThis.CineTraktSeasonChart.createButton(imdbId,
		id => globalThis.CineTraktImdbPanel.open(id));
}

function updateWatchOnStremioTraktRatingsVisibility(summaryRatings, hasCards = false) {
	if (!summaryRatings) return;

	const ratingItems = getWatchOnStremioTraktRatingItems(summaryRatings);
	const imdbItem = ratingItems.find(isWatchOnStremioImdbRatingItem);

	ratingItems.forEach((item) => {
		if (item === imdbItem && !hasCards) {
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

const cinetraktExternalRatings = new Map();

function getCinetraktExternalRatings(seasonsOnly = false) {
	const route = window.location.pathname;
	if (!/^\/(movies|shows)\/[a-z0-9-]+\/?$/i.test(route) || (seasonsOnly && !route.startsWith('/shows/'))) return null;
	const cacheKey = seasonsOnly ? `seasons:${route}` : route;
	const feature = seasonsOnly ? 'imdbEpisodeRatingsPopup' : 'traktRatingsToggle';
	const cached = cinetraktExternalRatings.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) return cached.value;

	// Same source as the native breakdown, without opening or moving the panel.
	if (cached?.retryTimer != null) clearTimeout(cached.retryTimer);
	const entry = { value: null, expiresAt: Infinity, attempt: cached && !cached.value && cached.attempt < 3 ? cached.attempt + 1 : 1, retryTimer: null };
	cinetraktExternalRatings.set(cacheKey, entry);
	if (cinetraktExternalRatings.size > 50) cinetraktExternalRatings.delete(cinetraktExternalRatings.keys().next().value);
	const complete = (response, error) => {
		entry.value = response?.ok ? (seasonsOnly ? response.seasons : response.ratings) || null : null;
		entry.expiresAt = Date.now() + (entry.value ? (seasonsOnly ? 3 : 6) * 60 * 60 * 1000 : 60 * 1000);
		// A rejection during navigation or a temporary network/worker error must
		// not leave the old rating row stuck until the user reloads the page.
		if ((error || !response?.ok || response.retryable) && entry.attempt < 3
			&& window.location.pathname === route && isCinetraktFeatureEnabled(feature)) {
			entry.retryTimer = setTimeout(() => {
				entry.retryTimer = null;
				if (cinetraktExternalRatings.get(cacheKey) !== entry) return;
				entry.expiresAt = 0;
				if (window.location.pathname !== route || !isCinetraktFeatureEnabled(feature)) return;
				globalThis.CineTraktTraktRuntime?.schedule('external-ratings-retry', 0);
			}, entry.attempt === 1 ? 1500 : 4000);
		}
		if (window.location.pathname === route && isCinetraktFeatureEnabled(feature)) {
			globalThis.CineTraktTraktRuntime?.schedule('external-ratings-resolved', 0);
		}
	};
	const requested = sendCinetraktRuntimeMessage({ type: seasonsOnly ? MESSAGE_TYPES.GET_SHOW_SEASON_RATINGS : MESSAGE_TYPES.GET_TRAKT_RATINGS, pathname: route }, complete);
	if (!requested) complete(null, true);
	return null;
}

function updateCinetraktRatingCards() {
	const existing = [...document.querySelectorAll('.cinetrakt-rating-cards')];
	let group = existing.shift() || null;
	existing.forEach((duplicate) => duplicate.remove());
	const ratings = isCinetraktFeatureEnabled('traktRatingsToggle') ? getCinetraktExternalRatings() : null;
	if (!ratings) { group?.remove(); return null; }
	if (!group) { group = document.createElement('span'); group.className = 'cinetrakt-rating-cards'; }
	let position = 0;
	for (const [source, label, multiplier, urlPattern] of [
		['imdb', 'IMDb', 1, /^https:\/\/(?:www\.)?imdb\.com\/title\/tt\d{7,}\/?$/i],
		['mal', 'MyAnimeList', 1, /^https:\/\/(?:www\.)?myanimelist\.net\/anime\/[1-9]\d*(?:\/[a-z0-9_-]+)?\/?$/i],
		['letterboxd', 'Letterboxd', 2, /^https:\/\/letterboxd\.com\/film\/[a-z0-9-]+\/?$/i],
	]) {
		const data = ratings[source];
		let card = group.querySelector(`[data-source="${source}"]`);
		if (!data || !Number.isFinite(data.rating) || data.rating < 0 || data.rating * multiplier > 10 || !urlPattern.test(data.url)) {
			card?.remove(); continue;
		}
		if (!card) {
			card = document.createElement('a');
			card.className = 'cinetrakt-rating-card';
			card.dataset.source = source;
			card.target = '_blank';
			card.rel = 'noopener noreferrer';
			card.title = `Open on ${label}`;
			card.innerHTML = '<img class="cinetrakt-rating-logo" alt=""><span class="cinetrakt-rating-info"><span class="cinetrakt-rating-score"></span><span class="cinetrakt-rating-votes"><img alt=""><span></span></span></span>';
			card.querySelector('.cinetrakt-rating-logo').src = chrome.runtime.getURL(`assets/ratings/${source}.svg`);
			card.querySelector('.cinetrakt-rating-votes img').src = chrome.runtime.getURL('assets/ratings/voters.svg');
			group.appendChild(card);
		}
		if (group.children[position] !== card) group.insertBefore(card, group.children[position] || null);
		position++;
		if (card.href !== data.url) card.href = data.url;
		// Trakt displays Letterboxd to one decimal: double that displayed score,
		// so its native 3.6 consistently becomes 7.2 rather than using hidden precision.
		const score = (multiplier === 2 ? Number(data.rating.toFixed(1)) : data.rating) * multiplier;
		const text = score.toFixed(1).replace(/\.0$/, '');
		const scoreElement = card.querySelector('.cinetrakt-rating-score');
		setCinetraktTextIfChanged(scoreElement, text);
		const votes = card.querySelector('.cinetrakt-rating-votes');
		const hasVotes = Number.isSafeInteger(data.votes) && data.votes >= 0;
		if (votes.hidden === hasVotes) votes.hidden = !hasVotes;
		if (hasVotes) {
			setCinetraktTextIfChanged(votes.querySelector('span'), new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(data.votes));
			const fullCount = `${new Intl.NumberFormat('en').format(data.votes)} votes`;
			if (votes.title !== fullCount) votes.title = fullCount;
		}
		const ariaLabel = `${label}: ${text}${hasVotes ? `, ${new Intl.NumberFormat('en').format(data.votes)} votes` : ''}`;
		if (card.getAttribute('aria-label') !== ariaLabel) card.setAttribute('aria-label', ariaLabel);
		if (isCinetraktFeatureEnabled('traktRatingColors')) setCinetraktImportantStyleIfChanged(scoreElement, 'color', getWatchOnStremioRatingColor(score).bg);
		else removeCinetraktStyleIfPresent(scoreElement, 'color');
	}
	if (!group.children.length) { group.remove(); return null; }
	return group;
}

function setupWatchOnStremioTraktMoreRatingsToggle() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\//.test(window.location.pathname)) return;

	const summaryRatings = document.querySelector('.trakt-summary-ratings, [class*="trakt-summary-ratings"]');
	if (!summaryRatings) return;

	injectWatchOnStremioTraktMoreRatingsStyles();

	const ratingItems = getWatchOnStremioTraktRatingItems(summaryRatings);
	const imdbItem = ratingItems.find(isWatchOnStremioImdbRatingItem);
	const ratingsToggleEnabled = isCinetraktFeatureEnabled('traktRatingsToggle');
	const ratingsPopupEnabled = isCinetraktFeatureEnabled('imdbEpisodeRatingsPopup');
	const directImdbId = getWatchOnStremioImdbRatingsId(summaryRatings);

	summaryRatings.querySelector(':scope > .wos-trakt-ratings-toggle')?.remove();
	if (ratingsToggleEnabled && imdbItem && directImdbId) {
		bindWatchOnStremioImdbDirectLink(imdbItem, directImdbId);
	} else if (!ratingsToggleEnabled) {
		resetWatchOnStremioImdbDirectLinks();
	}

	if (ratingsToggleEnabled && !directImdbId
		&& summaryRatings.dataset.cinetraktImdbDirectRequestedRoute !== window.location.pathname) {
		const route = window.location.pathname;
		summaryRatings.dataset.cinetraktImdbDirectRequestedRoute = route;
		getImdbIdFromTraktMediaUrl(window.location.href).then((resolvedImdbId) => {
			if (!resolvedImdbId || window.location.pathname !== route || !isCinetraktFeatureEnabled('traktRatingsToggle')) return;
			bindWatchOnStremioImdbDirectLink(imdbItem, resolvedImdbId);
		});
	}

	const isShowPage = /^\/shows\/[^/]+\/?$/.test(window.location.pathname);
	const seasonRatings = isShowPage && ratingsPopupEnabled ? getCinetraktExternalRatings(true) : null;
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
	if (popupButton) globalThis.CineTraktSeasonChart.updateButton(popupButton, seasonRatings);

	const ratingCards = updateCinetraktRatingCards();
	const ratingsRequest = cinetraktExternalRatings.get(window.location.pathname);
	if (!ratingsToggleEnabled || ratingCards || (ratingsRequest && Number.isFinite(ratingsRequest.expiresAt))) {
		summaryRatings.dataset.cinetraktRatingsReady = 'true';
	}
	if (popupButton || ratingCards) {
		const placementAnchor = getWatchOnStremioRatingsPopupPlacementAnchor(summaryRatings);
		const popupRow = ensureWatchOnStremioRatingsPopupRow(placementAnchor);
		if (popupRow && ratingCards && ratingCards.nextElementSibling !== placementAnchor) {
			popupRow.insertBefore(ratingCards, placementAnchor);
		}
		if (popupRow && popupButton) {
			// Score tiles, season chart, then the unchanged native drawer arrow.
			if (ratingCards && popupButton.nextElementSibling !== placementAnchor) popupRow.insertBefore(popupButton, placementAnchor);
			else if (!ratingCards && placementAnchor.nextElementSibling !== popupButton) placementAnchor.insertAdjacentElement('afterend', popupButton);
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
		updateWatchOnStremioTraktRatingsVisibility(summaryRatings, Boolean(ratingCards));
	} else {
		ratingItems.forEach((item) => item.classList.remove('wos-trakt-rating-hidden'));
		summaryRatings.classList.remove('wos-trakt-ratings-imdb-only');
	}
}

function resetTraktRatingsControls() {
	document.querySelectorAll('.wos-trakt-ratings-toggle, .wos-imdb-ratings-popup-button, .cinetrakt-rating-cards')
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
				colorizeTraktUserRatings();
				observeTraktRatingValues();
			} else if (cinetraktRatingColorsEnabled !== false) {
				resetTraktRatingColors();
			}
			cinetraktRatingColorsEnabled = nextEnabled;
		},
		setControlsEnabled({ toggleEnabled, popupEnabled }) {
			// Start in parallel with Trakt's summary, rather than waiting for the
			// native inline row to mount before asking the worker for its tiles.
			if (toggleEnabled) getCinetraktExternalRatings();
			if (popupEnabled) getCinetraktExternalRatings(true);
			if (toggleEnabled || popupEnabled) setupWatchOnStremioTraktMoreRatingsToggle();
			else resetTraktRatingsControls();
		},
	});

	globalThis.CineTraktTraktRatings = api;
})();
