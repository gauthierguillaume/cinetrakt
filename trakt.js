console.log("CineTrakt: Extension loaded");
/*
 * Securite Trakt V3 : ne jamais transformer les cartes / jaquettes Trakt en liens Stremio.
 * Stremio doit s'ouvrir uniquement via les boutons injectes par l'extension.
 */
let watchOnStremioTraktLinkProtectorReady = false;

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
let watchOnStremioEpisodeLinkClickReady = false;

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
		.${WATCH_ON_STREMIO_EPISODE_LINK_CLASS}:focus-visible {
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

function makeSeasonEpisodeElementClickable(element, episodeData, stremioUrl) {
	if (!element || !episodeData || !stremioUrl) return;

	injectWatchOnStremioEpisodeLinkStyles();
	setupWatchOnStremioEpisodeLinkClickHandler();

	element.classList.add(WATCH_ON_STREMIO_EPISODE_LINK_CLASS);
	element.dataset.watchOnStremioEpisodeLinkReady = "true";
	element.dataset.stremioUrl = stremioUrl;
	element.dataset.watchOnStremioSeason = String(episodeData.season);
	element.dataset.watchOnStremioEpisode = String(episodeData.episode);
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
		makeSeasonEpisodeElementClickable(element, episodeData, stremioEpisodeUrl);
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


function prepareSeasonEpisodeTextLinkFromShowUrl(element, episodeData, showUrl) {
	if (!element || !episodeData || !showUrl) return;

	const showSlug = getShowSlugFromTraktUrl(showUrl);
	if (!showSlug) return;

	const cachedImdbId = getCachedTraktImdbId(showSlug);
	if (cachedImdbId) {
		makeSeasonEpisodeElementClickable(element, episodeData, buildStremioEpisodeUrl(cachedImdbId, episodeData.season, episodeData.episode));
		return;
	}

	if (element.dataset.watchOnStremioLinkPrepareStarted === "true") return;
	element.dataset.watchOnStremioLinkPrepareStarted = "true";

	getImdbIdFromTraktShowUrl(showUrl).then((imdbId) => {
		if (!imdbId) return;
		makeSeasonEpisodeElementClickable(element, episodeData, buildStremioEpisodeUrl(imdbId, episodeData.season, episodeData.episode));
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

		prepareSeasonEpisodeTextLinkFromShowUrl(element, episodeData, showUrl);
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
		}

		.wos-imdb-ratings-popup-button rect {
			fill: currentColor !important;
			transition: fill 160ms ease !important;
		}

		.wos-imdb-ratings-popup-button:hover .wos-grid-blue { fill: #3b82f6 !important; }
		.wos-imdb-ratings-popup-button:hover .wos-grid-green { fill: #22c55e !important; }
		.wos-imdb-ratings-popup-button:hover .wos-grid-yellow { fill: #eab308 !important; }
		.wos-imdb-ratings-popup-button:hover .wos-grid-pink { fill: #ec4899 !important; }
		.wos-imdb-ratings-popup-button:hover .wos-grid-purple { fill: #8b5cf6 !important; }

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

	// L'IMDb doit être à gauche. Les autres notes restent juste après le bouton quand on les affiche.
	if (summaryRatings.firstElementChild !== imdbItem) {
		summaryRatings.insertBefore(imdbItem, summaryRatings.firstElementChild);
	}

	let toggle = summaryRatings.querySelector(':scope > .wos-trakt-ratings-toggle');
	if (!toggle) {
		toggle = createWatchOnStremioTraktRatingsToggle(summaryRatings);
	}

	const isShowPage = /^\/shows\/[^/]+\/?$/.test(window.location.pathname);
	let popupButton = summaryRatings.querySelector(':scope > .wos-imdb-ratings-popup-button');
	const imdbId = isShowPage ? getWatchOnStremioImdbRatingsId(summaryRatings) : '';

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
		if (toggle.previousElementSibling !== popupButton) {
			popupButton.insertAdjacentElement('afterend', toggle);
		}
	} else if (toggle.previousElementSibling !== imdbItem) {
		imdbItem.insertAdjacentElement('afterend', toggle);
	}

	if (isShowPage && !imdbId && summaryRatings.dataset.cinetraktImdbIdRequestedRoute !== window.location.pathname) {
		const route = window.location.pathname;
		summaryRatings.dataset.cinetraktImdbIdRequestedRoute = route;
		getImdbIdFromTraktShowUrl(window.location.href).then((resolvedImdbId) => {
			if (resolvedImdbId && window.location.pathname === route) scheduleRunStremioButtons(0);
		});
	}

	if (!summaryRatings.dataset.watchOnStremioRatingsExpanded) {
		summaryRatings.dataset.watchOnStremioRatingsExpanded = 'false';
	}

	updateWatchOnStremioTraktRatingsVisibility(summaryRatings);
}


function injectWatchOnStremioPosterSizeStyles() {
	if (document.getElementById('watch-on-stremio-poster-size-styles')) return;

	const style = document.createElement('style');
	style.id = 'watch-on-stremio-poster-size-styles';
	style.textContent = `
		/* Agrandissement propre de la grande pochette Trakt.
		   On garde la grille native Trakt, mais on fixe aussi une largeur confortable
		   pour la colonne texte afin que les notes/synopsis ne repassent pas sur la pochette. */
		.trakt-summary-container.watch-on-stremio-poster-size-ready,
		[class*="trakt-summary-container"].watch-on-stremio-poster-size-ready {
			--summary-poster-width: var(--watch-on-stremio-summary-poster-width) !important;
			--summary-content-width: var(--watch-on-stremio-summary-content-width) !important;
			width: var(--watch-on-stremio-summary-total-width) !important;
			max-width: var(--watch-on-stremio-summary-total-width) !important;
		}

		.watch-on-stremio-summary-poster-sized {
			width: var(--watch-on-stremio-summary-poster-width) !important;
			max-width: var(--watch-on-stremio-summary-poster-width) !important;
		}

		.watch-on-stremio-summary-poster-sized img {
			width: 100% !important;
			height: auto !important;
			object-fit: contain !important;
		}

		.watch-on-stremio-poster-size-ready .trakt-summary-content,
		.watch-on-stremio-poster-size-ready [class*="trakt-summary-content"] {
			min-width: min(var(--watch-on-stremio-summary-content-width), 100%) !important;
		}

	`;
	document.head.appendChild(style);
}

function setupWatchOnStremioPosterSize() {
	if (window.location.hostname !== 'app.trakt.tv') return;
	if (!/^\/(shows|movies)\//.test(window.location.pathname)) return;

	const summaryContainer = document.querySelector('.trakt-summary-container')
		|| document.querySelector('[class*="trakt-summary-container"]');
	const posterContainer = summaryContainer?.querySelector('.trakt-summary-poster-container')
		|| summaryContainer?.querySelector('[class*="trakt-summary-poster-container"]');

	if (!summaryContainer || !posterContainer) return;

	injectWatchOnStremioPosterSizeStyles();

	// Nettoyage des essais précédents, au cas où une ancienne version a laissé des classes/styles.
	summaryContainer.classList.remove('watch-on-stremio-summary-layout-ready', 'watch-on-stremio-large-poster-page');
	posterContainer.classList.remove('watch-on-stremio-poster-size-target', 'watch-on-stremio-poster-tilt-card');
	for (const property of ['transform', 'filter', 'box-shadow', 'transition', 'will-change', 'perspective', 'transform-origin', 'z-index']) {
		posterContainer.style.removeProperty(property);
	}

	if (!posterContainer.dataset.watchOnStremioNativePosterWidth) {
		const rect = posterContainer.getBoundingClientRect();
		posterContainer.dataset.watchOnStremioNativePosterWidth = String(Math.round(rect.width || 320));
	}

	const nativeWidth = Number(posterContainer.dataset.watchOnStremioNativePosterWidth) || 320;
	const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
	const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

	// Pochette validée, micro-augmentée de 1px réel par rapport à la 0.4.50.
	// On agrandit surtout le conteneur global de la fiche afin de laisser respirer
	// les trois colonnes natives Trakt, sans forcer la div centrale elle-même.
	const wantedWidth = Math.round(nativeWidth * 1.665);
	const maxByHeight = Math.floor((viewportHeight - 95) * 0.772);
	const maxByWidth = Math.floor(viewportWidth * 0.386);
	const finalWidth = Math.max(nativeWidth, Math.min(wantedWidth, maxByHeight, maxByWidth, 605) + 2);
	const contentWidth = Math.max(620, Math.min(760, Math.floor(viewportWidth * 0.38)));
	const totalWidth = Math.max(1280, Math.min(1560, viewportWidth - 260));

	summaryContainer.classList.add('watch-on-stremio-poster-size-ready');
	posterContainer.classList.add('watch-on-stremio-summary-poster-sized');
	summaryContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${finalWidth}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-summary-content-width', `${contentWidth}px`);
	summaryContainer.style.setProperty('--watch-on-stremio-summary-total-width', `${totalWidth}px`);
	posterContainer.style.setProperty('--watch-on-stremio-summary-poster-width', `${finalWidth}px`);
}

function runStremioButtons() {
	if (window.location.hostname !== "app.trakt.tv") return;
	if (!isTraktPageNeedingExtensionWork()) return;

	setupTraktV3NativeLinkProtector();
	protectTraktV3NativeLinks();
	insertStremioButtonTraktV3();
	colorizeTraktImdbRatings();
	setupWatchOnStremioTraktMoreRatingsToggle();
	setupWatchOnStremioPosterSize();
	colorizeTraktPersonalRating();
	removeLegacyStremioEpisodeButtons();
}

function scheduleRunStremioButtons(delay = 0) {
	window.clearTimeout(scheduleRunStremioButtons.timer);
	scheduleRunStremioButtons.timer = window.setTimeout(runStremioButtons, delay);
}

document.addEventListener("DOMContentLoaded", () => scheduleRunStremioButtons(0));
window.addEventListener("load", () => scheduleRunStremioButtons(0));

if (window.location.hostname === "app.trakt.tv") {
	const traktObserver = new MutationObserver(() => scheduleRunStremioButtons(250));

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
				cleanupAllDuplicateStremioButtons();
				scheduleRunStremioButtons(80);
			}, 160);
		},
		{ passive: true },
	);

	window.setInterval(runStremioButtons, 2500);
	window.setInterval(cleanupAllDuplicateStremioButtons, 1200);
}
