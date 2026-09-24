(() => {
	'use strict';

	const {
		buildStremioDetailUrl,
		buildStremioEpisodeUrl,
		getEpisodeDataFromTraktUrl,
		getSeasonEpisodeFromText,
		getTraktMediaType,
	} = globalThis.CineTraktStremioUrls;
	const { openFromMouseEvent: openStremioFromMouseEvent } = globalThis.CineTraktStremioOpen;
	const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;
	let currentDetailPosterStremioUrl = '';
	let pendingDetailPosterMedia = null;
	let pendingDetailPosterResolution = null;

	function isFeatureEnabled() {
		return globalThis.CineTraktSettings?.isEnabled('traktStremioLinks') !== false;
	}
function getImdbIdFromPage() {
	const imdbLink = [...document.querySelectorAll('a[href*="imdb.com/title/tt"]')].find((link) => {
		return link.href.match(/tt\d+/);
	});

	if (imdbLink) {
		const match = imdbLink.href.match(/tt\d+/);
		if (match) return match[0];
	}

	const htmlMatch = document.documentElement.innerHTML.match(/tt\d{7,}/);
	if (htmlMatch) return htmlMatch[0];

	return "";
}

function isCinetraktNativePosterStatusTarget(element, target) {
	for (let current = target; current && current !== element; current = current.parentElement) {
		const label = String(current.textContent || '').replace(/\s+/g, ' ').trim();
		if (/^(?:watched|watchlisted|wishlisted|started|collected|completed|unwatched)$/i.test(label)) {
			return true;
		}
	}
	return false;
}

function getCinetraktPosterInteractionImage(element) {
	if (element.matches?.('img')) return element;
	return element.querySelector?.('img') || null;
}

function isCinetraktPrimaryPosterLink(element, interactive) {
	if (!interactive?.matches?.('a[href]')) return false;
	const posterImage = getCinetraktPosterInteractionImage(element);
	return Boolean(posterImage && posterImage.closest('a[href]') === interactive);
}

function isCinetraktPointerOutsidePosterImage(element, event) {
	if (!(event instanceof MouseEvent)) return false;

	const image = getCinetraktPosterInteractionImage(element);
	if (!image) return false;

	const rect = image.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;

	return event.clientX < rect.left
		|| event.clientX > rect.right
		|| event.clientY < rect.top
		|| event.clientY > rect.bottom;
}

function shouldPreserveNativePosterInteraction(element, event) {
	const target = event.target instanceof Element ? event.target : null;
	if (!target || !element.contains(target)) return false;

	const nativeInteractive = target.closest(
		'a[href], button, input, select, textarea, [role="button"], [role="link"]',
	);
	if (
		nativeInteractive
		&& nativeInteractive !== element
		&& element.contains(nativeInteractive)
		&& !isCinetraktPrimaryPosterLink(element, nativeInteractive)
	) {
		return true;
	}

	if (isCinetraktNativePosterStatusTarget(element, target)) return true;
	return isCinetraktPointerOutsidePosterImage(element, event);
}

function bindCinetraktStremioOpenHandlers(element, getStremioUrl) {
	if (!element || typeof getStremioUrl !== "function") return;
	if (element.dataset.cinetraktStremioBound === "1") return;

	element.dataset.cinetraktStremioBound = "1";

	element.addEventListener(
		"click",
		function (event) {
			if (element.dataset.cinetraktStremioActive !== 'true') return;
			if (!isFeatureEnabled()) return;
			if (shouldPreserveNativePosterInteraction(element, event)) return;
			if (event.cinetraktStremioHandled) return;
			event.cinetraktStremioHandled = true;
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);

	element.addEventListener(
		"contextmenu",
		function (event) {
			if (element.dataset.cinetraktStremioActive !== 'true') return;
			if (!isFeatureEnabled()) return;
			if (shouldPreserveNativePosterInteraction(element, event)) return;
			if (event.cinetraktStremioHandled) return;
			event.cinetraktStremioHandled = true;
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);

	element.addEventListener(
		"keydown",
		function (event) {
			if (element.dataset.cinetraktStremioActive !== 'true') return;
			if (!isFeatureEnabled()) return;
			if (event.key !== 'Enter' && event.key !== ' ') return;
			if (shouldPreserveNativePosterInteraction(element, event)) return;
			if (event.cinetraktStremioHandled) return;
			event.cinetraktStremioHandled = true;
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);
}

function getCinetraktDetailPosterTargets() {
	const posterSurface = document.querySelector('.trakt-summary-poster');
	const stickyPosterStage = document.querySelector('.cinetrakt-sticky-poster-stage');
	const posterImage = posterSurface?.querySelector('img')
		|| stickyPosterStage?.querySelector('.trakt-summary-poster img, img');
	if (posterImage) return [posterImage];

	const nativePosterTarget = posterSurface?.querySelector(':scope > a, a:has(> img)')
		|| posterSurface?.querySelector('a')
		|| posterSurface
		|| stickyPosterStage;
	return nativePosterTarget ? [nativePosterTarget] : [];
}

function resetCinetraktDetailPosterTargets() {
	document.querySelectorAll('[data-watch-on-stremio-click-fixed="true"]').forEach((target) => {
		target.dataset.cinetraktStremioActive = 'false';
		target.removeAttribute('data-cinetrakt-stremio-target');
		target.removeAttribute('data-stremio-url');
		if (target.classList.contains('cinetrakt-sticky-poster-stage')) {
			target.removeAttribute('role');
			target.removeAttribute('aria-label');
			target.removeAttribute('tabindex');
		}
	});
}

function bindCinetraktDetailPosterTargets(stremioUrl) {
	if (!stremioUrl) return;
	currentDetailPosterStremioUrl = stremioUrl;
	const targets = getCinetraktDetailPosterTargets();

	resetCinetraktDetailPosterTargets();

	targets.forEach((target) => {
		target.dataset.watchOnStremioClickFixed = 'true';
		target.dataset.cinetraktStremioActive = 'true';
		target.dataset.stremioUrl = stremioUrl;
		target.style.cursor = 'pointer';
		if (target.classList.contains('cinetrakt-sticky-poster-stage')) {
			target.dataset.cinetraktStremioTarget = 'true';
			target.setAttribute('role', 'link');
			target.setAttribute('aria-label', 'Open this title in Stremio');
			target.tabIndex = 0;
		}
		bindCinetraktStremioOpenHandlers(
			target,
			() => currentDetailPosterStremioUrl || target.dataset.stremioUrl,
		);
	});
}

function refreshCinetraktDetailPosterTarget() {
	if (currentDetailPosterStremioUrl) {
		bindCinetraktDetailPosterTargets(currentDetailPosterStremioUrl);
	} else if (pendingDetailPosterMedia) {
		bindCinetraktPendingDetailPosterTargets();
	}
}

	function requestTraktImdbId(pathname) {
		return new Promise((resolve) => {
			try {
				const runtime = globalThis.chrome?.runtime;
			if (!runtime?.id || typeof runtime.sendMessage !== 'function') {
				resolve('');
				return;
			}

			runtime.sendMessage({
				type: MESSAGE_TYPES.RESOLVE_TRAKT_IMDB_ID,
				pathname,
			}, (response) => {
				try {
					if (runtime.lastError) {
						resolve('');
						return;
					}
					const imdbId = String(response?.imdbId || '').toLowerCase();
					resolve(/^tt\d{7,}$/.test(imdbId) ? imdbId : '');
				} catch {
					resolve('');
				}
			});
		} catch {
			resolve('');
		}
	});
}

function getDetailMediaFromTraktUrl(url) {
	try {
		const parsed = new URL(url, window.location.origin);
		const match = parsed.pathname.match(/^\/(movies|shows)\/([^/?#]+)\/?$/i);
		if (!match) return null;
		return {
			kind: match[1].toLowerCase(),
			slug: match[2].toLowerCase(),
			pathname: `/${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
		};
	} catch {
		return null;
	}
}

function getTraktMediaIdFromDetailPoster(expectedKind) {
	const parseImageId = globalThis.CineTraktTraktImdbResolver?.getTraktMediaIdFromImageUrl;
	if (typeof parseImageId !== 'function') return '';

	for (const image of document.querySelectorAll(
		'.trakt-summary-poster img, .trakt-summary-poster-container img, .cinetrakt-sticky-poster-stage img',
	)) {
		for (const candidate of [image.currentSrc, image.src, image.getAttribute('src')]) {
			const traktId = parseImageId(candidate, expectedKind);
			if (traktId) return traktId;
		}
	}

	return '';
}

async function resolvePendingDetailPosterStremioUrl() {
	const pending = pendingDetailPosterMedia;
	if (!pending || window.location.pathname !== pending.media.pathname) return '';
	if (pendingDetailPosterResolution) return pendingDetailPosterResolution;

	pendingDetailPosterResolution = (async () => {
		let imdbId = getImdbIdFromPage();
		if (!imdbId) imdbId = await requestTraktImdbId(pending.media.pathname);

		if (!imdbId) {
			const traktId = getTraktMediaIdFromDetailPoster(pending.media.kind);
			if (traktId) {
				imdbId = await requestTraktImdbId(`/${pending.media.kind}/${traktId}`);
			}
		}

		if (!imdbId || window.location.pathname !== pending.media.pathname) return '';
		const cacheKey = pending.media.kind === 'shows'
			? pending.media.slug
			: `movie:${pending.media.slug}`;
		globalThis.CineTraktImdbCache.set(cacheKey, imdbId);
		return buildStremioDetailUrl(pending.type, imdbId);
	})().finally(() => {
		pendingDetailPosterResolution = null;
	});

	return pendingDetailPosterResolution;
}

function bindCinetraktPendingDetailPosterTargets() {
	if (!pendingDetailPosterMedia || currentDetailPosterStremioUrl) return;

	getCinetraktDetailPosterTargets().forEach((target) => {
		if (target.dataset.cinetraktPendingStremioBound === '1') return;
		target.dataset.cinetraktPendingStremioBound = '1';
		target.style.cursor = 'pointer';

		target.addEventListener('click', async (event) => {
			if (currentDetailPosterStremioUrl
				|| target.dataset.cinetraktStremioActive === 'true'
				|| !isFeatureEnabled()
				|| shouldPreserveNativePosterInteraction(target, event)
				|| event.cinetraktStremioHandled) return;

			event.cinetraktStremioHandled = true;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			const stremioUrl = await resolvePendingDetailPosterStremioUrl();
			if (!stremioUrl) return;
			bindCinetraktDetailPosterTargets(stremioUrl);
			openStremioFromMouseEvent(stremioUrl, null);
		}, true);
	});
}

function getImdbIdFromTraktMediaUrl(mediaUrl) {
	const media = getDetailMediaFromTraktUrl(mediaUrl);
	if (!media) return Promise.resolve('');

	const immediateImdbId = media.pathname === window.location.pathname
		? getImdbIdFromPage()
		: '';
	if (immediateImdbId) return Promise.resolve(immediateImdbId);

	const cacheKey = media.kind === 'shows' ? media.slug : `movie:${media.slug}`;
	return globalThis.CineTraktImdbCache.resolve(
		cacheKey,
		() => requestTraktImdbId(media.pathname),
	);
}

function applyDetailStremioLinks(imdbId, type) {
	if (!imdbId) return;
	updatePosterLinkToStremio(buildStremioDetailUrl(type, imdbId));
	if (type === 'series') insertEpisodeStremioButtonsTraktV3(imdbId);
}

/* La jaquette conserve le visuel CineTrakt sans l'overlay promotionnel Trakt.
   Son clic ouvre directement le média dans Stremio. */
function insertStremioButtonTraktV3() {
	if (window.location.hostname !== "app.trakt.tv") return;

	const episodePageData = getEpisodeDataFromTraktUrl(window.location.href);

	// Page détail d'un épisode : il faut absolument utiliser l'IMDb ID de la SÉRIE,
	// pas un éventuel IMDb ID propre à l'épisode. Sinon Stremio ouvre une erreur.
	if (episodePageData) {
		getImdbIdFromTraktShowUrl(episodePageData.showUrl).then((seriesImdbId) => {
			if (!seriesImdbId) return;

			const stremioEpisodeUrl = buildStremioEpisodeUrl(seriesImdbId, episodePageData.season, episodePageData.episode);

			updateEpisodePosterLinkToStremio(stremioEpisodeUrl);
			insertEpisodeStremioButtonsTraktV3(seriesImdbId);
		});

		return;
	}

	const detailPathname = window.location.pathname;
	const type = getTraktMediaType(window.location.href);
	const detailMedia = getDetailMediaFromTraktUrl(window.location.href);
	if (detailMedia && pendingDetailPosterMedia?.media.pathname !== detailPathname) {
		currentDetailPosterStremioUrl = '';
		pendingDetailPosterResolution = null;
		resetCinetraktDetailPosterTargets();
	}
	pendingDetailPosterMedia = detailMedia ? { media: detailMedia, type } : null;
	bindCinetraktPendingDetailPosterTargets();
	if (type === 'series') markSeasonEpisodeTextTargetsPreparing();
	const immediateImdbId = getImdbIdFromPage();
	if (immediateImdbId) {
		applyDetailStremioLinks(immediateImdbId, type);
	} else {
		getImdbIdFromTraktMediaUrl(window.location.href).then((imdbId) => {
			if (window.location.pathname !== detailPathname) return;
			applyDetailStremioLinks(imdbId, type);
		});
	}

	insertContinueWatchingStremioButtonsTraktV3();
}

function updateEpisodePosterLinkToStremio(stremioUrl) {
	// Page détail d'un épisode : clic sur la vignette principale => épisode exact dans Stremio.
	if (!stremioUrl || window.location.hostname !== "app.trakt.tv") return;

	const isEpisodeDetailPage = Boolean(getEpisodeDataFromTraktUrl(window.location.href));

	if (!isEpisodeDetailPage) return;

	bindCinetraktDetailPosterTargets(stremioUrl);
}

function updatePosterLinkToStremio(stremioUrl) {
	// On ne touche qu'au poster principal de la fiche détail Trakt.
	// Les cartes des pages Home / Continue Watching / Start Watching restent des liens Trakt normaux.
	if (!stremioUrl || window.location.hostname !== "app.trakt.tv") return;

	const isDetailPage = /^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname);

	if (!isDetailPage) return;

	bindCinetraktDetailPosterTargets(stremioUrl);
}

function getActionButtonFromCard(card) {
	if (!card) return null;

	const candidates = Array.from(card.querySelectorAll(
		'button[aria-label*="watched" i], button[aria-label*="unwatched" i], button[aria-label*="Mark" i], button.trakt-action-button, .trakt-action-button, [class*="action-button"], [class*="footer-action"] button'
	)).filter((button) => button && button !== card);

	if (!candidates.length) return null;

	// Priorité au vrai bouton d'action hors vignette. Les épisodes déjà vus ont parfois
	// un check overlay posé sur l'image : on le garde seulement en dernier recours.
	return candidates.find((button) => isElementVisible(button) && !isButtonInsideCardImage(button, card)) || candidates.find(isElementVisible) || candidates[0];
}

function isElementVisible(element) {
	if (!element) return false;
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

function isPointInsideRect(x, y, rect, padding = 0) {
	return (
		x >= rect.left - padding &&
		x <= rect.right + padding &&
		y >= rect.top - padding &&
		y <= rect.bottom + padding
	);
}

function isButtonInsideCardImage(button, card) {
	if (!button || !card) return false;

	const buttonRect = button.getBoundingClientRect();
	if (buttonRect.width <= 0 || buttonRect.height <= 0) return false;

	const buttonCenterX = buttonRect.left + buttonRect.width / 2;
	const buttonCenterY = buttonRect.top + buttonRect.height / 2;

	return Array.from(card.querySelectorAll('img')).some((image) => {
		const imageRect = image.getBoundingClientRect();
		if (imageRect.width < 40 || imageRect.height < 30) return false;
		return isPointInsideRect(buttonCenterX, buttonCenterY, imageRect, 8);
	});
}

const WATCH_ON_STREMIO_EPISODE_LINK_CLASS = "watch-on-stremio-episode-link";
const WATCH_ON_STREMIO_EPISODE_LINK_STYLE_ID = "watch-on-stremio-episode-link-styles";
const WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS = "watch-on-stremio-episode-link-group-active";
let watchOnStremioEpisodeLinkClickReady = false;
let watchOnStremioEpisodeLinkGroupSequence = 0;

function injectWatchOnStremioEpisodeLinkStyles() {
	if (document.getElementById(WATCH_ON_STREMIO_EPISODE_LINK_STYLE_ID)) return;

	const style = document.createElement("style");
	style.id = WATCH_ON_STREMIO_EPISODE_LINK_STYLE_ID;
	style.textContent = `
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS} {
			cursor: pointer !important;
			text-decoration: none !important;
			text-decoration-line: none !important;
			text-decoration-color: transparent !important;
			text-underline-offset: 0 !important;
			pointer-events: auto !important;
			transition: color 0.12s ease, opacity 0.12s ease !important;
		}

		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:hover,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:focus-visible,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}.${WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS} {
			color: #a855f7 !important;
			text-decoration: none !important;
			text-decoration-line: none !important;
			text-decoration-color: transparent !important;
		}

		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:hover .trakt-card-title,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:hover .trakt-card-subtitle,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:hover trakt-spoiler,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:focus-visible .trakt-card-title,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:focus-visible .trakt-card-subtitle,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:focus-visible trakt-spoiler,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}.${WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS} .trakt-card-title,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}.${WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS} .trakt-card-subtitle,
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}.${WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS} trakt-spoiler {
			color: #a855f7 !important;
		}
	`;
	document.documentElement.appendChild(style);
}

function setupWatchOnStremioEpisodeLinkClickHandler() {
	if (watchOnStremioEpisodeLinkClickReady) return;
	watchOnStremioEpisodeLinkClickReady = true;

	function handle(event) {
		if (!isFeatureEnabled()) return;
		const link = event.target.closest(`.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}`);
		if (!link) return;

		const stremioUrl = link.dataset.stremioUrl;
		if (!stremioUrl) return;

		openStremioFromMouseEvent(stremioUrl, event);
	}

	function getEpisodeLink(target) {
		return target instanceof Element
			? target.closest(`.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}`)
			: null;
	}

	function setEpisodeLinkGroupActive(link, active) {
		const groupId = link?.dataset.watchOnStremioEpisodeGroup;
		if (!groupId) return;

		document.querySelectorAll(`.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}`).forEach((candidate) => {
			if (candidate.dataset.watchOnStremioEpisodeGroup === groupId) {
				candidate.classList.toggle(WATCH_ON_STREMIO_EPISODE_LINK_GROUP_ACTIVE_CLASS, active);
			}
		});
	}

	function isSameEpisodeLinkGroup(link, relatedTarget) {
		const relatedLink = getEpisodeLink(relatedTarget);
		return !!relatedLink
			&& relatedLink.dataset.watchOnStremioEpisodeGroup === link?.dataset.watchOnStremioEpisodeGroup;
	}

	document.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) return;
		handle(event);
	}, true);

	document.addEventListener("contextmenu", handle, true);

	document.addEventListener("click", (event) => {
		if (!isFeatureEnabled()) return;
		const link = event.target.closest(`.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}`);
		if (!link?.dataset.stremioUrl) return;

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}, true);

	document.addEventListener("pointerover", (event) => {
		setEpisodeLinkGroupActive(getEpisodeLink(event.target), true);
	}, true);

	document.addEventListener("pointerout", (event) => {
		const link = getEpisodeLink(event.target);
		if (!link || isSameEpisodeLinkGroup(link, event.relatedTarget)) return;
		setEpisodeLinkGroupActive(link, false);
	}, true);

	document.addEventListener("focusin", (event) => {
		setEpisodeLinkGroupActive(getEpisodeLink(event.target), true);
	}, true);

	document.addEventListener("focusout", (event) => {
		const link = getEpisodeLink(event.target);
		if (!link || isSameEpisodeLinkGroup(link, event.relatedTarget)) return;
		setEpisodeLinkGroupActive(link, false);
	}, true);
}

function isVisibleForWatchOnStremio(element) {
	if (!element) return false;
	const rect = element.getBoundingClientRect();
	return rect.width > 0 && rect.height > 0;
}

function findNearestEpisodeContext(element) {
	let current = element;

	while (current && current !== document.body) {
		const text = current.textContent || "";
		const rect = current.getBoundingClientRect();
		const hasEpisodeText = /S\s*\d+\s*[•·.-]\s*E\s*\d+/i.test(text);
		const hasEpisodeLink = Boolean(findEpisodeLinkData(current));
		const hasImage = !!current.querySelector("img");

		if ((hasEpisodeText || hasEpisodeLink) && (hasImage || rect.height <= 140) && rect.width >= 40 && rect.width <= 1100 && rect.height >= 12 && rect.height <= 430) {
			return current;
		}

		current = current.parentElement;
	}

	return element?.parentElement || null;
}

function getInnermostEpisodeSpoilerTextElement(spoiler) {
	if (!spoiler) return null;
	const spoilerText = getCleanText(spoiler.textContent);
	if (!spoilerText) return null;

	return [spoiler, ...spoiler.querySelectorAll('span, p, div')]
		.filter((candidate) => getCleanText(candidate.textContent) === spoilerText)
		.map((candidate) => ({ candidate, rect: candidate.getBoundingClientRect() }))
		.filter(({ rect }) => rect.width > 0 && rect.height > 0)
		.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0]?.candidate || spoiler;
}

function getSeasonEpisodeClickableTargets(element, context = null) {
	if (!element) return [];
	const footerInformation = element.closest('.trakt-card-footer-information');
	if (footerInformation) {
		const title = footerInformation.querySelector(':scope > .trakt-card-title');
		const subtitle = footerInformation.querySelector(':scope > .trakt-card-subtitle');
		const episodePattern = /S\s*\d+\s*[•·.-]\s*E\s*\d+/i;
		const spoilerSelector = 'trakt-spoiler, [data-spoiler], [class*="spoiler"], [style*="blur"]';
		const episodeTarget = [title, subtitle].find((candidate) => (
			candidate && episodePattern.test(candidate.textContent || '')
		));

		if (episodeTarget) {
			const targets = [episodeTarget];
			const companion = episodeTarget === title ? subtitle : title;
			if (companion?.querySelector(spoilerSelector)) targets.push(companion);
			return targets;
		}
	}

	const episodePattern = /S\s*\d+\s*[•·.-]\s*E\s*\d+/i;
	const episodeRect = element.getBoundingClientRect();
	const boundary = element.closest('a[href*="/shows/"]') || context || element.parentElement;
	const spoilerSelectors = 'trakt-spoiler, [data-spoiler], [class*="spoiler"], [style*="blur"]';
	const spoilerCandidates = boundary ? [...boundary.querySelectorAll(spoilerSelectors)] : [];

	const blurredTitle = spoilerCandidates
		.map(getInnermostEpisodeSpoilerTextElement)
		.filter((candidate) => {
			if (!candidate || candidate === element || candidate.contains(element)) return false;
			const text = getCleanText(candidate.textContent);
			if (!text || episodePattern.test(text) || text.length > 120) return false;
			const rect = candidate.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0
				&& Math.abs((rect.top + rect.height / 2) - (episodeRect.top + episodeRect.height / 2)) <= 24;
		})
		.sort((a, b) => {
			const aRect = a.getBoundingClientRect();
			const bRect = b.getBoundingClientRect();
			return Math.abs(aRect.left - episodeRect.right) - Math.abs(bRect.left - episodeRect.right);
		})[0] || null;

	return blurredTitle ? [element, blurredTitle] : [element];
}

function makeSeasonEpisodeElementClickable(element, episodeData, stremioUrl, groupId = "") {
	if (!element || !episodeData || !stremioUrl) return;

	injectWatchOnStremioEpisodeLinkStyles();
	setupWatchOnStremioEpisodeLinkClickHandler();

	element.classList.add(WATCH_ON_STREMIO_EPISODE_LINK_CLASS);
	element.dataset.watchOnStremioEpisodeLinkReady = "true";
	element.dataset.stremioUrl = stremioUrl;
	element.dataset.watchOnStremioSeason = String(episodeData.season);
	element.dataset.watchOnStremioEpisode = String(episodeData.episode);
	if (groupId) element.dataset.watchOnStremioEpisodeGroup = groupId;
	element.setAttribute("role", "link");
	element.setAttribute("tabindex", "0");
	element.setAttribute("aria-label", `Open S${episodeData.season}E${episodeData.episode} in Stremio`);
	element.title = "";
	element.removeAttribute("title");

	if (element.dataset.watchOnStremioKeyboardReady !== "true") {
		element.dataset.watchOnStremioKeyboardReady = "true";
		element.addEventListener("keydown", (event) => {
			if (!isFeatureEnabled()) return;
			if (event.key !== "Enter" && event.key !== " ") return;
			openStremioFromMouseEvent(element.dataset.stremioUrl, event);
		}, true);
	}
}

function makeSeasonEpisodeTargetsClickable(elements, episodeData, stremioUrl) {
	const targets = (Array.isArray(elements) ? elements : [elements])
		.filter((element) => element instanceof Element);
	if (!targets.length) return;

	const existingGroupId = targets
		.map((element) => element.dataset.watchOnStremioEpisodeGroup)
		.find(Boolean);
	const groupId = existingGroupId || `cinetrakt-episode-${++watchOnStremioEpisodeLinkGroupSequence}`;
	targets.forEach((element) => makeSeasonEpisodeElementClickable(element, episodeData, stremioUrl, groupId));
}

function getSeasonEpisodeTextTargets(root = document.body) {
	const targets = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node;

	while ((node = walker.nextNode())) {
		if (!node.nodeValue || !/S\s*\d+\s*[•·.-]\s*E\s*\d+/i.test(node.nodeValue)) continue;

		const element = node.parentElement;
		if (!element || element.closest("script, style, textarea, input")) continue;
		if (!isVisibleForWatchOnStremio(element)) continue;

		targets.push({ element, text: node.nodeValue });
	}

	return targets;
}

function linkifySeasonEpisodeTextsWithKnownImdbId(imdbId) {
	if (!imdbId) return;

	getSeasonEpisodeTextTargets().forEach(({ element, text }) => {
		const episodeData = getSeasonEpisodeFromText(text);
		if (!episodeData) return;

		const stremioEpisodeUrl = buildStremioEpisodeUrl(imdbId, episodeData.season, episodeData.episode);
		makeSeasonEpisodeTargetsClickable(
			getSeasonEpisodeClickableTargets(element),
			episodeData,
			stremioEpisodeUrl
		);
	});
}

/*
	TRAKT V3 — épisodes sur une page de série.
	Plus de bouton Stremio injecté : le texte Sx • Ey devient le lien Stremio.
*/
function insertEpisodeStremioButtonsTraktV3(imdbId) {
	if (!imdbId || !window.location.href.includes("/shows/")) return;
	linkifySeasonEpisodeTextsWithKnownImdbId(imdbId);
}

function getCachedTraktImdbId(showSlug) {
	return globalThis.CineTraktImdbCache.get(showSlug);
}

function getShowSlugFromTraktUrl(url) {
	if (!url) return "";

	const match = url.match(/\/shows\/([^/?#]+)/);

	return match ? match[1] : "";
}

function getCanonicalTraktShowUrl(url) {
	const showSlug = getShowSlugFromTraktUrl(url);
	return showSlug ? new URL(`/shows/${showSlug}`, window.location.origin).href : "";
}

function getEpisodeLinkData(link) {
	if (!link?.matches?.('a[href*="/shows/"]')) return null;
	const episodeData = getEpisodeDataFromTraktUrl(link.href || link.getAttribute('href'));
	return episodeData ? { link, episodeData } : null;
}

function findEpisodeLinkData(root) {
	if (!root) return null;
	const candidates = [];
	if (root.matches?.('a[href*="/shows/"]')) candidates.push(root);
	if (typeof root.querySelectorAll === 'function') {
		candidates.push(...root.querySelectorAll('a[href*="/shows/"]'));
	}

	for (const link of candidates) {
		const match = getEpisodeLinkData(link);
		if (match) return match;
	}

	return null;
}

function getBestShowLinkFromCard(card) {
	if (!card) return "";

	const episodeLinkData = findEpisodeLinkData(card);
	if (episodeLinkData) return episodeLinkData.episodeData.showUrl;

	const showLink = card.querySelector('a[href*="/shows/"]');
	const canonicalShowUrl = getCanonicalTraktShowUrl(showLink?.href);
	if (canonicalShowUrl) return canonicalShowUrl;

	const htmlMatch = card.innerHTML.match(/\/shows\/[^"' ]+/);

	if (htmlMatch) {
		return getCanonicalTraktShowUrl(new URL(htmlMatch[0], window.location.origin).href);
	}

	return "";
}

function markSeasonEpisodeTargetsPreparing(elements, episodeData = null) {
	const targets = (Array.isArray(elements) ? elements : [elements])
		.filter((element) => element instanceof Element);
	if (!targets.length) return;

	injectWatchOnStremioEpisodeLinkStyles();
	setupWatchOnStremioEpisodeLinkClickHandler();
	const existingGroupId = targets
		.map((element) => element.dataset.watchOnStremioEpisodeGroup)
		.find(Boolean);
	const groupId = existingGroupId || `cinetrakt-episode-${++watchOnStremioEpisodeLinkGroupSequence}`;
	targets.forEach((element) => {
		element.classList.add(WATCH_ON_STREMIO_EPISODE_LINK_CLASS);
		element.dataset.watchOnStremioEpisodeGroup = groupId;
		if (episodeData) {
			element.dataset.watchOnStremioSeason = String(episodeData.season);
			element.dataset.watchOnStremioEpisode = String(episodeData.episode);
		}
	});
}

function markSeasonEpisodeTextTargetsPreparing() {
	getSeasonEpisodeTextTargets().forEach(({ element, text }) => {
		const episodeData = getSeasonEpisodeFromText(text);
		if (!episodeData) return;
		markSeasonEpisodeTargetsPreparing(
			getSeasonEpisodeClickableTargets(element, findNearestEpisodeContext(element)),
			episodeData,
		);
	});
}

function getTraktShowIdFromCard(card) {
	if (!card) return "";
	const parseImageId = globalThis.CineTraktTraktImdbResolver?.getTraktMediaIdFromImageUrl;
	if (typeof parseImageId !== "function") return "";

	for (const image of card.querySelectorAll('img[src], img[srcset]')) {
		for (const candidate of [image.currentSrc, image.src, image.getAttribute('src')]) {
			const traktId = parseImageId(candidate, 'shows');
			if (traktId) return traktId;
		}
	}

	return "";
}

function findEpisodeLookupContext(element, fallbackContext = null) {
	const officialCard = element
		?.closest('.trakt-card-footer-information')
		?.closest('.trakt-card');
	if (officialCard) return officialCard;

	for (let current = element; current && current !== document.body; current = current.parentElement) {
		const rect = current.getBoundingClientRect();
		if (rect.width > 900 || rect.height > 520) continue;
		if (current.matches?.('a[href*="/shows/"]')
			|| current.querySelector?.('a[href*="/shows/"]')
			|| getTraktShowIdFromCard(current)) {
			return current;
		}
	}

	return fallbackContext;
}

function getBestShowLinkFromEpisodeElement(element, context) {
	const closestLink = element.closest('a[href*="/shows/"]');
	const episodeLinkData = getEpisodeLinkData(closestLink);
	if (episodeLinkData) return episodeLinkData.episodeData.showUrl;
	const canonicalShowUrl = getCanonicalTraktShowUrl(closestLink?.href);
	if (canonicalShowUrl) return canonicalShowUrl;
	return getBestShowLinkFromCard(context);
}

async function getImdbIdFromTraktShowUrl(showUrl, traktShowId = "") {
	const showSlug = getShowSlugFromTraktUrl(showUrl);
	const lookupId = showSlug || String(traktShowId || "").replace(/\D/g, "");
	if (!lookupId) return "";

	return globalThis.CineTraktImdbCache.resolve(
		showSlug || `trakt-show-${lookupId}`,
		() => requestTraktImdbId(`/shows/${lookupId}`),
	);
}

function getCleanText(value) {
	return (value || "").replace(/\s+/g, " ").trim();
}

function findContinueWatchingCardFromElement(element) {
	const officialCard = element
		?.closest('.trakt-card-footer-information')
		?.closest('.trakt-card');
	if (officialCard) return officialCard;

	let current = element;

	while (current && current !== document.body) {
		const rect = current.getBoundingClientRect();
		const text = current.textContent || "";

		const hasEpisodeLink = findEpisodeLinkData(current);
		const hasEpisodeText = text.match(/S\s*\d+\s*[•·.-]\s*E\s*\d+/i);
		const hasImage = current.querySelector("img");
		const hasTraktButton = getActionButtonFromCard(current);

		const looksLikeContinueWatchingCard = (hasEpisodeLink || hasEpisodeText) && hasImage && hasTraktButton && rect.width >= 130 && rect.width <= 700 && rect.height >= 80 && rect.height <= 380;

		if (looksLikeContinueWatchingCard) {
			return current;
		}

		current = current.parentElement;
	}

	return null;
}

function isContinueWatchingPage() {
	return window.location.pathname.includes("/progress");
}

function isTraktHomePage() {
	const path = window.location.pathname.replace(/\/+$|^$/g, "") || "/";
	return path === "/" || path === "/dashboard" || path === "/home";
}

function isTraktPageNeedingExtensionWork() {
	if (window.location.hostname !== "app.trakt.tv") return false;

	const path = window.location.pathname;

	return /^\/(shows|movies)\//.test(path) || isContinueWatchingPage() || isTraktHomePage();
}

function getVisibleTextElementsMatching(regex) {
	return [...document.querySelectorAll("h1, h2, h3, h4, button, a, div, span")].filter((element) => {
		const text = getCleanText(element.textContent);
		if (!regex.test(text)) return false;

		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	});
}

function getContinueWatchingVerticalRange() {
	if (isContinueWatchingPage()) {
		return { top: -Infinity, bottom: Infinity };
	}

	const continueHeadings = getVisibleTextElementsMatching(/^Continue Watching$/i);

	if (continueHeadings.length === 0) {
		return null;
	}

	const continueHeading = continueHeadings.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
	const continueRect = continueHeading.getBoundingClientRect();
	const nextSectionHeadings = getVisibleTextElementsMatching(/^(Start Watching|Calendar|Trending|Recommended|Anticipated|Popular|Recently Watched|Up Next)$/i)
		.map((element) => element.getBoundingClientRect())
		.filter((rect) => rect.top > continueRect.top + 20)
		.sort((a, b) => a.top - b.top);

	return {
		top: continueRect.top - 40,
		bottom: nextSectionHeadings[0] ? nextSectionHeadings[0].top - 10 : Infinity,
	};
}

function getVisibleSectionHeadingCandidates() {
	const sectionTitles = /^(Continue Watching|Start Watching|Calendar|Trending|Recommended|Anticipated|Popular|Recently Watched|Up Next)$/i;

	return [...document.querySelectorAll("h1, h2, h3, h4, button, a, div, span")]
		.map((element) => {
			const text = getCleanText(element.textContent);
			const rect = element.getBoundingClientRect();

			return { element, text, rect };
		})
		.filter((item) => {
			if (!sectionTitles.test(item.text)) return false;
			if (item.rect.width <= 0 || item.rect.height <= 0) return false;

			// Évite les énormes conteneurs Svelte qui contiennent toute la page.
			return item.rect.width <= 500 && item.rect.height <= 90;
		})
		.sort((a, b) => a.rect.top - b.rect.top);
}

function getNearestSectionTitleAboveCard(card) {
	if (!card) return "";

	const cardRect = card.getBoundingClientRect();
	const headings = getVisibleSectionHeadingCandidates()
		.filter((item) => item.rect.top < cardRect.top + 10)
		.sort((a, b) => b.rect.top - a.rect.top);

	return headings[0]?.text || "";
}

function isCardInContinueWatchingArea(card) {
	if (!card) return false;

	if (isContinueWatchingPage()) return true;

	const nearestSectionTitle = getNearestSectionTitleAboveCard(card);

	return /^Continue Watching$/i.test(nearestSectionTitle);
}


function prepareSeasonEpisodeTextLinkFromShowUrl(elements, episodeData, showUrl, card = null) {
	const targets = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
	if (targets.length === 0 || !episodeData) return;
	markSeasonEpisodeTargetsPreparing(targets, episodeData);

	const showSlug = getShowSlugFromTraktUrl(showUrl);
	const traktShowId = getTraktShowIdFromCard(card);
	const cacheKey = showSlug || (traktShowId ? `trakt-show-${traktShowId}` : "");
	if (!cacheKey) return;

	const cachedImdbId = getCachedTraktImdbId(cacheKey);
	if (cachedImdbId) {
		const stremioUrl = buildStremioEpisodeUrl(cachedImdbId, episodeData.season, episodeData.episode);
		makeSeasonEpisodeTargetsClickable(targets, episodeData, stremioUrl);
		return;
	}

	const preparationTarget = targets[0];
	if (preparationTarget.dataset.watchOnStremioLinkPrepareStarted === "true") return;
	preparationTarget.dataset.watchOnStremioLinkPrepareStarted = "true";

	getImdbIdFromTraktShowUrl(showUrl, traktShowId).then((imdbId) => {
		if (!imdbId) {
			delete preparationTarget.dataset.watchOnStremioLinkPrepareStarted;
			return;
		}
		const stremioUrl = buildStremioEpisodeUrl(imdbId, episodeData.season, episodeData.episode);
		makeSeasonEpisodeTargetsClickable(targets, episodeData, stremioUrl);
	}).catch(() => {
		delete preparationTarget.dataset.watchOnStremioLinkPrepareStarted;
	});
}

function linkifyContinueWatchingSeasonEpisodeTexts() {
	if (window.location.hostname !== "app.trakt.tv") return;
	if (!isContinueWatchingPage() && !getContinueWatchingVerticalRange()) return;

	getSeasonEpisodeTextTargets().forEach(({ element, text }) => {
		const episodeData = getSeasonEpisodeFromText(text);
		if (!episodeData) return;

		const initialContext = findContinueWatchingCardFromElement(element) || findNearestEpisodeContext(element);
		const initialTargets = getSeasonEpisodeClickableTargets(element, initialContext);
		markSeasonEpisodeTargetsPreparing(initialTargets, episodeData);
		const context = findEpisodeLookupContext(element, initialContext);
		if (!context || !isCardInContinueWatchingArea(context)) return;

		const showUrl = getBestShowLinkFromEpisodeElement(element, context);

		prepareSeasonEpisodeTextLinkFromShowUrl(
			getSeasonEpisodeClickableTargets(element, context),
			episodeData,
			showUrl,
			context,
		);
	});
}

/*
	TRAKT V3 — Continue Watching / Home / Progress.
	Plus de bouton : le texte Sx • Ey devient cliquable.
*/
function insertContinueWatchingStremioButtonsTraktV3() {
	linkifyContinueWatchingSeasonEpisodeTexts();
}
	const api = Object.freeze({
		update: insertStremioButtonTraktV3,
		refreshDetailPosterTarget: refreshCinetraktDetailPosterTarget,
		isPageRelevant: isTraktPageNeedingExtensionWork,
		getImdbIdFromPage,
		getCachedImdbId: getCachedTraktImdbId,
		getShowSlugFromUrl: getShowSlugFromTraktUrl,
		resolveImdbIdFromMediaUrl: getImdbIdFromTraktMediaUrl,
		resolveImdbIdFromShowUrl: getImdbIdFromTraktShowUrl,
		getCleanText,
	});

	globalThis.CineTraktTraktStremioUi = api;
})();
