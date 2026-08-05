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

function bindCinetraktStremioOpenHandlers(element, getStremioUrl) {
	if (!element || typeof getStremioUrl !== "function") return;
	if (element.dataset.cinetraktStremioBound === "1") return;

	element.dataset.cinetraktStremioBound = "1";

	element.addEventListener(
		"click",
		function (event) {
			if (!isFeatureEnabled()) return;
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);

	element.addEventListener(
		"contextmenu",
		function (event) {
			if (!isFeatureEnabled()) return;
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);
}

/*
	TRAKT V3
	Version propre :
	- ne modifie PAS le hover
	- ne modifie PAS l'overlay
	- ne modifie PAS Where to Watch
	- change seulement le clic sur la jaquette pour ouvrir Stremio
*/
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

	const imdbId = getImdbIdFromPage();

	if (imdbId) {
		const type = getTraktMediaType(window.location.href);
		const stremioUrl = buildStremioDetailUrl(type, imdbId);

		updatePosterLinkToStremio(stremioUrl);

		if (type === "series") {
			insertEpisodeStremioButtonsTraktV3(imdbId);
		}
	}

	insertContinueWatchingStremioButtonsTraktV3();
}

function updateEpisodePosterLinkToStremio(stremioUrl) {
	// Page détail d'un épisode : clic sur la vignette principale => épisode exact dans Stremio.
	if (!stremioUrl || window.location.hostname !== "app.trakt.tv") return;

	const isEpisodeDetailPage = /^\/shows\/[^/]+\/seasons\/\d+\/episodes\/\d+\/?$/.test(window.location.pathname);

	if (!isEpisodeDetailPage) return;

	const posterTarget = document.querySelector(".trakt-summary-poster a") || document.querySelector(".trakt-summary-poster") || document.querySelector("[class*='summary-poster'] a") || document.querySelector("[class*='summary-poster']");

	if (!posterTarget) return;

	posterTarget.dataset.watchOnStremioClickFixed = "true";
	posterTarget.dataset.stremioUrl = stremioUrl;
	posterTarget.style.cursor = "pointer";

	posterTarget.dataset.watchOnStremioEpisodePosterHandlerReady = "true";
	bindCinetraktStremioOpenHandlers(posterTarget, () => posterTarget.dataset.stremioUrl || stremioUrl);
}

function updatePosterLinkToStremio(stremioUrl) {
	// On ne touche qu'au poster principal de la fiche détail Trakt.
	// Les cartes des pages Home / Continue Watching / Start Watching restent des liens Trakt normaux.
	if (!stremioUrl || window.location.hostname !== "app.trakt.tv") return;

	const isDetailPage = /^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname);

	if (!isDetailPage) return;

	const posterLink = document.querySelector(".trakt-summary-poster a");

	if (!posterLink) return;

	posterLink.dataset.watchOnStremioClickFixed = "true";
	posterLink.dataset.stremioUrl = stremioUrl;

	posterLink.dataset.watchOnStremioPosterHandlerReady = "true";
	bindCinetraktStremioOpenHandlers(posterLink, () => posterLink.dataset.stremioUrl || stremioUrl);
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
		if (!link) return;

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
		const hasEpisodeLink = !!current.querySelector('a[href*="/shows/"][href*="/seasons/"][href*="/episodes/"]');
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

function getBestShowLinkFromCard(card) {
	if (!card) return "";

	const episodeLink = card.querySelector('a[href*="/shows/"][href*="/seasons/"][href*="/episodes/"]');

	if (episodeLink) return episodeLink.href;

	const showLink = card.querySelector('a[href*="/shows/"]');

	if (showLink) return showLink.href;

	const htmlMatch = card.innerHTML.match(/\/shows\/[^"' ]+/);

	if (htmlMatch) {
		return new URL(htmlMatch[0], window.location.origin).href;
	}

	return "";
}

function findImdbIdInHtml(html, showSlug) {
	if (!html) return "";

	const imdbFromExternalLink = html.match(/id=["']external-link-imdb["'][^>]+href=["'][^"']*(tt\d{7,})/i) || html.match(/href=["'][^"']*imdb\.com\/title\/(tt\d{7,})/i);

	if (imdbFromExternalLink) return imdbFromExternalLink[1];

	if (!showSlug) return "";

	const slugIndex = html.indexOf(showSlug);

	if (slugIndex === -1) return "";

	const start = Math.max(0, slugIndex - 30000);
	const end = Math.min(html.length, slugIndex + 30000);
	const aroundSlug = html.slice(start, end);

	return aroundSlug.match(/imdb\.com\/title\/(tt\d{7,})/i)?.[1] || aroundSlug.match(/"imdb"\s*:\s*"(tt\d{7,})"/i)?.[1] || aroundSlug.match(/\btt\d{7,}\b/i)?.[0] || "";
}

function getImdbIdFromDocument(doc, showSlug) {
	if (!doc) return "";

	const imdbLink = doc.querySelector('#external-link-imdb[href*="tt"], a[href*="imdb.com/title/tt"]');
	const imdbHref = imdbLink ? imdbLink.href : "";
	const imdbFromLink = imdbHref.match(/tt\d{7,}/i);

	if (imdbFromLink) return imdbFromLink[0];

	return findImdbIdInHtml(doc.documentElement ? doc.documentElement.innerHTML : "", showSlug);
}

function getImdbIdFromHiddenTraktIframe(showSlug) {
	if (!showSlug) return Promise.resolve("");

	return new Promise((resolve) => {
		const iframe = document.createElement("iframe");
		let resolved = false;
		let tries = 0;
		let checkTimer = null;
		const maxTries = 40;

		function cleanIframe() {
			setTimeout(() => {
				if (iframe && iframe.parentElement) {
					iframe.parentElement.removeChild(iframe);
				}
			}, 300);
		}

		function finish(imdbId) {
			if (resolved) return;

			resolved = true;
			window.clearTimeout(checkTimer);

			cleanIframe();
			resolve(imdbId || "");
		}

		function scheduleCheck(delay) {
			if (resolved) return;
			window.clearTimeout(checkTimer);
			checkTimer = window.setTimeout(checkIframe, delay);
		}

		function checkIframe() {
			if (resolved) return;

			tries++;

			try {
				const doc = iframe.contentDocument || iframe.contentWindow?.document;
				const imdbId = getImdbIdFromDocument(doc, showSlug);

				if (imdbId) {
					finish(imdbId);
					return;
				}
			} catch {
				// Cross-origin or incomplete frames are retried until the finite deadline.
			}

			if (tries >= maxTries) {
				finish("");
				return;
			}

			scheduleCheck(250);
		}

		iframe.src = `${window.location.origin}/shows/${showSlug}?ignore_watchlisted=false&mode=media`;
		iframe.style.position = "fixed";
		iframe.style.left = "-9999px";
		iframe.style.top = "-9999px";
		iframe.style.width = "1px";
		iframe.style.height = "1px";
		iframe.style.opacity = "0";
		iframe.style.pointerEvents = "none";
		iframe.style.border = "0";
		iframe.className = "cinetrakt-imdb-resolver-frame";
		iframe.setAttribute("aria-hidden", "true");

		iframe.addEventListener("load", function () {
			scheduleCheck(250);
		});

		document.body.appendChild(iframe);
		scheduleCheck(500);
	});
}

async function getImdbIdFromTraktShowUrl(showUrl) {
	const showSlug = getShowSlugFromTraktUrl(showUrl);

	if (!showSlug) return "";

	return globalThis.CineTraktImdbCache.resolve(showSlug, async () => {
		try {
			const cleanShowUrl = `${window.location.origin}/shows/${showSlug}`;
			const response = await fetch(cleanShowUrl, {
				credentials: "include",
			});

			const html = await response.text();
			const imdbId = findImdbIdInHtml(html, showSlug);

			if (imdbId) return imdbId;
		} catch {
			// The hidden same-origin page below is the compatibility fallback.
		}

		return getImdbIdFromHiddenTraktIframe(showSlug);
	});
}

function getCleanText(value) {
	return (value || "").replace(/\s+/g, " ").trim();
}

function findContinueWatchingCardFromElement(element) {
	let current = element;

	while (current && current !== document.body) {
		const rect = current.getBoundingClientRect();
		const text = current.textContent || "";

		const hasEpisodeLink = current.querySelector('a[href*="/shows/"][href*="/seasons/"][href*="/episodes/"]');
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


function prepareSeasonEpisodeTextLinkFromShowUrl(elements, episodeData, showUrl) {
	const targets = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
	if (targets.length === 0 || !episodeData || !showUrl) return;

	const showSlug = getShowSlugFromTraktUrl(showUrl);
	if (!showSlug) return;

	const cachedImdbId = getCachedTraktImdbId(showSlug);
	if (cachedImdbId) {
		const stremioUrl = buildStremioEpisodeUrl(cachedImdbId, episodeData.season, episodeData.episode);
		makeSeasonEpisodeTargetsClickable(targets, episodeData, stremioUrl);
		return;
	}

	const preparationTarget = targets[0];
	if (preparationTarget.dataset.watchOnStremioLinkPrepareStarted === "true") return;
	preparationTarget.dataset.watchOnStremioLinkPrepareStarted = "true";

	getImdbIdFromTraktShowUrl(showUrl).then((imdbId) => {
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

		const context = findContinueWatchingCardFromElement(element) || findNearestEpisodeContext(element);
		if (!context || !isCardInContinueWatchingArea(context)) return;

		const showUrl = getBestShowLinkFromCard(context);
		if (!showUrl) return;

		prepareSeasonEpisodeTextLinkFromShowUrl(
			getSeasonEpisodeClickableTargets(element, context),
			episodeData,
			showUrl,
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
		isPageRelevant: isTraktPageNeedingExtensionWork,
		getImdbIdFromPage,
		getCachedImdbId: getCachedTraktImdbId,
		getShowSlugFromUrl: getShowSlugFromTraktUrl,
		resolveImdbIdFromShowUrl: getImdbIdFromTraktShowUrl,
		getCleanText,
	});

	globalThis.CineTraktTraktStremioUi = api;
})();
