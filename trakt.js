console.log("CineTrakt: Extension loaded");
/*
 * Securite Trakt V3 : ne jamais transformer les cartes / jaquettes Trakt en liens Stremio.
 * Stremio doit s'ouvrir uniquement via les boutons injectes par l'extension.
 */
let watchOnStremioTraktLinkProtectorReady = false;

function isCinetraktFeatureEnabled(key) {
	return globalThis.CineTraktSettings?.isEnabled(key) !== false;
}

function isWatchOnStremioOwnButton(element) {
	if (!element) return false;

	const ownElement = element.closest(".watch-on-stremio-episode-btn, .watch-on-stremio-continue-btn, .watch-on-stremio-episode-link, .stremio-header-btn, .stremio-button, .watch-on-stremio-temp-link");

	if (ownElement) return true;

	const ownLink = element.closest("a[data-watch-on-stremio-click-fixed='true'], a[data-watch-on-stremio-temp-link='true']");

	return !!ownLink;
}

function protectTraktV3NativeLinks() {
	if (window.location.hostname !== "app.trakt.tv") return;

	const links = document.querySelectorAll("a[href]");

	links.forEach((link) => {
		if (isWatchOnStremioOwnButton(link)) return;

		const href = link.getAttribute("href") || "";

		if (!href.startsWith("stremio:")) {
			link.dataset.watchOnStremioOriginalHref = href;
			return;
		}

		const originalHref = link.dataset.watchOnStremioOriginalHref;

		if (originalHref && !originalHref.startsWith("stremio:")) {
			link.setAttribute("href", originalHref);
			link.removeAttribute("data-watch-on-stremio-click-fixed");
			console.log("CineTrakt: restored Trakt native link:", originalHref);
		} else {
			link.removeAttribute("href");
			link.removeAttribute("data-watch-on-stremio-click-fixed");
			console.log("CineTrakt: removed bad Stremio href from native Trakt link");
		}
	});
}

function setupTraktV3NativeLinkProtector() {
	if (window.location.hostname !== "app.trakt.tv") return;
	if (watchOnStremioTraktLinkProtectorReady) return;

	watchOnStremioTraktLinkProtectorReady = true;

	document.addEventListener(
		"click",
		function (event) {
			const link = event.target.closest("a[href^='stremio:']");

			if (!link) return;
			if (isWatchOnStremioOwnButton(link)) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			const originalHref = link.dataset.watchOnStremioOriginalHref;

			if (originalHref && !originalHref.startsWith("stremio:")) {
				link.setAttribute("href", originalHref);
				window.location.href = originalHref;
			}
		},
		true,
	);

	const observer = new MutationObserver(() => {
		protectTraktV3NativeLinks();
	});

	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["href"],
	});

	protectTraktV3NativeLinks();
	console.log("CineTrakt: Trakt native link protector ready");
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

function getTraktV3Type() {
	if (window.location.href.includes("/shows/")) {
		return "series";
	}

	return "movie";
}

function bindCinetraktStremioOpenHandlers(element, getStremioUrl) {
	if (!element || typeof getStremioUrl !== "function") return;
	if (element.dataset.cinetraktStremioBound === "1") return;

	element.dataset.cinetraktStremioBound = "1";

	element.addEventListener(
		"click",
		function (event) {
			openStremioFromMouseEvent(getStremioUrl(), event);
		},
		true,
	);

	element.addEventListener(
		"contextmenu",
		function (event) {
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
		const type = getTraktV3Type();
		const stremioUrl = `stremio:///detail/${type}/${imdbId}`;

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

	if (posterTarget.tagName && posterTarget.tagName.toLowerCase() === "a") {
		posterTarget.dataset.watchOnStremioOriginalHref = posterTarget.getAttribute("href") || window.location.pathname;
		posterTarget.href = stremioUrl;
		posterTarget.removeAttribute("target");
		posterTarget.removeAttribute("rel");
	}

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
	posterLink.dataset.watchOnStremioOriginalHref = posterLink.getAttribute("href") || window.location.pathname;
	posterLink.href = stremioUrl;
	posterLink.removeAttribute("target");
	posterLink.removeAttribute("rel");

	posterLink.dataset.watchOnStremioPosterHandlerReady = "true";
	bindCinetraktStremioOpenHandlers(posterLink, () => posterLink.href);
}

function openStremioUrl(stremioUrl) {
	if (!stremioUrl) return;

	function triggerNativeProtocol() {
		const tempLink = document.createElement("a");
		tempLink.href = stremioUrl;
		tempLink.target = "_self";
		tempLink.className = "watch-on-stremio-temp-link";
		tempLink.dataset.watchOnStremioTempLink = "true";
		tempLink.style.display = "none";

		document.body.appendChild(tempLink);
		tempLink.click();
		document.body.removeChild(tempLink);
	}

	triggerNativeProtocol();

	// Stremio Desktop v5 peut parfois seulement réveiller l'accueil si l'app est fermée.
	// On renvoie automatiquement le même deep-link, sans demander un deuxième clic manuel.
	window.setTimeout(triggerNativeProtocol, 1200);
	window.setTimeout(triggerNativeProtocol, 2400);
}

function getStremioWebUrl(stremioUrl) {
	if (!stremioUrl) return "";

	// Stremio Web v5 est plus fiable quand le hash reste le plus "normal" possible.
	// Donc pour le web player on garde les ":" visibles dans l'ID vidéo, au lieu de laisser tt%3A1%3A2.
	return stremioUrl
		.replace(/^stremio:\/\/\/detail\//, "https://web.stremio.com/#/detail/")
		.replace(/^stremio:\/\/detail\//, "https://web.stremio.com/#/detail/")
		.replace(/%3A/gi, ":");
}

function getStremioPopupUrl(stremioUrl) {
	const webUrl = getStremioWebUrl(stremioUrl);
	if (!webUrl) return "";

	// Le routeur Stremio lit strictement le hash. Si on ajoute notre flag apres la
	// route, Stremio peut rester sur "Aucune metadata selectionnee" jusqu'a une
	// interaction manuelle. On garde donc le hash Stremio propre et on place le flag
	// CineTrakt dans la query de page, que stremio.js sait deja lire.
	const hashIndex = webUrl.indexOf("#");
	const cacheBuster = `wos_t=${Date.now()}`;
	if (hashIndex === -1) {
		const separator = webUrl.includes("?") ? "&" : "?";
		return webUrl + separator + "wos_stream_panel=1&" + cacheBuster;
	}

	const beforeHash = webUrl.slice(0, hashIndex);
	const afterHash = webUrl.slice(hashIndex);
	const separator = beforeHash.includes("?") ? "&" : "?";
	return beforeHash + separator + "wos_stream_panel=1&" + cacheBuster + afterHash;
}

function getCurrentScreenBoundsForPopup() {
	return {
		availLeft: Number.isFinite(screen.availLeft) ? screen.availLeft : 0,
		availTop: Number.isFinite(screen.availTop) ? screen.availTop : 0,
		availWidth: screen.availWidth || window.outerWidth || 1920,
		availHeight: screen.availHeight || window.outerHeight || 1080,
	};
}


function getStremioFallbackPopupFeatures() {
	const popupMinWidth = 560;
	const popupMaxWidth = 760;
	const popupDefaultWidth = 610;
	const snapEdgeTopFix = -1;
	const snapEdgeRightFix = 8;
	const snapEdgeBottomFix = 8;

	const bounds = getCurrentScreenBoundsForPopup();
	const rawLeft = Math.round(Number(bounds.availLeft) || 0);
	const rawTop = Math.round(Number(bounds.availTop) || 0);
	const rawWidth = Math.max(1, Math.round(Number(bounds.availWidth) || 1920));
	const rawHeight = Math.max(1, Math.round(Number(bounds.availHeight) || 1080));

	const top = rawTop + snapEdgeTopFix;
	const width = rawWidth + snapEdgeRightFix;
	const height = rawHeight + Math.abs(snapEdgeTopFix) + snapEdgeBottomFix;
	const maxPopupWidth = Math.min(popupMaxWidth, Math.floor(width * 0.36));
	const popupWidth = Math.max(popupMinWidth, Math.min(popupDefaultWidth, maxPopupWidth));
	const popupLeft = rawLeft + width - popupWidth;

	return `popup=yes,width=${popupWidth},height=${height},left=${popupLeft},top=${top}`;
}

function openStremioWebFallback(webUrl) {
	window.open(webUrl, "watch_on_stremio_web_player", getStremioFallbackPopupFeatures());
}

function canUseExtensionRuntime() {
	try {
		return !!(chrome && chrome.runtime && chrome.runtime.id && typeof chrome.runtime.sendMessage === "function");
	} catch (error) {
		return false;
	}
}

function openStremioWebUrl(stremioUrl) {
	const webUrl = getStremioPopupUrl(stremioUrl);

	if (!webUrl) return;

	// Toujours passer par le background : c'est lui qui garde la fenêtre Stremio
	// en mode popup propre et avec le placement pixel-perfect.
	// Pas de window.open en fallback : ça crée une fenêtre Chrome normale blanche / avec barre d'adresse.
	if (!canUseExtensionRuntime()) {
		return;
	}

	try {
		chrome.runtime.sendMessage(
			{
				type: "WATCH_ON_STREMIO_OPEN_WEB",
				url: webUrl,
				screenBounds: getCurrentScreenBoundsForPopup(),
			},
			function (response) {
				let hasRuntimeError = false;

				try {
					hasRuntimeError = !!chrome.runtime.lastError;
				} catch (error) {
					hasRuntimeError = true;
				}

				if (hasRuntimeError || !response?.ok) return;
			}
		);
	} catch (error) {
		return;
	}
}

function openStremioFromMouseEvent(stremioUrl, event) {
	if (!stremioUrl) return;

	if (event) {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}

	if (event && (event.type === "contextmenu" || event.button === 2)) {
		openStremioUrl(stremioUrl);
		return;
	}

	openStremioWebUrl(stremioUrl);
}

function setStremioButtonVisualReadyState(button, isReady) {
	if (!button) return;

	const img = button.querySelector("img");

	button.dataset.stremioReady = isReady ? "true" : "false";
	button.title = "";
	button.removeAttribute("title");

	if (isReady) {
		button.style.opacity = "1";
		button.style.cursor = "pointer";

		if (img) {
			img.style.filter = "none";
			img.style.opacity = "1";
		}
	} else {
		button.style.opacity = "0.65";
		button.style.cursor = "default";

		if (img) {
			img.style.filter = "grayscale(1) brightness(0.75)";
			img.style.opacity = "0.65";
		}
	}
}

function getSeasonEpisodeFromText(text) {
	if (!text) return null;

	const match = text.match(/S\s*(\d+)\s*[•·.-]\s*E\s*(\d+)/i);

	if (!match) return null;

	return {
		season: parseInt(match[1], 10),
		episode: parseInt(match[2], 10),
	};
}

function getEpisodeDataFromTraktUrl(url) {
	if (!url) return null;

	const match = url.match(/\/shows\/([^/?#]+)\/seasons\/(\d+)\/episodes\/(\d+)/);

	if (!match) return null;

	return {
		showSlug: match[1],
		season: parseInt(match[2], 10),
		episode: parseInt(match[3], 10),
		showUrl: `${window.location.origin}/shows/${match[1]}`,
	};
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

function getFallbackActionContainerFromCard(card) {
	if (!card) return null;

	return card.querySelector(".trakt-card-footer-action") || card.querySelector("[class*='card-footer-action']") || card.querySelector("[class*='bottom-bar']") || card.querySelector("[class*='footer']") || card;
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

function isUsableTraktActionButton(checkButton, card) {
	if (!checkButton || !checkButton.parentElement || !isElementVisible(checkButton)) return false;

	// Les épisodes déjà vus ont souvent un petit check gris posé SUR la vignette.
	// Ce n'est pas une zone d'action : si on injecte Stremio à côté, l'icône se retrouve
	// au milieu/en haut de l'image. On ignore donc ces checks overlay.
	if (isButtonInsideCardImage(checkButton, card)) return false;

	const parentRect = checkButton.parentElement.getBoundingClientRect();
	return parentRect.width > 0 && parentRect.height > 0;
}

function getEpisodeCardLayoutKind(card) {
	if (!card) return 'grid';
	const rect = card.getBoundingClientRect();
	const hasWideRowShape = rect.width >= 360 && rect.height <= 190;
	return hasWideRowShape ? 'row' : 'grid';
}

function getLargestImageInCard(card) {
	if (!card) return null;

	return Array.from(card.querySelectorAll('img'))
		.map((image) => ({ image, rect: image.getBoundingClientRect() }))
		.filter((item) => item.rect.width >= 50 && item.rect.height >= 40)
		.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0]?.image || null;
}

function getVisibleTraktCheckButtonInCard(card) {
	if (!card) return null;

	const buttons = Array.from(card.querySelectorAll(
		'button[aria-label*="watched" i], button[aria-label*="unwatched" i], button[aria-label*="Mark" i], button.trakt-action-button, .trakt-action-button, [class*="action-button"], [class*="footer-action"] button'
	)).filter((button) => {
		if (!button || !isElementVisible(button)) return false;
		if (button.closest('.watch-on-stremio-fallback-actions')) return false;
		if (button.closest('.watch-on-stremio-episode-btn, .watch-on-stremio-continue-btn')) return false;
		return true;
	});

	if (!buttons.length) return null;

	// Le check Trakt est le point d'ancrage visuel le plus fiable.
	// Même quand il est posé sur la vignette, on préfère se caler juste à côté
	// plutôt que d'inventer une position qui finit dans le titre au scroll.
	return buttons
		.map((button) => ({ button, rect: button.getBoundingClientRect() }))
		.filter((item) => item.rect.width > 0 && item.rect.height > 0)
		.sort((a, b) => {
			// Priorité aux boutons à droite / en bas, typiquement la zone d'action.
			const ar = a.rect.left + a.rect.top * 0.2;
			const br = b.rect.left + b.rect.top * 0.2;
			return br - ar;
		})[0]?.button || buttons[0];
}

function positionFallbackEpisodeActionContainer(card, container) {
	if (!card || !container) return;

	if (getComputedStyle(card).position === 'static') {
		card.style.position = 'relative';
	}

	const cardRect = card.getBoundingClientRect();
	const kind = getEpisodeCardLayoutKind(card);
	const checkButton = getVisibleTraktCheckButtonInCard(card);
	const checkRect = checkButton ? checkButton.getBoundingClientRect() : null;

	container.style.position = 'absolute';
	container.style.zIndex = '999999';
	container.style.display = 'flex';
	container.style.alignItems = 'center';
	container.style.justifyContent = 'center';
	container.style.gap = '0';
	container.style.pointerEvents = 'auto';
	container.style.background = 'transparent';
	container.style.border = '0';
	container.style.padding = '0';
	container.style.margin = '0';
	container.style.width = '28px';
	container.style.height = '28px';
	container.style.bottom = 'auto';
	container.style.right = 'auto';
	container.style.transform = 'none';

	if (checkRect && cardRect.width > 0 && cardRect.height > 0) {
		// Position stable : toujours juste à gauche du check Trakt réel.
		// Si le check est overlay sur la vignette, on reste à côté de lui ;
		// s'il est en fin de ligne dans le panneau Seasons, pareil.
		const left = Math.round(checkRect.left - cardRect.left - 34);
		const top = Math.round(checkRect.top - cardRect.top + (checkRect.height - 28) / 2);

		container.style.left = `${Math.max(0, Math.min(cardRect.width - 28, left))}px`;
		container.style.top = `${Math.max(0, Math.min(cardRect.height - 28, top))}px`;
		return;
	}

	// Aucun check visible : on met le bouton à l'endroit où le check serait attendu.
	// Row = panneau latéral ; grid = cartes horizontales sous la série.
	if (kind === 'row') {
		container.style.right = '58px';
		container.style.top = '50%';
		container.style.transform = 'translateY(-50%)';
		return;
	}

	container.style.right = '42px';
	container.style.bottom = '16px';
}

function getOrCreateFallbackEpisodeActionContainer(card) {
	if (!card) return null;

	let container = card.querySelector(':scope > .watch-on-stremio-fallback-actions');
	if (!container) {
		container = document.createElement('div');
		container.className = 'watch-on-stremio-fallback-actions';
		container.dataset.watchOnStremioFallbackActions = 'true';
		card.appendChild(container);
	}

	positionFallbackEpisodeActionContainer(card, container);
	return container;
}

function getButtonActionClass(button) {
	if (!button) return '';
	if (button.classList.contains('watch-on-stremio-continue-btn')) return 'watch-on-stremio-continue-btn';
	if (button.classList.contains('watch-on-stremio-episode-btn')) return 'watch-on-stremio-episode-btn';
	return '';
}

function getOwnStremioButtonsInCard(card, className = 'watch-on-stremio-episode-btn') {
	if (!card) return [];

	const buttons = new Set(Array.from(card.querySelectorAll(`.${className}`)));

	// Sécurité : si une ancienne version a laissé un bouton Stremio sans la bonne classe,
	// on le récupère aussi pour éviter les doublons visuels.
	Array.from(card.querySelectorAll('img[src*="stremio-logo-small"]')).forEach((image) => {
		const button = image.closest('button, a');
		if (button && card.contains(button)) buttons.add(button);
	});

	return Array.from(buttons).filter((button) => button.isConnected);
}

function cleanupDuplicateEpisodeStremioButtons(card, expectedUrl = "") {
	if (!card) return null;

	const buttons = getOwnStremioButtonsInCard(card, 'watch-on-stremio-episode-btn');
	if (buttons.length === 0) {
		delete card.dataset.watchOnStremioEpisodeButton;
		return null;
	}

	const preferredButton =
		(expectedUrl && buttons.find((button) => button.dataset.stremioUrl === expectedUrl)) ||
		buttons.find((button) => button.dataset.stremioUrl) ||
		buttons[0];

	buttons.forEach((button) => {
		if (button !== preferredButton) button.remove();
	});

	preferredButton.classList.add('watch-on-stremio-episode-btn');
	card.dataset.watchOnStremioEpisodeButton = 'true';
	return preferredButton;
}

function findWatchOnStremioEpisodeScope(element) {
	let current = element;

	while (current && current !== document.body) {
		const text = current.textContent || "";
		const rect = current.getBoundingClientRect();
		const episodeMatches = text.match(/S\s*\d+\s*[•·.-]\s*E\s*\d+/gi) || [];

		// On prend le plus petit bloc qui ressemble vraiment à UNE carte ou UNE ligne d'épisode.
		// Ça évite de regrouper toute la section Seasons, tout en nettoyant les doublons
		// créés par les re-renders du panneau latéral Trakt.
		if (episodeMatches.length >= 1 && episodeMatches.length <= 2 && rect.width >= 120 && rect.width <= 920 && rect.height >= 45 && rect.height <= 360) {
			return current;
		}

		current = current.parentElement;
	}

	return element.closest("[class*='card'], [class*='row'], [class*='item']") || element.parentElement;
}

function cleanupAllDuplicateStremioButtons() {
	const selectors = [".watch-on-stremio-episode-btn", ".watch-on-stremio-continue-btn"];

	// 1) Nettoyage simple : plusieurs boutons dans exactement le même parent.
	selectors.forEach((selector) => {
		document.querySelectorAll(selector).forEach((button) => {
			const parent = button.parentElement;
			if (!parent) return;

			const siblings = Array.from(parent.querySelectorAll(selector));
			if (siblings.length <= 1) return;

			const preferredButton = siblings.find((candidate) => candidate.dataset.stremioUrl) || siblings[0];
			siblings.forEach((candidate) => {
				if (candidate !== preferredButton) candidate.remove();
			});
		});
	});

	// 2) Nettoyage par carte / ligne d'épisode : plus fiable que les pixels seuls.
	selectors.forEach((selector) => {
		const groups = new Map();

		document.querySelectorAll(selector).forEach((button) => {
			if (!button.isConnected) return;
			const scope = findWatchOnStremioEpisodeScope(button);
			if (!scope) return;

			const key = button.dataset.stremioUrl || getCleanText(scope.textContent).match(/S\s*\d+\s*[•·.-]\s*E\s*\d+/i)?.[0] || "unknown";
			const groupKey = `${selector}::${key}::${Math.round(scope.getBoundingClientRect().top / 8)}::${Math.round(scope.getBoundingClientRect().left / 8)}`;

			if (!groups.has(groupKey)) groups.set(groupKey, []);
			groups.get(groupKey).push(button);
		});

		groups.forEach((buttons) => {
			if (buttons.length <= 1) return;
			const preferred = buttons.find((button) => button.dataset.stremioUrl) || buttons[0];
			buttons.forEach((button) => {
				if (button !== preferred) button.remove();
			});
		});
	});

	// 3) Nettoyage visuel : Trakt peut ré-render le panneau Seasons en créant deux
	// zones d'action différentes dans la même ligne. Les deux boutons n'ont alors
	// pas le même parent, mais ils sont côte à côte au même endroit.
	selectors.forEach((selector) => {
		const buttons = Array.from(document.querySelectorAll(selector))
			.filter((button) => button.isConnected)
			.map((button) => {
				const rect = button.getBoundingClientRect();
				return {
					button,
					rect,
					cx: rect.left + rect.width / 2,
					cy: rect.top + rect.height / 2,
				};
			})
			.filter((item) => item.rect.width > 0 && item.rect.height > 0)
			.sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx));

		const removed = new Set();

		buttons.forEach((item, index) => {
			if (removed.has(item.button)) return;

			const cluster = [item];

			for (let i = index + 1; i < buttons.length; i++) {
				const candidate = buttons[i];
				if (removed.has(candidate.button)) continue;

				const sameVisualRow = Math.abs(candidate.cy - item.cy) <= 24;
				const veryCloseHorizontally = Math.abs(candidate.cx - item.cx) <= 92;

				if (sameVisualRow && veryCloseHorizontally) {
					cluster.push(candidate);
				}
			}

			if (cluster.length <= 1) return;

			const preferred = cluster.find((entry) => entry.button.dataset.stremioUrl)?.button || cluster[0].button;
			cluster.forEach((entry) => {
				if (entry.button === preferred) return;
				removed.add(entry.button);
				entry.button.remove();
			});
		});
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

function removeLegacyStremioEpisodeButtons() {
	document.querySelectorAll(".watch-on-stremio-episode-btn, .watch-on-stremio-continue-btn, .watch-on-stremio-fallback-actions").forEach((element) => {
		element.remove();
	});

	document.querySelectorAll("[data-watch-on-stremio-episode-button], [data-watch-on-stremio-continue-button]").forEach((element) => {
		delete element.dataset.watchOnStremioEpisodeButton;
		delete element.dataset.watchOnStremioContinueButton;
	});
}

function setupWatchOnStremioEpisodeLinkClickHandler() {
	if (watchOnStremioEpisodeLinkClickReady) return;
	watchOnStremioEpisodeLinkClickReady = true;

	function handle(event) {
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

	removeLegacyStremioEpisodeButtons();

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

const traktV3ImdbCache = {};
const TRAKT_IMDB_CACHE_STORAGE_KEY = "watchOnStremio:traktImdbCache:v1";
let traktV3PersistentImdbCacheLoaded = false;

function loadTraktV3PersistentImdbCache() {
	if (traktV3PersistentImdbCacheLoaded) return;

	traktV3PersistentImdbCacheLoaded = true;

	try {
		const rawCache = window.localStorage.getItem(TRAKT_IMDB_CACHE_STORAGE_KEY);
		const parsedCache = rawCache ? JSON.parse(rawCache) : {};
		const now = Date.now();
		const maxAge = 1000 * 60 * 60 * 24 * 180; // 6 mois

		Object.entries(parsedCache).forEach(([showSlug, value]) => {
			if (!showSlug || !value) return;

			if (typeof value === "string") {
				traktV3ImdbCache[showSlug] = value;
				return;
			}

			if (value.imdbId && (!value.updatedAt || now - value.updatedAt < maxAge)) {
				traktV3ImdbCache[showSlug] = value.imdbId;
			}
		});
	} catch (error) {
		console.log("CineTrakt: IMDb cache load failed:", error);
	}
}

function saveTraktV3PersistentImdbCache() {
	try {
		const now = Date.now();
		const cacheToSave = {};

		Object.entries(traktV3ImdbCache).forEach(([showSlug, imdbId]) => {
			if (!showSlug || !imdbId) return;
			cacheToSave[showSlug] = { imdbId, updatedAt: now };
		});

		window.localStorage.setItem(TRAKT_IMDB_CACHE_STORAGE_KEY, JSON.stringify(cacheToSave));
	} catch (error) {
		console.log("CineTrakt: IMDb cache save failed:", error);
	}
}

function getCachedTraktImdbId(showSlug) {
	if (!showSlug) return "";
	loadTraktV3PersistentImdbCache();
	return traktV3ImdbCache[showSlug] || "";
}

function setCachedTraktImdbId(showSlug, imdbId) {
	if (!showSlug || !imdbId) return;

	loadTraktV3PersistentImdbCache();
	traktV3ImdbCache[showSlug] = imdbId;
	saveTraktV3PersistentImdbCache();
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

const traktV3HiddenIframePromises = {};

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

	if (traktV3HiddenIframePromises[showSlug]) {
		return traktV3HiddenIframePromises[showSlug];
	}

	traktV3HiddenIframePromises[showSlug] = new Promise((resolve) => {
		const iframe = document.createElement("iframe");
		let resolved = false;
		let tries = 0;
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

			if (imdbId) {
				setCachedTraktImdbId(showSlug, imdbId);
				console.log("CineTrakt: IMDb ID found with hidden Trakt page:", showSlug, imdbId);
			} else {
				console.log("CineTrakt: IMDb ID still missing after hidden Trakt page:", showSlug);
			}

			cleanIframe();
			resolve(imdbId || "");
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
			} catch (error) {
				console.log("CineTrakt: Hidden iframe not readable:", error);
			}

			if (tries >= maxTries) {
				finish("");
				return;
			}

			setTimeout(checkIframe, 250);
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
		iframe.setAttribute("aria-hidden", "true");

		iframe.addEventListener("load", function () {
			setTimeout(checkIframe, 250);
		});

		document.body.appendChild(iframe);

		setTimeout(checkIframe, 500);
	});

	return traktV3HiddenIframePromises[showSlug];
}

async function getImdbIdFromTraktShowUrl(showUrl) {
	const showSlug = getShowSlugFromTraktUrl(showUrl);

	if (!showSlug) return "";

	const cachedImdbId = getCachedTraktImdbId(showSlug);

	if (cachedImdbId) {
		return cachedImdbId;
	}

	try {
		const cleanShowUrl = `${window.location.origin}/shows/${showSlug}`;
		const response = await fetch(cleanShowUrl, {
			credentials: "include",
		});

		const html = await response.text();
		const imdbId = findImdbIdInHtml(html, showSlug);

		if (imdbId) {
			setCachedTraktImdbId(showSlug, imdbId);
			return imdbId;
		}

		console.log("CineTrakt: IMDb ID not found in fetch, trying hidden Trakt page:", cleanShowUrl);
	} catch (error) {
		console.log("CineTrakt: Fetch failed, trying hidden Trakt page:", error);
	}

	return await getImdbIdFromHiddenTraktIframe(showSlug);
}

function buildStremioEpisodeUrl(imdbId, season, episode) {
	const videoId = `${imdbId}:${season}:${episode}`;
	return `stremio:///detail/series/${imdbId}/${encodeURIComponent(videoId)}`;
}
function getCleanText(value) {
	return (value || "").replace(/\s+/g, " ").trim();
}

function getTitleFromContinueCard(card) {
	if (!card) return "";

	const candidates = [...card.querySelectorAll("a, h1, h2, h3, p, span, div")]
		.map((element) => getCleanText(element.textContent))
		.filter((text) => {
			if (!text) return false;
			if (/^S\s*\d+\s*[•·.-]\s*E\s*\d+/i.test(text)) return false;
			if (/^\d+\s*(m|min|h)/i.test(text)) return false;
			if (/premiere|left/i.test(text)) return false;
			return text.length >= 2 && text.length <= 80;
		});

	return candidates[0] || "";
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

function setContinueButtonLoadingState(button) {
	button.dataset.stremioUrl = "";
	setStremioButtonVisualReadyState(button, false);
}

function setContinueButtonReadyState(button, stremioUrl) {
	button.dataset.stremioUrl = stremioUrl;
	setStremioButtonVisualReadyState(button, true);
}

const continueButtonPrepareQueue = [];
let continueButtonPrepareQueueRunning = false;

function processContinueButtonPrepareQueue() {
	if (continueButtonPrepareQueueRunning) return;

	continueButtonPrepareQueueRunning = true;

	function next() {
		const button = continueButtonPrepareQueue.shift();

		if (!button) {
			continueButtonPrepareQueueRunning = false;
			return;
		}

		prepareContinueWatchingButtonUrl(button).finally(() => {
			setTimeout(next, 120);
		});
	}

	setTimeout(next, 0);
}

function queueContinueWatchingButtonPreparation(button) {
	if (!button || button.dataset.prepareQueued === "true" || button.dataset.prepareStarted === "true") return;

	const cachedImdbId = getCachedTraktImdbId(button.dataset.showSlug);

	if (cachedImdbId) {
		prepareContinueWatchingButtonUrl(button);
		return;
	}

	button.dataset.prepareQueued = "true";
	continueButtonPrepareQueue.push(button);
	processContinueButtonPrepareQueue();
}

async function prepareContinueWatchingButtonUrl(button) {
	if (!button || button.dataset.prepareStarted === "true") return;

	button.dataset.prepareStarted = "true";
	setContinueButtonLoadingState(button);

	const showUrl = button.dataset.showUrl;
	const season = button.dataset.season;
	const episode = button.dataset.episode;

	const imdbId = await getImdbIdFromTraktShowUrl(showUrl);

	if (!imdbId) {
		button.dataset.stremioUrl = "";
		setStremioButtonVisualReadyState(button, false);
		console.log("CineTrakt: IMDb ID missing, no broken search fallback used:", showUrl);
		return;
	}

	button.dataset.imdbId = imdbId;

	const stremioUrl = buildStremioEpisodeUrl(imdbId, season, episode);

	setContinueButtonReadyState(button, stremioUrl);

	console.log("CineTrakt: Continue Watching button ready:", stremioUrl);
}

function handleContinueWatchingButtonPress(button, event) {
	if (event && event.type === "pointerdown" && event.button !== 0) return;

	if (event) {
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
	}

	const stremioUrl = button.dataset.stremioUrl;

	if (!stremioUrl) {
		prepareContinueWatchingButtonUrl(button);
		console.log("CineTrakt: Continue link not ready yet, waiting for IMDb ID:", button.dataset.showUrl);
		return;
	}

	const now = Date.now();
	const lastOpen = parseInt(button.dataset.lastOpenTime || "0", 10);

	if (now - lastOpen < 800) return;

	button.dataset.lastOpenTime = String(now);

	console.log("CineTrakt: Opening Continue Watching episode:", stremioUrl);

	openStremioFromMouseEvent(stremioUrl, event);
}

let watchOnStremioContinueGlobalClickReady = false;

function setupContinueWatchingGlobalClickHandler() {
	if (watchOnStremioContinueGlobalClickReady) return;

	watchOnStremioContinueGlobalClickReady = true;

	document.addEventListener(
		"pointerdown",
		function (event) {
			const button = event.target.closest(".watch-on-stremio-continue-btn");

			if (!button) return;

			handleContinueWatchingButtonPress(button, event);
		},
		true,
	);

	document.addEventListener(
		"contextmenu",
		function (event) {
			const button = event.target.closest(".watch-on-stremio-continue-btn");

			if (!button) return;

			handleContinueWatchingButtonPress(button, event);
		},
		true,
	);

	document.addEventListener(
		"click",
		function (event) {
			const button = event.target.closest(".watch-on-stremio-continue-btn");

			if (!button) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
		},
		true,
	);

	console.log("CineTrakt: Continue Watching global click handler ready");
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
		if (!imdbId) return;
		const stremioUrl = buildStremioEpisodeUrl(imdbId, episodeData.season, episodeData.episode);
		makeSeasonEpisodeTargetsClickable(targets, episodeData, stremioUrl);
	}).catch((error) => {
		console.log("CineTrakt: episode text link prepare failed:", error);
	});
}

function linkifyContinueWatchingSeasonEpisodeTexts() {
	if (window.location.hostname !== "app.trakt.tv") return;
	if (!isContinueWatchingPage() && !getContinueWatchingVerticalRange()) return;

	removeLegacyStremioEpisodeButtons();

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

/*
	TRAKT V3 — colorisation des notes sur les fiches films / séries.
	On cible uniquement le bloc officiel des ratings Trakt :
	Trakt %, IMDb /10, Rotten Tomatoes %, PopcornMeter %, etc.
*/
const WATCH_ON_STREMIO_RATING_COLORS = {
	1:  { bg: "#ef4444", text: "#ffffff" },
	2:  { bg: "#ef4444", text: "#ffffff" },
	3:  { bg: "#ef4444", text: "#ffffff" },
	4:  { bg: "#f97316", text: "#ffffff" },
	5:  { bg: "#eab308", text: "#111111" },
	6:  { bg: "#22c55e", text: "#111111" },
	7:  { bg: "#3b82f6", text: "#ffffff" },
	8:  { bg: "#ec4899", text: "#ffffff" },
	9:  { bg: "#8b5cf6", text: "#ffffff" },
	10: { bg: "#ffffff", text: "#111111" },
};

function getWatchOnStremioRatingBucket(rating) {
	if (rating >= 10) return 10;
	if (rating >= 9) return 9;
	if (rating >= 8) return 8;
	if (rating >= 7) return 7;
	if (rating >= 6) return 6;
	if (rating >= 5) return 5;
	if (rating >= 4) return 4;
	if (rating >= 3) return 3;
	if (rating >= 2) return 2;
	return 1;
}

function getWatchOnStremioRatingColor(rating) {
	return WATCH_ON_STREMIO_RATING_COLORS[getWatchOnStremioRatingBucket(rating)] || WATCH_ON_STREMIO_RATING_COLORS[1];
}

function parseWatchOnStremioTraktRatingValue(text) {
	const raw = String(text || "").trim().replace(",", ".");
	const match = raw.match(/^(\d+(?:\.\d+)?)(\s*%)?/);
	if (!match) return NaN;

	const value = Number(match[1]);
	if (!Number.isFinite(value)) return NaN;

	// Trakt / Rotten Tomatoes / Popcorn sont en pourcentage.
	// IMDb est en /10. On ramène tout sur 10 pour utiliser la même palette.
	if (match[2]) {
		return Math.max(0, Math.min(10, value / 10));
	}

	return value >= 0 && value <= 10 ? value : NaN;
}

function colorizeWatchOnStremioTraktValue(valueElement) {
	if (!valueElement) return;

	const text = (valueElement.textContent || "").trim();
	const rating = parseWatchOnStremioTraktRatingValue(text);
	if (!Number.isFinite(rating)) return;

	const color = getWatchOnStremioRatingColor(rating).bg;

	valueElement.dataset.watchOnStremioRatingColored = "true";
	valueElement.style.setProperty("color", color, "important");
	valueElement.style.setProperty("text-decoration-color", color, "important");
	valueElement.style.setProperty("text-shadow", "none", "important");
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


function formatWatchOnStremioRatingValue(rating) {
	const number = Number(rating);
	if (!Number.isFinite(number)) return "";
	const fixed = number.toFixed(1);
	return fixed.endsWith(".0") ? String(Math.round(number)) : fixed;
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

	if (enabled) {
		starUnit.classList.add('wos-personal-star-colored');
	} else {
		starUnit.classList.remove('wos-personal-star-colored');
	}

	// Important pour les demi-étoiles Trakt :
	// on ne force jamais fill/stroke sur les <path>/<rect>.
	// Trakt gère déjà full / half / none avec data-star-fill + un clipPath.
	// On change seulement currentColor sur le wrapper, le bouton et le svg,
	// comme ça une demi-étoile reste vraiment une demi-étoile.
	const colorTargets = [starUnit, ...starUnit.querySelectorAll('button, svg')];
	const shapeTargets = starUnit.querySelectorAll('path, rect, use');

	colorTargets.forEach((element) => {
		if (enabled) {
			element.style.setProperty('color', color, 'important');
		} else {
			element.style.removeProperty('color');
		}
	});

	shapeTargets.forEach((element) => {
		// Nettoie les anciennes versions qui forçaient le remplissage complet.
		element.style.removeProperty('fill');
		element.style.removeProperty('stroke');
		element.style.removeProperty('color');
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

function getWatchOnStremioStarRatiosFromRating(rating10, starCount) {
	if (!Number.isFinite(rating10) || rating10 <= 0 || !starCount) return [];

	const starRating = Math.max(0, Math.min(starCount, rating10 / 2));

	return Array.from({ length: starCount }, (_, index) => {
		const remaining = starRating - index;
		if (remaining >= 1) return 1;
		if (remaining >= 0.5) return 0.5;
		return 0;
	});
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

		let rating10 = NaN;
		let effectiveRatios = ratios;

		if (starTotal <= 0) {
			rating10 = getWatchOnStremioPersonalRatingFromMetadata(rateNowBox, starsBox);
			effectiveRatios = getWatchOnStremioStarRatiosFromRating(rating10, starUnits.length);

			if (!Number.isFinite(rating10)) {
				label.classList.remove('wos-personal-rating-value');
				label.textContent = 'Rate';
				label.style.removeProperty('color');
				label.style.removeProperty('text-shadow');
				starUnits.forEach((starUnit) => setWatchOnStremioStarColor(starUnit, '', false));
				return;
			}
		} else {
			rating10 = Math.round(starTotal * 2 * 10) / 10;
		}

		const color = getWatchOnStremioRatingColor(rating10).bg;

		label.classList.add('wos-personal-rating-value');
		label.dataset.watchOnStremioPersonalRating = 'true';
		label.textContent = formatWatchOnStremioRatingValue(rating10);
		label.style.setProperty('color', color, 'important');
		label.style.setProperty('text-shadow', 'none', 'important');

		starUnits.forEach((starUnit, index) => {
			setWatchOnStremioStarColor(starUnit, color, effectiveRatios[index] > 0);
		});
	});
}



/*
	TRAKT V3 — bouton "plus de notes".
	Par défaut, sur une fiche film / série, on garde uniquement la note IMDb visible.
	Les autres notes Trakt / Rotten Tomatoes / Popcorn restent dans le DOM et reviennent au clic.
*/
function injectWatchOnStremioTraktMoreRatingsStyles() {
	if (document.getElementById('watch-on-stremio-trakt-more-ratings-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-trakt-more-ratings-styles';
	style.textContent = `
		.wos-trakt-rating-hidden {
			display: none !important;
		}

		.wos-trakt-ratings-toggle {
			appearance: none !important;
			border: 0 !important;
			background: transparent !important;
			color: #ffffff !important;
			width: 32px !important;
			height: 32px !important;
			border-radius: 10px !important;
			padding: 4px !important;
			margin: 0 0 0 6px !important;
			display: inline-flex !important;
			align-items: center !important;
			justify-content: center !important;
			cursor: pointer !important;
			line-height: 1 !important;
			flex: 0 0 auto !important;
			opacity: 1 !important;
			visibility: visible !important;
			transition: background-color 120ms ease, color 120ms ease !important;
		}

		.wos-trakt-ratings-toggle:hover {
			background: rgba(255, 255, 255, 0.14) !important;
		}

		.wos-trakt-ratings-toggle svg {
			width: 24px !important;
			height: 24px !important;
			display: block !important;
			pointer-events: none !important;
			color: #ffffff !important;
			fill: currentColor !important;
			stroke: none !important;
			opacity: 1 !important;
			visibility: visible !important;
			transform: rotate(0deg) !important;
			transition: transform 120ms ease !important;
		}

		.wos-trakt-ratings-toggle svg path {
			fill: #ffffff !important;
			stroke: none !important;
			opacity: 1 !important;
			visibility: visible !important;
		}

		.wos-trakt-ratings-toggle[data-expanded="true"] svg {
			transform: rotate(180deg) !important;
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
			border-radius: 0 !important;
			color: rgba(255, 255, 255, 0.52) !important;
			background: transparent !important;
			box-shadow: none !important;
			outline: none !important;
			cursor: pointer !important;
			transition: color 140ms ease !important;
		}

		.wos-imdb-ratings-popup-button:hover {
			color: rgba(255, 255, 255, 0.8) !important;
			background: transparent !important;
			border: 0 !important;
			box-shadow: none !important;
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
			transform: scale(1.1) !important;
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

	const img = ratingItem.querySelector('img[alt*="IMDb" i], svg[aria-label*="IMDb" i], [title*="IMDb" i]');
	return !!img;
}

function getWatchOnStremioTraktRatingItems(summaryRatings) {
	if (!summaryRatings) return [];

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

function openWatchOnStremioImdbRatingsPopup(imdbId) {
	if (!/^tt\d{7,}$/.test(imdbId) || !canUseExtensionRuntime()) return;

	try {
		chrome.runtime.sendMessage({
			type: 'CINETRAKT_OPEN_IMDB_RATINGS_POPUP',
			imdbId,
			screenBounds: getCurrentScreenBoundsForPopup(),
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

function createWatchOnStremioTraktRatingsToggle(summaryRatings) {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'wos-trakt-ratings-toggle';
	button.setAttribute('aria-label', 'Afficher les autres notes');
	button.setAttribute('title', 'Afficher les autres notes');
	button.innerHTML = `
		<svg viewBox="0 -960 960 960" width="24" height="24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
			<path d="M480-360 320-520h320L480-360Zm0 280q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"></path>
		</svg>
	`;

	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();

		const expanded = summaryRatings.dataset.watchOnStremioRatingsExpanded === 'true';
		summaryRatings.dataset.watchOnStremioRatingsExpanded = expanded ? 'false' : 'true';
		updateWatchOnStremioTraktRatingsVisibility(summaryRatings);
	});

	return button;
}

function updateWatchOnStremioTraktRatingsVisibility(summaryRatings) {
	if (!summaryRatings) return;

	const expanded = summaryRatings.dataset.watchOnStremioRatingsExpanded === 'true';
	const ratingItems = getWatchOnStremioTraktRatingItems(summaryRatings);
	const imdbItem = ratingItems.find(isWatchOnStremioImdbRatingItem);
	const toggle = summaryRatings.querySelector(':scope > .wos-trakt-ratings-toggle');

	ratingItems.forEach((item) => {
		if (item === imdbItem || expanded) {
			item.classList.remove('wos-trakt-rating-hidden');
		} else {
			item.classList.add('wos-trakt-rating-hidden');
		}
	});

	if (toggle) {
		toggle.dataset.expanded = expanded ? 'true' : 'false';
		toggle.setAttribute('aria-label', expanded ? 'Masquer les autres notes' : 'Afficher les autres notes');
		toggle.setAttribute('title', expanded ? 'Masquer les autres notes' : 'Afficher les autres notes');
	}
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

	// L'IMDb doit être à gauche. Les autres notes restent juste après le bouton quand on les affiche.
	if (summaryRatings.firstElementChild !== imdbItem) {
		summaryRatings.insertBefore(imdbItem, summaryRatings.firstElementChild);
	}

	let toggle = summaryRatings.querySelector(':scope > .wos-trakt-ratings-toggle');
	if (!ratingsToggleEnabled) {
		toggle?.remove();
		toggle = null;
	} else if (!toggle) {
		toggle = createWatchOnStremioTraktRatingsToggle(summaryRatings);
	}

	const isShowPage = /^\/shows\/[^/]+\/?$/.test(window.location.pathname);
	let popupButton = summaryRatings.querySelector(':scope > .wos-imdb-ratings-popup-button');
	const imdbId = isShowPage && ratingsPopupEnabled ? getWatchOnStremioImdbRatingsId(summaryRatings) : '';

	if (popupButton && (!imdbId || popupButton.dataset.imdbId !== imdbId)) {
		popupButton.remove();
		popupButton = null;
	}
	if (imdbId && !popupButton) {
		popupButton = createWatchOnStremioImdbRatingsPopupButton(imdbId);
	}

	if (popupButton) {
		if (popupButton.previousElementSibling !== imdbItem) {
			imdbItem.insertAdjacentElement('afterend', popupButton);
		}
		if (toggle && toggle.previousElementSibling !== popupButton) {
			popupButton.insertAdjacentElement('afterend', toggle);
		}
	} else if (toggle && toggle.previousElementSibling !== imdbItem) {
		imdbItem.insertAdjacentElement('afterend', toggle);
	}

	if (ratingsPopupEnabled && isShowPage && !imdbId
		&& summaryRatings.dataset.cinetraktImdbIdRequestedRoute !== window.location.pathname) {
		const route = window.location.pathname;
		summaryRatings.dataset.cinetraktImdbIdRequestedRoute = route;
		getImdbIdFromTraktShowUrl(window.location.href).then((resolvedImdbId) => {
			if (resolvedImdbId && window.location.pathname === route) scheduleRunStremioButtons(0);
		});
	}

	if (ratingsToggleEnabled && !summaryRatings.dataset.watchOnStremioRatingsExpanded) {
		summaryRatings.dataset.watchOnStremioRatingsExpanded = 'false';
	}

	if (ratingsToggleEnabled) {
		updateWatchOnStremioTraktRatingsVisibility(summaryRatings);
	} else {
		ratingItems.forEach((item) => item.classList.remove('wos-trakt-rating-hidden'));
	}
}

const CINETRAKT_STICKY_POSTER_RAIL_ID = 'cinetrakt-sticky-poster-rail';
let cinetraktStickyPosterState = null;
let cinetraktStickyPosterResizeTimer = null;

function injectWatchOnStremioPosterSizeStyles() {
	if (document.getElementById('watch-on-stremio-poster-size-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-poster-size-styles';
	style.textContent = `
		/* Colonne fixe CineTrakt : commandes et affiche restent visibles pendant que
		   le résumé et les sections suivantes défilent dans la partie droite. */
		.trakt-summary-container.watch-on-stremio-poster-size-ready,
		[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
			grid-template-columns:
				minmax(0, 1fr)
				minmax(220px, 320px) !important;
			width: 100% !important;
			max-width: 100% !important;
			margin-left: 0 !important;
			align-items: start !important;
		}

		html.cinetrakt-poster-layout-enabled,
		html.cinetrakt-poster-layout-enabled body {
			max-width: 100% !important;
			overflow-x: clip !important;
		}

		main.cinetrakt-sticky-poster-detail-page {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
			padding-left: var(--watch-on-stremio-sticky-content-left) !important;
			padding-right: 24px !important;
			overflow-x: clip !important;
		}

		main.cinetrakt-sticky-poster-detail-page > * {
			box-sizing: border-box !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		#${CINETRAKT_STICKY_POSTER_RAIL_ID} {
			box-sizing: border-box !important;
			position: fixed !important;
			left: var(--watch-on-stremio-sticky-poster-left) !important;
			top: var(--watch-on-stremio-sticky-poster-top) !important;
			width: var(--watch-on-stremio-summary-poster-width) !important;
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			gap: 8px !important;
			z-index: 20 !important;
			pointer-events: none !important;
		}

		#${CINETRAKT_STICKY_POSTER_RAIL_ID} > * {
			pointer-events: auto !important;
		}

		.cinetrakt-sticky-poster-controls {
			box-sizing: border-box !important;
			position: static !important;
			inset: auto !important;
			width: 100% !important;
			max-width: 100% !important;
			margin: 0 !important;
			display: flex !important;
			flex-direction: column !important;
			align-items: center !important;
			justify-content: center !important;
			gap: 6px !important;
		}

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized {
			width: var(--watch-on-stremio-summary-poster-width) !important;
			max-width: var(--watch-on-stremio-summary-poster-width) !important;
			height: var(--watch-on-stremio-summary-poster-height) !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			overflow: visible !important;
		}

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster-container,
		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster,
		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized .trakt-summary-poster > a {
			width: 100% !important;
			max-width: 100% !important;
			height: 100% !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			overflow: visible !important;
		}

		html.cinetrakt-poster-layout-enabled .watch-on-stremio-summary-poster-sized img {
			width: 100% !important;
			height: 100% !important;
			min-height: 0 !important;
			max-height: none !important;
			aspect-ratio: auto !important;
			object-fit: contain !important;
		}

		.watch-on-stremio-poster-size-ready .trakt-summary-content,
		.watch-on-stremio-poster-size-ready [class*="trakt-summary-content"] {
			grid-column: 1 !important;
			width: auto !important;
			min-width: 0 !important;
		}

		.watch-on-stremio-poster-size-ready .trakt-summary-contextual-content,
		.watch-on-stremio-poster-size-ready [class*="trakt-summary-contextual-content"] {
			grid-column: 2 !important;
			min-width: 0 !important;
		}

		main.cinetrakt-sticky-poster-detail-page .cinetrakt-sticky-right-section {
			box-sizing: border-box !important;
			margin: 0 0 0 -24px !important;
			width: calc(100% + 24px) !important;
			max-width: calc(100% + 24px) !important;
			min-width: 0 !important;
		}

		.cinetrakt-sticky-right-footer {
			box-sizing: border-box !important;
			margin-left: var(--watch-on-stremio-sticky-content-left) !important;
			width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 24px) !important;
			max-width: calc(100% - var(--watch-on-stremio-sticky-content-left) - 24px) !important;
			min-width: 0 !important;
			padding-left: 48px !important;
			padding-right: 24px !important;
		}

		.cinetrakt-sticky-right-footer .trakt-footer-content,
		.cinetrakt-sticky-right-footer .trakt-footer-grid {
			box-sizing: border-box !important;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		@media (max-width: 1000px) {
			.trakt-summary-container.watch-on-stremio-poster-size-ready,
			[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
				grid-template-columns: minmax(0, 1fr) !important;
			}

			.watch-on-stremio-poster-size-ready .trakt-summary-contextual-content,
			.watch-on-stremio-poster-size-ready [class*="trakt-summary-contextual-content"] {
				grid-column: 1 !important;
			}
		}
	`;
	document.head.appendChild(style);
}

function findCinetraktStickyPosterControls(summaryContainer) {
	const mainContent = summaryContainer.querySelector('.trakt-summary-main-content');
	if (!mainContent) return null;

	const actionsBar = summaryContainer.querySelector('.trakt-summary-actions-bar');
	if (actionsBar) {
		const actionsGroup = actionsBar.closest('.trakt-summary-actions');
		return actionsGroup
			&& actionsGroup !== summaryContainer
			&& summaryContainer.contains(actionsGroup)
			? actionsGroup
			: actionsBar;
	}

	// Compatibilité avec une ancienne structure Trakt dépourvue de barre nommée.
	const rateNow = summaryContainer.querySelector('.trakt-rate-now, [class*="trakt-rate-now"]');
	if (!rateNow) return null;

	for (let candidate = rateNow.parentElement;
		candidate && candidate !== mainContent;
		candidate = candidate.parentElement) {
		const rect = candidate.getBoundingClientRect();
		const hasSeparateAction = [...candidate.querySelectorAll('button, a, [role="button"]')]
			.some((element) => !rateNow.contains(element));
		if (hasSeparateAction && rect.height > 0 && rect.height <= 220) return candidate;
	}

	return rateNow;
}

function moveCinetraktElementWithPlaceholder(element, placeholderText) {
	if (!element?.parentNode) return null;
	const placeholder = document.createComment(placeholderText);
	const parent = element.parentNode;
	parent.insertBefore(placeholder, element);
	return { element, parent, placeholder };
}

function restoreCinetraktMovedElement(entry) {
	if (!entry?.element) return;
	if (entry.placeholder?.parentNode) {
		entry.placeholder.parentNode.insertBefore(entry.element, entry.placeholder);
		entry.placeholder.remove();
	} else if (entry.parent?.isConnected) {
		entry.parent.appendChild(entry.element);
	}
}

function attachCinetraktStickyPosterControls(state) {
	const attachedControls = state.controlsEntry?.element;
	if (attachedControls?.isConnected) {
		attachedControls.classList.add('cinetrakt-sticky-poster-controls');
		if (!state.rail.contains(attachedControls)) {
			state.rail.insertBefore(attachedControls, state.posterContainer);
		}
		return;
	}
	if (state.controlsEntry) {
		state.controlsEntry.placeholder?.remove();
		state.controlsEntry = null;
	}

	const controls = findCinetraktStickyPosterControls(state.summaryContainer);
	if (!controls || state.rail.contains(controls)) return;

	state.controlsEntry = moveCinetraktElementWithPlaceholder(
		controls,
		'CineTrakt sticky poster controls position',
	);
	controls.classList.add('cinetrakt-sticky-poster-controls');
	state.rail.insertBefore(controls, state.posterContainer);
}

function markCinetraktResponsiveRightContent(state) {
	state.sectionElements ||= new Set();
	state.mainContent.querySelectorAll('section.section-list-container').forEach((section) => {
		if (section.closest('.trakt-summary-container')) return;
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});
	state.mainContent.querySelectorAll('section.trakt-soundtrack-section').forEach((section) => {
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});

	const specialSectionTitles = new Set(['soundtrack', 'bande originale', 'trivia', 'anecdotes']);
	state.mainContent.querySelectorAll(
		'h1, h2, h3, h4, .trakt-list-title, .trakt-list-inset-title, [class*="section-title"]',
	).forEach((title) => {
		if (!specialSectionTitles.has(title.textContent?.trim().toLowerCase())) return;
		const titleRect = title.getBoundingClientRect();
		let section = title.closest('section');
		for (let element = title.parentElement;
			!section && element && element !== state.mainContent;
			element = element.parentElement) {
			const rect = element.getBoundingClientRect();
			const inset = titleRect.left - rect.left;
			if (rect.width > 0 && inset >= 20 && inset <= 28) section = element;
		}
		if (!section || section.closest('.trakt-summary-container')) return;
		section.classList.add('cinetrakt-sticky-right-section');
		state.sectionElements.add(section);
	});
	const footer = document.querySelector('footer, [role="contentinfo"]');
	if (footer) {
		state.footer = footer;
		footer.classList.add('cinetrakt-sticky-right-footer');
	}
}

function scheduleCinetraktStickyPosterLayoutUpdate(delay = 80) {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = window.setTimeout(() => {
		cinetraktStickyPosterResizeTimer = null;
		if (cinetraktStickyPosterState) {
			updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
		}
	}, delay);
}

function applyCinetraktStickyPosterDimensions(state, width, height) {
	const {
		summaryContainer,
		posterContainer,
		mainContent,
		summaryLeft,
	} = state;
	const contentLeft = summaryLeft + width + 32;

	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${width}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-height', `${height}px`);
	mainContent.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
	state.footer?.style.setProperty('--watch-on-stremio-sticky-content-left', `${contentLeft}px`);
}

function getCinetraktVisibleViewportBottom() {
	if (window.visualViewport) {
		return window.visualViewport.offsetTop + window.visualViewport.height;
	}
	return Math.min(
		document.documentElement.clientHeight || Number.POSITIVE_INFINITY,
		window.innerHeight || Number.POSITIVE_INFINITY,
	);
}

function scheduleCinetraktStickyPosterBoundsCorrection(state, imageRatio, bottomSafety) {
	window.cancelAnimationFrame(state.boundsCorrectionFrame);
	state.boundsCorrectionFrame = window.requestAnimationFrame(() => {
		state.boundsCorrectionFrame = null;
		if (state !== cinetraktStickyPosterState || !state.posterContainer.isConnected) return;

		const posterRect = state.posterContainer.getBoundingClientRect();
		let decorationOverflow = 0;
		state.posterContainer.querySelectorAll('*')
			.forEach((element) => {
				const rect = element.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				decorationOverflow = Math.max(decorationOverflow, rect.bottom - posterRect.bottom);
			});
		state.posterDecorationOverflow = Math.max(0, decorationOverflow);
		const targetPosterBottom = getCinetraktVisibleViewportBottom()
			- bottomSafety
			- state.posterDecorationOverflow;
		const correctedHeight = Math.floor(targetPosterBottom - posterRect.top);
		if (correctedHeight <= 0 || Math.abs(correctedHeight - posterRect.height) < 0.5) return;

		const correctedWidth = Math.max(1, Math.floor(correctedHeight * imageRatio));
		applyCinetraktStickyPosterDimensions(state, correctedWidth, correctedHeight);
	});
}

function updateCinetraktStickyPosterLayout(state) {
	const { summaryContainer, posterContainer, posterImage, rail, mainContent } = state;
	if (!summaryContainer.isConnected || !posterContainer.isConnected || !rail.isConnected) return;

	attachCinetraktStickyPosterControls(state);
	markCinetraktResponsiveRightContent(state);
	if (!posterImage.complete || !posterImage.naturalWidth || !posterImage.naturalHeight) {
		const pendingSource = posterImage.currentSrc || posterImage.src || window.location.pathname;
		if (posterImage.dataset.watchOnStremioPosterLoadSource !== pendingSource) {
			posterImage.dataset.watchOnStremioPosterLoadSource = pendingSource;
			posterImage.addEventListener('load', () => scheduleCinetraktStickyPosterLayoutUpdate(0), { once: true });
		}
		return;
	}

	const viewportHeights = [
		document.documentElement.clientHeight,
		window.innerHeight,
		window.visualViewport?.height,
	].filter((value) => Number.isFinite(value) && value > 0);
	const viewportHeight = Math.floor(viewportHeights.length
		? Math.min(...viewportHeights)
		: window.innerHeight);
	const imageRatio = posterImage.naturalWidth / posterImage.naturalHeight;
	const summaryRect = summaryContainer.getBoundingClientRect();
	const sidebarRect = document.querySelector('.trakt-side-navbar')?.getBoundingClientRect();
	const configuredSideGap = Number.parseFloat(
		getComputedStyle(document.documentElement).getPropertyValue('--layout-distance-side'),
	);
	const sidebarGap = Number.isFinite(configuredSideGap) ? configuredSideGap : 24;
	const summaryLeft = sidebarRect?.width > 0
		? Math.max(0, Math.round(sidebarRect.right + sidebarGap))
		: state.summaryLeft;
	if (window.scrollY < 2) state.posterTop = Math.max(0, summaryRect.top + 38);
	state.summaryLeft = summaryLeft;
	const posterTop = state.posterTop;
	const controlsHeight = state.controlsEntry?.element?.getBoundingClientRect().height || 0;
	const controlsGap = controlsHeight > 0 ? 8 : 0;
	const railTop = Math.max(8, posterTop - controlsHeight - controlsGap);
	const posterBottomSafety = 24;
	const availableHeight = Math.max(
		1,
		viewportHeight - posterTop - posterBottomSafety - state.posterDecorationOverflow,
	);
	const finalHeight = Math.floor(availableHeight);
	const finalWidth = Math.max(1, Math.floor(finalHeight * imageRatio));

	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-left', `${summaryLeft}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-sticky-poster-top', `${railTop}px`);
	applyCinetraktStickyPosterDimensions(state, finalWidth, finalHeight);
	scheduleCinetraktStickyPosterBoundsCorrection(state, imageRatio, posterBottomSafety);
}

function setupWatchOnStremioPosterSize() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname)) return;
	const routeKey = window.location.pathname;

	if (cinetraktStickyPosterState
		&& (cinetraktStickyPosterState.routeKey !== routeKey
			|| !cinetraktStickyPosterState.summaryContainer?.isConnected
			|| !cinetraktStickyPosterState.rail?.isConnected)) {
		cleanupWatchOnStremioPosterSize();
	}
	if (cinetraktStickyPosterState) {
		updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
		return;
	}

	const summaryContainer = document.querySelector('.trakt-summary-container')
		|| document.querySelector('[class*="trakt-summary-container"]');
	const posterContainer = summaryContainer?.querySelector('.trakt-summary-poster-container')
		|| summaryContainer?.querySelector('[class*="trakt-summary-poster-container"]');
	const posterImage = posterContainer?.querySelector('img');
	const mainContent = summaryContainer?.closest('main.trakt-content, main');

	if (!summaryContainer || !posterContainer || !posterImage || !mainContent) return;

	injectWatchOnStremioPosterSizeStyles();

	// Nettoyage des essais précédents, au cas où une ancienne version a laissé des classes/styles.
	summaryContainer.classList.remove('watch-on-stremio-summary-layout-ready', 'watch-on-stremio-large-poster-page');
	posterContainer.classList.remove('watch-on-stremio-poster-size-target', 'watch-on-stremio-poster-tilt-card');
	for (const property of ['transform', 'filter', 'box-shadow', 'transition', 'will-change', 'perspective', 'transform-origin', 'z-index']) {
		posterContainer.style.removeProperty(property);
	}

	const originalPosterRect = posterContainer.getBoundingClientRect();
	const posterEntry = moveCinetraktElementWithPlaceholder(
		posterContainer,
		'CineTrakt sticky poster position',
	);
	const rail = document.createElement('div');
	rail.id = CINETRAKT_STICKY_POSTER_RAIL_ID;
	summaryContainer.prepend(rail);
	rail.appendChild(posterContainer);
	summaryContainer.classList.add('watch-on-stremio-poster-size-ready');
	posterContainer.classList.add('watch-on-stremio-summary-poster-sized');
	mainContent.classList.add('cinetrakt-sticky-poster-detail-page');

	cinetraktStickyPosterState = {
		routeKey,
		summaryContainer,
		posterContainer,
		posterImage,
		posterEntry,
		controlsEntry: null,
		rail,
		mainContent,
		sectionElements: new Set(),
		footer: null,
		boundsCorrectionFrame: null,
		posterDecorationOverflow: 0,
		summaryLeft: Math.max(0, originalPosterRect.left),
		posterTop: Math.max(0, originalPosterRect.top),
	};
	updateCinetraktStickyPosterLayout(cinetraktStickyPosterState);
}

function cleanupWatchOnStremioPosterSize() {
	window.clearTimeout(cinetraktStickyPosterResizeTimer);
	cinetraktStickyPosterResizeTimer = null;
	document.documentElement.classList.remove('cinetrakt-poster-layout-enabled');
	const state = cinetraktStickyPosterState;
	window.cancelAnimationFrame(state?.boundsCorrectionFrame);
	const summaryContainer = state?.summaryContainer
		|| document.querySelector('.watch-on-stremio-poster-size-ready');
	const posterContainer = state?.posterContainer
		|| document.querySelector('.watch-on-stremio-summary-poster-sized');

	state?.controlsEntry?.element?.classList.remove('cinetrakt-sticky-poster-controls');
	restoreCinetraktMovedElement(state?.controlsEntry);
	restoreCinetraktMovedElement(state?.posterEntry);
	state?.rail?.remove();
	state?.mainContent?.classList.remove('cinetrakt-sticky-poster-detail-page');
	state?.mainContent?.style.removeProperty('--watch-on-stremio-sticky-content-left');
	state?.sectionElements?.forEach((section) => {
		section.classList.remove('cinetrakt-sticky-right-section');
	});
	state?.footer?.classList.remove('cinetrakt-sticky-right-footer');
	state?.footer?.style.removeProperty('--watch-on-stremio-sticky-content-left');
	summaryContainer?.classList.remove('watch-on-stremio-poster-size-ready');
	posterContainer?.classList.remove('watch-on-stremio-summary-poster-sized');
	for (const element of [summaryContainer, posterContainer]) {
		if (!element) continue;
		for (const property of [
			'--watch-on-stremio-summary-poster-width',
			'--watch-on-stremio-summary-poster-height',
			'--watch-on-stremio-sticky-poster-left',
			'--watch-on-stremio-sticky-poster-top',
		]) {
			element.style.removeProperty(property);
		}
	}
	cinetraktStickyPosterState = null;
}

/* Soundtrack autoplay and the compact control next to the Trakt logo. */
const CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS = 4;
const CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY = 1300;
const CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT = 30000;
const cinetraktReadySpotifyEmbeds = new WeakSet();
const cinetraktSoundtrackState = {
	routeKey: '',
	status: 'idle',
	discoveryDeadline: 0,
	autoplayAttempted: false,
	autoplaySettled: false,
	autoplayAttemptCount: 0,
	autoplayClickedControl: null,
	selectedTrackKey: '',
	selectedControl: null,
	section: null,
	card: null,
	coverButton: null,
	coverImage: null,
	titleElement: null,
	artistElement: null,
	cardReady: false,
	playbackState: 'paused',
	displayedTrackKey: '',
	displayedCoverUrl: '',
	metadataRequestId: 0,
	soundtrackObserver: null,
	syncTimer: null,
	autoplayTimer: null,
	settleTimer: null,
};

function getCinetraktSoundtrackRouteKey() {
	const match = window.location.pathname.match(/^\/(movies|shows)\/([^/]+)\/?$/);
	return match ? `/${match[1]}/${match[2]}` : '';
}

function findCinetraktSoundtrackSummarySection() {
	return Array.from(document.querySelectorAll('section.trakt-soundtrack-section'))
		.find((section) => !section.closest('.trakt-drawer, .trakt-soundtrack-upsell')) || null;
}

function getCinetraktSoundtrackTrackKey(row) {
	const position = row.querySelector('.row-position')?.textContent?.trim() || '';
	const title = row.querySelector('.row-title')?.textContent?.trim() || '';
	const performer = row.querySelector('.row-performer')?.textContent?.trim() || '';
	return title ? `${position}|${title}|${performer}` : '';
}

function findCinetraktSoundtrackNativeControl(row) {
	if (!row || row.closest('.trakt-soundtrack-upsell') || row.querySelector('.row-unmatched')) return null;

	const control = row.querySelector('button.row-action[type="button"]')
		|| Array.from(row.querySelectorAll('button[type="button"][aria-label]')).find((button) => {
			return /play|pause|ecouter|mettre en pause/i.test(button.getAttribute('aria-label') || '');
		});

	if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return null;
	return control;
}

function isCinetraktSoundtrackControlPlaying(control) {
	if (!control?.isConnected) return false;
	const label = (control.getAttribute('aria-label') || '').trim();
	if (/pause|mettre en pause|pausar|pausieren|pauze|suspend/i.test(label)) return true;
	return !!control.querySelector('svg path[d^="M560-200"]');
}

function createCinetraktSoundtrackTrack(row, fallbackIndex) {
	const control = findCinetraktSoundtrackNativeControl(row);
	const key = getCinetraktSoundtrackTrackKey(row);
	if (!control || !key) return null;

	return {
		index: Number.parseInt(row.querySelector('.row-position')?.textContent || '', 10) || fallbackIndex,
		key,
		title: row.querySelector('.row-title')?.textContent?.trim() || '',
		artist: row.querySelector('.row-performer')?.textContent?.trim() || '',
		row,
		control,
	};
}

function collectCinetraktPlayableSummaryTracks(section = cinetraktSoundtrackState.section) {
	if (!section?.isConnected) return [];

	const tracks = [];
	const seenKeys = new Set();
	for (const row of section.querySelectorAll('.trakt-soundtrack-row')) {
		if (row.hidden || row.getAttribute('aria-hidden') === 'true' || row.getClientRects().length === 0) continue;
		const track = createCinetraktSoundtrackTrack(row, tracks.length + 1);
		if (!track || seenKeys.has(track.key)) continue;
		seenKeys.add(track.key);
		tracks.push(track);
	}
	return tracks;
}

function collectCinetraktControllableSoundtrackTracks() {
	const tracks = [];
	const seenControls = new Set();
	for (const row of document.querySelectorAll('.trakt-soundtrack-row')) {
		const track = createCinetraktSoundtrackTrack(row, tracks.length + 1);
		if (!track || seenControls.has(track.control)) continue;
		seenControls.add(track.control);
		tracks.push(track);
	}
	return tracks;
}

function findCinetraktActiveSoundtrackTrack(tracks = collectCinetraktControllableSoundtrackTracks()) {
	return tracks.find((track) => isCinetraktSoundtrackControlPlaying(track.control))
		|| tracks.find((track) => track.row.classList.contains('is-playing'))
		|| null;
}

function injectCinetraktSoundtrackCardStyles() {
	if (document.getElementById('cinetrakt-soundtrack-card-style')) return;

	const style = document.createElement('style');
	style.id = 'cinetrakt-soundtrack-card-style';
	style.textContent = `
		.trakt-side-navbar.cinetrakt-soundtrack-card-mounted {
			justify-content: flex-start !important;
		}

		.trakt-side-navbar.cinetrakt-soundtrack-card-mounted > .trakt-side-navbar-bottom {
			margin-top: auto;
		}

		.cinetrakt-soundtrack-card {
			box-sizing: border-box;
			color: rgba(255, 255, 255, 0.92);
			flex: 0 0 auto;
			margin: 0 8px;
			min-width: 0;
			width: calc(100% - 16px);
		}

		.cinetrakt-soundtrack-card[hidden] {
			display: none !important;
		}

		.cinetrakt-soundtrack-cover-button {
			aspect-ratio: 1;
			background: rgba(255, 255, 255, 0.06);
			border: 0;
			border-radius: 6px;
			box-shadow: none;
			cursor: pointer;
			display: block;
			overflow: hidden;
			padding: 0;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button:focus-visible {
			outline: 2px solid var(--purple-500, #8b5cf6);
			outline-offset: 2px;
		}

		.cinetrakt-soundtrack-cover {
			display: block;
			height: 100%;
			object-fit: cover;
			opacity: 1;
			transition: opacity 120ms ease;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button:hover .cinetrakt-soundtrack-cover {
			opacity: 0.86;
		}

		.cinetrakt-soundtrack-title,
		.cinetrakt-soundtrack-artist {
			display: -webkit-box;
			overflow: hidden;
			padding: 0 2px;
			text-overflow: ellipsis;
			-webkit-box-orient: vertical;
		}

		.cinetrakt-soundtrack-title {
			font-size: 14px;
			font-weight: 700;
			line-height: 1.3;
			margin: 9px 0 0;
			-webkit-line-clamp: 2;
		}

		.cinetrakt-soundtrack-artist {
			color: rgba(255, 255, 255, 0.62);
			font-size: 12px;
			font-weight: 400;
			line-height: 1.35;
			margin: 3px 0 0;
			-webkit-line-clamp: 1;
		}
	`;
	document.head.appendChild(style);
}

function createCinetraktSoundtrackCard() {
	const card = document.createElement('div');
	card.className = 'cinetrakt-soundtrack-card';
	card.hidden = true;

	const coverButton = document.createElement('button');
	coverButton.type = 'button';
	coverButton.className = 'cinetrakt-soundtrack-cover-button';
	coverButton.setAttribute('aria-label', 'Play soundtrack');
	coverButton.setAttribute('aria-pressed', 'false');
	coverButton.title = 'Play soundtrack';

	const coverImage = document.createElement('img');
	coverImage.className = 'cinetrakt-soundtrack-cover';
	coverImage.alt = '';
	coverImage.draggable = false;
	coverButton.appendChild(coverImage);

	const titleElement = document.createElement('p');
	titleElement.className = 'cinetrakt-soundtrack-title';
	const artistElement = document.createElement('p');
	artistElement.className = 'cinetrakt-soundtrack-artist';

	card.append(coverButton, titleElement, artistElement);
	coverButton.addEventListener('click', toggleCinetraktSoundtrackPlayback);
	Object.assign(cinetraktSoundtrackState, { card, coverButton, coverImage, titleElement, artistElement });
	return card;
}

function ensureCinetraktSoundtrackCardPlacement() {
	const sidebar = document.querySelector('.trakt-side-navbar');
	const top = sidebar?.querySelector(':scope > .trakt-side-navbar-top');
	const content = sidebar?.querySelector(':scope > .trakt-side-navbar-content');
	if (!sidebar || !top || !content) return null;

	if (!cinetraktSoundtrackState.card) {
		injectCinetraktSoundtrackCardStyles();
		createCinetraktSoundtrackCard();
	}

	for (const duplicate of document.querySelectorAll('.cinetrakt-soundtrack-card')) {
		if (duplicate !== cinetraktSoundtrackState.card) duplicate.remove();
	}
	if (cinetraktSoundtrackState.card.parentElement !== sidebar
		|| cinetraktSoundtrackState.card.previousElementSibling !== top) {
		sidebar.insertBefore(cinetraktSoundtrackState.card, content);
	}

	const visible = cinetraktSoundtrackState.cardReady && top.classList.contains('is-expanded');
	sidebar.classList.toggle('cinetrakt-soundtrack-card-mounted', visible);
	cinetraktSoundtrackState.card.hidden = !visible;
	return cinetraktSoundtrackState.card;
}

function updateCinetraktSoundtrackPlaybackState(nextState) {
	if (nextState === cinetraktSoundtrackState.playbackState) return;
	cinetraktSoundtrackState.playbackState = nextState;
	const playing = nextState === 'playing';
	const label = playing ? 'Pause soundtrack' : 'Play soundtrack';
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-label', label);
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-pressed', playing ? 'true' : 'false');
	if (cinetraktSoundtrackState.coverButton) cinetraktSoundtrackState.coverButton.title = label;
}

function normalizeCinetraktSpotifyEntityUrl(value) {
	if (!value) return '';
	try {
		const url = new URL(value, window.location.href);
		const pathMatch = url.pathname.match(/^\/(?:embed\/)?(track|episode|album)\/([A-Za-z0-9]+)/);
		if (pathMatch) return `https://open.spotify.com/${pathMatch[1]}/${pathMatch[2]}`;

		const uriMatch = (url.searchParams.get('uri') || '').match(/^spotify:(track|episode|album):([A-Za-z0-9]+)$/);
		return uriMatch ? `https://open.spotify.com/${uriMatch[1]}/${uriMatch[2]}` : '';
	} catch (_error) {
		return '';
	}
}

function preloadCinetraktSoundtrackCover(url) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(url);
		image.onerror = reject;
		image.src = url;
	});
}

function isCinetraktSpotifyCoverUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:'
			&& (url.hostname === 'i.scdn.co' || url.hostname.endsWith('.spotifycdn.com'));
	} catch (_error) {
		return false;
	}
}

async function applyCinetraktSpotifyEmbedMetadata(track, metadata) {
	const coverUrl = typeof metadata.coverUrl === 'string' ? metadata.coverUrl : '';
	const title = typeof metadata.title === 'string' ? metadata.title.trim().slice(0, 300) : '';
	const artist = typeof metadata.artist === 'string' ? metadata.artist.trim().slice(0, 300) : '';
	if (!track || !isCinetraktSpotifyCoverUrl(coverUrl) || !title || !artist) return;
	if (track.key === cinetraktSoundtrackState.displayedTrackKey
		&& coverUrl === cinetraktSoundtrackState.displayedCoverUrl) return;

	const requestId = ++cinetraktSoundtrackState.metadataRequestId;
	try {
		await preloadCinetraktSoundtrackCover(coverUrl);
		if (requestId !== cinetraktSoundtrackState.metadataRequestId
			|| track.key !== cinetraktSoundtrackState.selectedTrackKey
			|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()) return;

		cinetraktSoundtrackState.coverImage.src = coverUrl;
		cinetraktSoundtrackState.titleElement.textContent = title;
		cinetraktSoundtrackState.artistElement.textContent = artist;
		cinetraktSoundtrackState.displayedTrackKey = track.key;
		cinetraktSoundtrackState.displayedCoverUrl = coverUrl;
		cinetraktSoundtrackState.cardReady = true;
		ensureCinetraktSoundtrackCardPlacement();
		if (isCinetraktFeatureEnabled('traktSoundtrackAutoplay')
			&& !cinetraktSoundtrackState.autoplaySettled) {
			scheduleCinetraktSoundtrackAutoplayAttempt(80);
		}
	} catch (_error) {
		// Keep the card hidden rather than showing metadata that does not match the iframe.
	}
}

function handleCinetraktSpotifyEmbedMessage(event) {
	if (event.origin !== 'https://open.spotify.com'
		|| ![
			'cinetrakt:spotify-embed-ready',
			'cinetrakt:spotify-embed-metadata',
			'cinetrakt:spotify-embed-playback-state',
		].includes(event.data?.type)) return;

	const iframe = Array.from(document.querySelectorAll('iframe[src*="open.spotify.com/embed/"]'))
		.find((candidate) => candidate.contentWindow === event.source);
	if (!iframe) return;
	cinetraktReadySpotifyEmbeds.add(iframe);
	if (event.data.type === 'cinetrakt:spotify-embed-ready') {
		scheduleCinetraktSoundtrackSync(0);
		if (isCinetraktFeatureEnabled('traktSoundtrackAutoplay')) {
			scheduleCinetraktSoundtrackAutoplayAttempt(0);
		}
		return;
	}

	const track = resolveCinetraktSoundtrackControl();
	const soundtrackScope = track?.row.closest('section.trakt-soundtrack-section');
	if (!track || !soundtrackScope?.contains(iframe)) return;

	if (event.data.playbackState === 'playing') {
		completeCinetraktSoundtrackAutoplay('playing');
	} else if (event.data.playbackState === 'paused') {
		updateCinetraktSoundtrackPlaybackState('paused');
	}
	if (event.data.type === 'cinetrakt:spotify-embed-playback-state') return;

	const iframeEntityUrl = normalizeCinetraktSpotifyEntityUrl(iframe.src || iframe.getAttribute('src') || '');
	const messageEntityUrl = normalizeCinetraktSpotifyEntityUrl(event.data.embedUrl);
	if (iframeEntityUrl && messageEntityUrl && iframeEntityUrl !== messageEntityUrl) return;
	applyCinetraktSpotifyEmbedMetadata(track, event.data);
}

function clearCinetraktSoundtrackTimer(name) {
	if (cinetraktSoundtrackState[name] == null) return;
	window.clearTimeout(cinetraktSoundtrackState[name]);
	cinetraktSoundtrackState[name] = null;
}

function scheduleCinetraktSoundtrackSync(delay = 60) {
	clearCinetraktSoundtrackTimer('syncTimer');
	cinetraktSoundtrackState.syncTimer = window.setTimeout(() => {
		cinetraktSoundtrackState.syncTimer = null;
		syncCinetraktSoundtrackState();
	}, delay);
}

function scheduleCinetraktSoundtrackAutoplayAttempt(delay = CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY) {
	if (cinetraktSoundtrackState.autoplaySettled || cinetraktSoundtrackState.autoplayTimer != null) return;
	cinetraktSoundtrackState.autoplayTimer = window.setTimeout(() => {
		cinetraktSoundtrackState.autoplayTimer = null;
		if (cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()) {
			attemptCinetraktSoundtrackAutoplay();
		}
	}, delay);
}

function requestCinetraktSpotifyEmbedPlayback(track) {
	const section = track?.row.closest('section.trakt-soundtrack-section');
	const iframe = section?.querySelector('iframe[src*="open.spotify.com/embed/"]');
	if (!iframe?.contentWindow) return false;

	const allowedFeatures = new Set((iframe.getAttribute('allow') || '').split(';').map((value) => value.trim()).filter(Boolean));
	allowedFeatures.add('autoplay');
	iframe.setAttribute('allow', [...allowedFeatures].join('; '));
	if (!cinetraktReadySpotifyEmbeds.has(iframe)) return true;

	iframe.contentWindow.postMessage({ type: 'cinetrakt:spotify-embed-play' }, 'https://open.spotify.com');
	return true;
}

function observeCinetraktSoundtrackSection(section) {
	if (cinetraktSoundtrackState.section === section && cinetraktSoundtrackState.soundtrackObserver) return;
	cinetraktSoundtrackState.soundtrackObserver?.disconnect();
	cinetraktSoundtrackState.section = section;
	cinetraktSoundtrackState.soundtrackObserver = new MutationObserver(() => scheduleCinetraktSoundtrackSync());
	cinetraktSoundtrackState.soundtrackObserver.observe(section, {
		attributes: true,
		attributeFilter: ['aria-label', 'class', 'disabled', 'src', 'title'],
		childList: true,
		subtree: true,
	});
}

function resolveCinetraktSoundtrackControl() {
	const tracks = collectCinetraktControllableSoundtrackTracks();
	const activeTrack = findCinetraktActiveSoundtrackTrack(tracks);
	if (activeTrack) {
		cinetraktSoundtrackState.selectedTrackKey = activeTrack.key;
		cinetraktSoundtrackState.selectedControl = activeTrack.control;
		return activeTrack;
	}

	const selectedTrack = tracks.find((track) => track.key === cinetraktSoundtrackState.selectedTrackKey) || null;
	if (selectedTrack) cinetraktSoundtrackState.selectedControl = selectedTrack.control;
	return selectedTrack;
}

function syncCinetraktSoundtrackState() {
	if (!cinetraktSoundtrackState.routeKey
		|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()) return;

	const section = findCinetraktSoundtrackSummarySection();
	if (!section) return;
	observeCinetraktSoundtrackSection(section);
	ensureCinetraktSoundtrackCardPlacement();

	const track = resolveCinetraktSoundtrackControl();
	if (!track) return;
	if (track.key !== cinetraktSoundtrackState.displayedTrackKey) {
		cinetraktSoundtrackState.cardReady = false;
		ensureCinetraktSoundtrackCardPlacement();
	}
	if (!cinetraktSoundtrackState.autoplaySettled) {
		if (isCinetraktSoundtrackControlPlaying(track.control)) {
			completeCinetraktSoundtrackAutoplay('playing');
		}
		return;
	}
	const nextState = isCinetraktSoundtrackControlPlaying(track.control) ? 'playing' : 'paused';
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function completeCinetraktSoundtrackAutoplay(playbackState = '') {
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('settleTimer');
	cinetraktSoundtrackState.autoplayAttempted = true;
	cinetraktSoundtrackState.autoplaySettled = true;
	const track = resolveCinetraktSoundtrackControl();
	const nextState = playbackState || (track && isCinetraktSoundtrackControlPlaying(track.control) ? 'playing' : 'paused');
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function attemptCinetraktSoundtrackAutoplay() {
	if (cinetraktSoundtrackState.autoplaySettled) return;
	cinetraktSoundtrackState.autoplayAttempted = true;

	const tracks = collectCinetraktPlayableSummaryTracks();
	const selected = tracks.find((track) => track.key === cinetraktSoundtrackState.selectedTrackKey);
	if (!selected?.control?.isConnected) {
		if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS) {
			completeCinetraktSoundtrackAutoplay('paused');
		} else {
			cinetraktSoundtrackState.autoplayAttemptCount += 1;
			scheduleCinetraktSoundtrackAutoplayAttempt();
		}
		return;
	}

	if (isCinetraktSoundtrackControlPlaying(selected.control)) {
		completeCinetraktSoundtrackAutoplay('playing');
		return;
	}

	cinetraktSoundtrackState.autoplayAttemptCount += 1;
	const isFirstAttempt = cinetraktSoundtrackState.autoplayAttemptCount === 1;
	const controlWasReplaced = cinetraktSoundtrackState.autoplayClickedControl
		&& cinetraktSoundtrackState.autoplayClickedControl !== selected.control;
	cinetraktSoundtrackState.selectedControl = selected.control;

	if (isFirstAttempt || controlWasReplaced) {
		cinetraktSoundtrackState.autoplayClickedControl = selected.control;
		selected.control.click();
	} else if (!requestCinetraktSpotifyEmbedPlayback(selected)) {
		selected.control.click();
	}

	if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS) {
		clearCinetraktSoundtrackTimer('settleTimer');
		cinetraktSoundtrackState.settleTimer = window.setTimeout(() => {
			cinetraktSoundtrackState.settleTimer = null;
			if (cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()) {
				completeCinetraktSoundtrackAutoplay();
			}
		}, CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY);
		return;
	}

	scheduleCinetraktSoundtrackAutoplayAttempt();
}

function toggleCinetraktSoundtrackPlayback() {
	if (!cinetraktSoundtrackState.autoplaySettled) return;
	const track = resolveCinetraktSoundtrackControl();
	if (!track?.control?.isConnected) return;
	track.control.click();
	scheduleCinetraktSoundtrackSync(80);
}

function cleanupCinetraktSoundtrackFeature({ pause = true, resetRoute = true } = {}) {
	clearCinetraktSoundtrackTimer('syncTimer');
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('settleTimer');

	if (pause) {
		const playingTrack = collectCinetraktControllableSoundtrackTracks()
			.find((track) => isCinetraktSoundtrackControlPlaying(track.control));
		playingTrack?.control.click();
	}

	cinetraktSoundtrackState.soundtrackObserver?.disconnect();
	if (cinetraktSoundtrackState.coverButton) {
		cinetraktSoundtrackState.coverButton.removeEventListener('click', toggleCinetraktSoundtrackPlayback);
	}
	document.querySelector('.trakt-side-navbar')?.classList.remove('cinetrakt-soundtrack-card-mounted');
	cinetraktSoundtrackState.card?.remove();
	cinetraktSoundtrackState.metadataRequestId += 1;

	Object.assign(cinetraktSoundtrackState, {
		status: 'idle',
		discoveryDeadline: 0,
		autoplayAttempted: false,
		autoplaySettled: false,
		autoplayAttemptCount: 0,
		autoplayClickedControl: null,
		selectedTrackKey: '',
		selectedControl: null,
		section: null,
		card: null,
		coverButton: null,
		coverImage: null,
		titleElement: null,
		artistElement: null,
		cardReady: false,
		playbackState: 'paused',
		displayedTrackKey: '',
		displayedCoverUrl: '',
		soundtrackObserver: null,
	});
	if (resetRoute) cinetraktSoundtrackState.routeKey = '';
}

function initializeCinetraktSoundtrackFeatureForRoute() {
	const routeKey = getCinetraktSoundtrackRouteKey();
	if (routeKey !== cinetraktSoundtrackState.routeKey) {
		cleanupCinetraktSoundtrackFeature();
		if (!routeKey) return;
		cinetraktSoundtrackState.routeKey = routeKey;
		cinetraktSoundtrackState.status = 'discovering';
		cinetraktSoundtrackState.discoveryDeadline = Date.now() + CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT;
	}

	if (!routeKey || cinetraktSoundtrackState.status === 'unavailable') return;
	const section = findCinetraktSoundtrackSummarySection();
	if (!section) {
		if (cinetraktSoundtrackState.status === 'discovering'
			&& Date.now() >= cinetraktSoundtrackState.discoveryDeadline) {
			cinetraktSoundtrackState.status = 'unavailable';
		}
		return;
	}
	observeCinetraktSoundtrackSection(section);

	const tracks = collectCinetraktPlayableSummaryTracks(section);
	if (tracks.length === 0) {
		if (cinetraktSoundtrackState.status === 'discovering'
			&& Date.now() >= cinetraktSoundtrackState.discoveryDeadline) {
			cinetraktSoundtrackState.status = 'unavailable';
			cinetraktSoundtrackState.soundtrackObserver?.disconnect();
			cinetraktSoundtrackState.soundtrackObserver = null;
		}
		return;
	}

	if (!cinetraktSoundtrackState.selectedTrackKey) {
		const selected = tracks[Math.floor(Math.random() * tracks.length)];
		cinetraktSoundtrackState.selectedTrackKey = selected.key;
		cinetraktSoundtrackState.selectedControl = selected.control;
		cinetraktSoundtrackState.status = 'ready';
		ensureCinetraktSoundtrackCardPlacement();
	}

	if (!isCinetraktFeatureEnabled('traktSoundtrackAutoplay')) {
		cinetraktSoundtrackState.autoplayAttempted = true;
		cinetraktSoundtrackState.autoplaySettled = true;
		updateCinetraktSoundtrackPlaybackState('paused');
		ensureCinetraktSoundtrackCardPlacement();
	} else if (!cinetraktSoundtrackState.autoplayAttempted) {
		scheduleCinetraktSoundtrackAutoplayAttempt(450);
	}

	syncCinetraktSoundtrackState();
}

const CINETRAKT_COLLECTION_HOST_ID = 'cinetrakt-official-collection-host';
const CINETRAKT_COLLECTION_STYLE_ID = 'cinetrakt-official-collection-style';
let cinetraktCollectionPlacement = null;
let cinetraktCollectionRenderProbe = null;
let cinetraktCollectionProbeAttemptedRoute = '';

function injectCinetraktCollectionCardStyles() {
	if (document.getElementById(CINETRAKT_COLLECTION_STYLE_ID)) return;

	const style = document.createElement('style');
	style.id = CINETRAKT_COLLECTION_STYLE_ID;
	style.textContent = `
		#${CINETRAKT_COLLECTION_HOST_ID} {
			box-sizing: border-box;
			margin-top: 20px;
			width: 100%;
			min-width: 0;
			--width-card: 100%;
			--height-card: auto;
		}

		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card,
		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card > .trakt-card-content,
		#${CINETRAKT_COLLECTION_HOST_ID} .trakt-list-summary-card {
			box-sizing: border-box;
			width: 100% !important;
			max-width: 100% !important;
			min-width: 0 !important;
		}

		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card,
		#${CINETRAKT_COLLECTION_HOST_ID} > .trakt-card > .trakt-card-content {
			height: auto !important;
		}
	`;
	document.head.appendChild(style);
}

function findCinetraktCollectionInsertionTarget() {
	const summary = document.querySelector('.trakt-summary-main-content');
	const synopsis = summary?.querySelector('.line-clamp-content');
	if (!synopsis) return null;
	return synopsis.closest('trakt-spoiler')
		|| synopsis.closest('.trakt-clamped-text')
		|| synopsis;
}

function findCinetraktPopularListsSection() {
	return [...document.querySelectorAll('section.section-list-container, section')].find((section) => {
		return [...section.querySelectorAll('h1, h2, h3, h4, a, button, div, span')]
			.some((element) => /^(Popular Lists|Listes populaires)$/i.test(getCleanText(element.textContent)));
	}) || null;
}

function findCinetraktOfficialCollectionCard() {
	const popularListsSection = findCinetraktPopularListsSection();
	if (!popularListsSection) return null;

	const officialCards = popularListsSection.querySelectorAll(
		'.trakt-list-summary-card[data-variant="official"]',
	);
	for (const officialCard of officialCards) {
		if (!/@Trakt/i.test(officialCard.textContent || '')
			|| officialCard.querySelectorAll('img').length < 2) continue;
		return officialCard.closest('.trakt-card');
	}

	return null;
}

function restoreCinetraktCollectionRenderProbe() {
	if (!cinetraktCollectionRenderProbe) return;

	const { renderFor, placeholder, probe, timer, originalStyle } = cinetraktCollectionRenderProbe;
	window.clearTimeout(timer);
	if (renderFor) {
		if (originalStyle == null) renderFor.removeAttribute('style');
		else renderFor.setAttribute('style', originalStyle);
	}
	if (renderFor?.isConnected && placeholder?.parentNode) {
		placeholder.parentNode.insertBefore(renderFor, placeholder);
	}
	placeholder?.remove();
	probe?.remove();
	cinetraktCollectionRenderProbe = null;
}

function primeCinetraktPopularListsRendering(routeKey) {
	if (cinetraktCollectionRenderProbe?.routeKey === routeKey) return;
	if (cinetraktCollectionProbeAttemptedRoute === routeKey) return;
	restoreCinetraktCollectionRenderProbe();

	const listsWrapper = [...document.querySelectorAll('svelte-css-wrapper')].find((wrapper) => {
		return wrapper.getAttribute('style')?.includes('--height-lists-list');
	});
	const renderFor = listsWrapper?.closest('trakt-render-for');
	if (!renderFor?.parentNode) return;
	cinetraktCollectionProbeAttemptedRoute = routeKey;

	const placeholder = document.createComment('CineTrakt popular lists render position');
	const probe = document.createElement('div');
	const originalStyle = renderFor.getAttribute('style');
	Object.assign(probe.style, {
		position: 'fixed',
		left: '240px',
		top: '160px',
		width: '480px',
		height: '320px',
		overflow: 'hidden',
		opacity: '0',
		pointerEvents: 'none',
		zIndex: '-1',
	});
	Object.assign(renderFor.style, {
		display: 'block',
		width: '480px',
		height: '320px',
		minHeight: '320px',
	});

	renderFor.parentNode.insertBefore(placeholder, renderFor);
	document.body.appendChild(probe);
	probe.appendChild(renderFor);
	const timer = window.setTimeout(() => restoreCinetraktCollectionRenderProbe(), 5000);
	cinetraktCollectionRenderProbe = { routeKey, renderFor, placeholder, probe, timer, originalStyle };
}

function restoreCinetraktOfficialCollectionCard() {
	restoreCinetraktCollectionRenderProbe();
	if (!cinetraktCollectionPlacement) return;

	cinetraktCollectionPlacement.host?.remove();
	cinetraktCollectionPlacement = null;
}

function normalizeCinetraktSvgViewBoxes(root) {
	root?.querySelectorAll('svg[viewBox]').forEach((svg) => {
		const rawViewBox = svg.getAttribute('viewBox')?.trim() || '';
		const exactValues = rawViewBox.split(/[\s,]+/).map(Number);
		const hasValidViewBox = exactValues.length === 4
			&& exactValues.every(Number.isFinite)
			&& exactValues[2] >= 0
			&& exactValues[3] >= 0;
		if (hasValidViewBox) return;

		const recoveredValues = rawViewBox.match(/-?(?:\d+\.?\d*|\.\d+)/g)?.map(Number) || [];
		if (recoveredValues.length === 4
			&& recoveredValues.every(Number.isFinite)
			&& recoveredValues[2] >= 0
			&& recoveredValues[3] >= 0) {
			svg.setAttribute('viewBox', recoveredValues.join(' '));
		} else {
			svg.removeAttribute('viewBox');
		}
	});
}

function placeCinetraktOfficialCollectionCard() {
	const routeKey = window.location.pathname;
	const isMoviePage = /^\/movies\/[^/]+\/?$/.test(routeKey);
	if (!isMoviePage) {
		restoreCinetraktOfficialCollectionCard();
		cinetraktCollectionProbeAttemptedRoute = '';
		return;
	}

	if (cinetraktCollectionPlacement
		&& (cinetraktCollectionPlacement.routeKey !== routeKey
			|| !cinetraktCollectionPlacement.host?.isConnected)) {
		restoreCinetraktOfficialCollectionCard();
	}
	if (cinetraktCollectionPlacement) return;

	const insertionTarget = findCinetraktCollectionInsertionTarget();
	const collectionCard = findCinetraktOfficialCollectionCard();
	if (!insertionTarget) return;
	if (!collectionCard) {
		primeCinetraktPopularListsRendering(routeKey);
		return;
	}

	injectCinetraktCollectionCardStyles();
	const host = document.createElement('div');
	host.id = CINETRAKT_COLLECTION_HOST_ID;
	host.dataset.cinetraktRoute = routeKey;
	normalizeCinetraktSvgViewBoxes(collectionCard);
	const collectionCardCopy = collectionCard.cloneNode(true);
	collectionCardCopy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));
	collectionCardCopy.querySelectorAll('img').forEach((image) => image.setAttribute('loading', 'eager'));
	normalizeCinetraktSvgViewBoxes(collectionCardCopy);
	restoreCinetraktCollectionRenderProbe();
	insertionTarget.insertAdjacentElement('afterend', host);
	host.appendChild(collectionCardCopy);
	cinetraktCollectionPlacement = { routeKey, host };
}

function getCinetraktSidebarEntryWrapper(candidate, boundary) {
	let wrapper = candidate;
	for (let element = candidate.parentElement; element && element !== boundary; element = element.parentElement) {
		const interactiveElements = element.querySelectorAll(
			'a[href], button, [role="link"]:not(a), [role="button"]:not(button)',
		);
		if (interactiveElements.length > 1) break;
		wrapper = element;
	}
	return wrapper;
}

function hideCinetraktUnusedTraktNavigationEntries() {
	const sidebar = document.querySelector('.trakt-side-navbar');
	const bottom = sidebar?.querySelector(':scope > .trakt-side-navbar-bottom');
	const content = sidebar?.querySelector(':scope > .trakt-side-navbar-content');
	if (!bottom && !content) return;

	if (!document.getElementById('cinetrakt-hidden-navigation-style')) {
		const style = document.createElement('style');
		style.id = 'cinetrakt-hidden-navigation-style';
		style.textContent = '.cinetrakt-hidden-navigation-entry { display: none !important; }';
		document.head.appendChild(style);
	}

	const targets = [
		{
			boundary: bottom,
			matches: (labels, href) => labels.some((label) => [
				'library',
				'librairie',
				'bibliothèque',
				'bibliotheque',
			].includes(label)) || /(^|\/)library(?:\/|\?|#|$)/i.test(href),
		},
		{
			boundary: content,
			matches: (labels, href) => labels.some((label) => label === 'collaborations')
				|| /(^|\/)collaborations(?:\/|\?|#|$)/i.test(href),
		},
	];

	for (const { boundary, matches } of targets) {
		if (!boundary) continue;
		for (const candidate of boundary.querySelectorAll(
			'a[href], button, [role="link"]:not(a), [role="button"]:not(button)',
		)) {
			const labels = [
				candidate.textContent,
				candidate.getAttribute('aria-label'),
				candidate.getAttribute('title'),
			]
				.map((value) => value?.trim().toLowerCase() || '')
				.filter(Boolean);
			const href = candidate.getAttribute('href') || '';
			if (!matches(labels, href)) continue;

			getCinetraktSidebarEntryWrapper(candidate, boundary)
				.classList.add('cinetrakt-hidden-navigation-entry');
		}
	}
}

async function runStremioButtons() {
	await globalThis.CineTraktSettings?.ready;
	if (window.location.hostname !== "app.trakt.tv") return;
	const posterLayoutEnabled = isCinetraktFeatureEnabled('traktPosterLayout')
		&& /^\/(shows|movies)\/[^/]+\/?$/.test(window.location.pathname);
	document.documentElement.classList.toggle('cinetrakt-poster-layout-enabled', posterLayoutEnabled);
	if (posterLayoutEnabled) {
		setupWatchOnStremioPosterSize();
	} else {
		cleanupWatchOnStremioPosterSize();
	}

	if (isCinetraktFeatureEnabled('traktSoundtrack')) {
		initializeCinetraktSoundtrackFeatureForRoute();
	} else {
		cleanupCinetraktSoundtrackFeature({ pause: false });
	}
	if (isCinetraktFeatureEnabled('traktNavigationCleanup')) {
		hideCinetraktUnusedTraktNavigationEntries();
	}
	if (isCinetraktFeatureEnabled('traktCollectionCard')) {
		placeCinetraktOfficialCollectionCard();
	} else {
		restoreCinetraktOfficialCollectionCard();
	}
	if (!isTraktPageNeedingExtensionWork()) return;

	if (isCinetraktFeatureEnabled('traktStremioLinks')) {
		setupTraktV3NativeLinkProtector();
		protectTraktV3NativeLinks();
		insertStremioButtonTraktV3();
		removeLegacyStremioEpisodeButtons();
	}
	if (isCinetraktFeatureEnabled('traktRatingColors')) {
		colorizeTraktImdbRatings();
		colorizeTraktPersonalRating();
	}
	if (isCinetraktFeatureEnabled('traktRatingsToggle')
		|| isCinetraktFeatureEnabled('imdbEpisodeRatingsPopup')) {
		setupWatchOnStremioTraktMoreRatingsToggle();
	}
}

function scheduleRunStremioButtons(delay = 0) {
	window.clearTimeout(scheduleRunStremioButtons.timer);
	scheduleRunStremioButtons.timer = window.setTimeout(runStremioButtons, delay);
}

document.addEventListener("DOMContentLoaded", () => scheduleRunStremioButtons(0));
window.addEventListener("load", () => scheduleRunStremioButtons(0));

if (window.location.hostname === "app.trakt.tv") {
	const traktObserver = new MutationObserver(() => scheduleRunStremioButtons(250));
	window.addEventListener('message', handleCinetraktSpotifyEmbedMessage);
	window.addEventListener('resize', () => scheduleCinetraktStickyPosterLayoutUpdate(80), { passive: true });
	window.visualViewport?.addEventListener(
		'resize',
		() => scheduleCinetraktStickyPosterLayoutUpdate(80),
		{ passive: true },
	);

	traktObserver.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});

	let watchOnStremioScrollCleanupScheduled = false;
	window.addEventListener(
		"scroll",
		() => {
			if (watchOnStremioScrollCleanupScheduled) return;
			watchOnStremioScrollCleanupScheduled = true;
			window.setTimeout(() => {
				watchOnStremioScrollCleanupScheduled = false;
				if (isCinetraktFeatureEnabled('traktStremioLinks')) {
					cleanupAllDuplicateStremioButtons();
				}
				scheduleRunStremioButtons(80);
			}, 160);
		},
		{ passive: true },
	);

	window.setInterval(runStremioButtons, 2500);
	window.setInterval(() => {
		if (isCinetraktFeatureEnabled('traktStremioLinks')) cleanupAllDuplicateStremioButtons();
	}, 1200);
	window.addEventListener('pagehide', () => {
		cleanupCinetraktSoundtrackFeature({ pause: isCinetraktFeatureEnabled('traktSoundtrack') });
	});
}
