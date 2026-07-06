const STREMIO_WEB_WINDOW_KEY = "watchOnStremioWebWindowId";
const POPUP_MIN_WIDTH = 560;
const POPUP_MAX_WIDTH = 760;
const POPUP_DEFAULT_WIDTH = 610;
const SOURCE_MIN_WIDTH = 900;

// Pas de débordement volontaire hors écran : ça évite le pixel qui fuit sur les autres moniteurs.
// On met juste Trakt 8 px sous Stremio pour masquer la bordure invisible de Chrome entre les deux.
const WINDOW_SEAM_OVERLAP = 15;

// Petits ajustements manuels pour compenser les bordures invisibles de Chrome/Windows.
// Version prudente : on corrige seulement de quelques pixels pour tester.
const SNAP_EDGE_LEFT_FIX = -7;
const SNAP_EDGE_TOP_FIX = -6;
const SNAP_EDGE_RIGHT_FIX = 8;
const SNAP_EDGE_BOTTOM_FIX = 8;

// Ajustements fins :
// - Trakt est décalé de 1 px vers la droite via SNAP_EDGE_LEFT_FIX.
// - Le bord droit de Stremio rentre de 1 px, sans toucher à son bord gauche.
// - Trakt et Stremio restent ajustés seulement sur l’axe vertical demandé.
const POPUP_INNER_RIGHT_FIX = 1;

function clampNumber(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function getSavedWindowId(callback) {
	chrome.storage.local.get(STREMIO_WEB_WINDOW_KEY, (result) => {
		callback(result?.[STREMIO_WEB_WINDOW_KEY]);
	});
}

function saveWindowId(windowId) {
	chrome.storage.local.set({ [STREMIO_WEB_WINDOW_KEY]: windowId });
}

function forgetWindowId() {
	chrome.storage.local.remove(STREMIO_WEB_WINDOW_KEY);
}

function getWindowCenter(win) {
	return {
		x: (Number(win.left) || 0) + (Number(win.width) || 0) / 2,
		y: (Number(win.top) || 0) + (Number(win.height) || 0) / 2,
	};
}

function getIntersectionArea(a, b) {
	const left = Math.max(a.left, b.left);
	const top = Math.max(a.top, b.top);
	const right = Math.min(a.left + a.width, b.left + b.width);
	const bottom = Math.min(a.top + a.height, b.top + b.height);
	return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function pickBestDisplayForWindow(win, displays) {
	if (!Array.isArray(displays) || !displays.length) return null;

	const sourceBounds = {
		left: Number(win.left) || 0,
		top: Number(win.top) || 0,
		width: Number(win.width) || 0,
		height: Number(win.height) || 0,
	};

	let bestDisplay = displays[0];
	let bestScore = -1;

	for (const display of displays) {
		const area = display.workArea || display.bounds;
		const displayBounds = {
			left: area.left,
			top: area.top,
			width: area.width,
			height: area.height,
		};
		const score = getIntersectionArea(sourceBounds, displayBounds);
		if (score > bestScore) {
			bestScore = score;
			bestDisplay = display;
		}
	}

	if (bestScore > 0) return bestDisplay;

	const center = getWindowCenter(sourceBounds);
	return displays.find((display) => {
		const area = display.workArea || display.bounds;
		return (
			center.x >= area.left &&
			center.x < area.left + area.width &&
			center.y >= area.top &&
			center.y < area.top + area.height
		);
	}) || bestDisplay;
}

function getFallbackDisplayBounds(sourceWindow, screenBounds) {
	if (screenBounds?.availWidth && screenBounds?.availHeight) {
		return {
			left: Math.round(Number(screenBounds.availLeft) || 0),
			top: Math.round(Number(screenBounds.availTop) || 0),
			width: Math.round(Number(screenBounds.availWidth) || 1920),
			height: Math.round(Number(screenBounds.availHeight) || 1080),
		};
	}

	return {
		left: Math.round(Number(sourceWindow?.left) || 0),
		top: Math.round(Number(sourceWindow?.top) || 0),
		width: Math.round(Number(sourceWindow?.width) || 1920),
		height: Math.round(Number(sourceWindow?.height) || 1080),
	};
}

function getDisplayBoundsForSource(sender, screenBounds, callback) {
	if (!sender?.tab?.windowId) {
		callback(getFallbackDisplayBounds(null, screenBounds));
		return;
	}

	chrome.windows.get(sender.tab.windowId, (sourceWindow) => {
		if (chrome.runtime.lastError || !sourceWindow) {
			callback(getFallbackDisplayBounds(null, screenBounds));
			return;
		}

		if (!chrome.system?.display?.getInfo) {
			callback(getFallbackDisplayBounds(sourceWindow, screenBounds));
			return;
		}

		chrome.system.display.getInfo((displays) => {
			if (chrome.runtime.lastError || !Array.isArray(displays) || !displays.length) {
				callback(getFallbackDisplayBounds(sourceWindow, screenBounds));
				return;
			}

			const display = pickBestDisplayForWindow(sourceWindow, displays);
			const area = display?.workArea || display?.bounds;

			callback({
				left: Math.round(area.left),
				top: Math.round(area.top),
				width: Math.round(area.width),
				height: Math.round(area.height),
			});
		});
	});
}

function getPopupLayout(displayBounds) {
	const rawWidth = Math.max(1, Math.round(Number(displayBounds.width) || 1920));
	const rawHeight = Math.max(1, Math.round(Number(displayBounds.height) || 1080));
	const rawLeft = Math.round(Number(displayBounds.left) || 0);
	const rawTop = Math.round(Number(displayBounds.top) || 0);

	const left = rawLeft + SNAP_EDGE_LEFT_FIX;
	const top = rawTop + SNAP_EDGE_TOP_FIX;
	const width = rawWidth + Math.abs(SNAP_EDGE_LEFT_FIX) + SNAP_EDGE_RIGHT_FIX;
	const height = rawHeight + Math.abs(SNAP_EDGE_TOP_FIX) + SNAP_EDGE_BOTTOM_FIX;

	const maxPopupWidth = Math.min(POPUP_MAX_WIDTH, Math.floor(width * 0.36));
	const popupWidth = clampNumber(POPUP_DEFAULT_WIDTH, POPUP_MIN_WIDTH, maxPopupWidth);
	const seamOverlap = Math.min(WINDOW_SEAM_OVERLAP, Math.max(0, width - popupWidth - SOURCE_MIN_WIDTH));

	// Le popup reste strictement dans la zone utile de l'écran.
	const popupLeft = left + width - popupWidth;
	const adjustedPopupLeft = popupLeft;
	const adjustedPopupWidth = Math.max(1, popupWidth - POPUP_INNER_RIGHT_FIX);
	const traktWidth = Math.max(SOURCE_MIN_WIDTH, width - popupWidth + seamOverlap);

	return {
		trakt: {
			left,
			top,
			width: traktWidth,
			height,
		},
		popup: {
			left: adjustedPopupLeft,
			top,
			width: adjustedPopupWidth,
			height,
		},
	};
}

function readLastError() {
	return chrome.runtime.lastError || null;
}

function safeWindowUpdate(windowId, updateInfo, callback) {
	if (!windowId) {
		callback?.(false);
		return;
	}

	chrome.windows.update(windowId, updateInfo, () => {
		const error = readLastError();
		if (error) {
			callback?.(false, error);
			return;
		}
		callback?.(true, null);
	});
}

function safeTabUpdate(tabId, updateInfo, callback) {
	if (!tabId) {
		callback?.(false);
		return;
	}

	chrome.tabs.update(tabId, updateInfo, () => {
		const error = readLastError();
		if (error) {
			callback?.(false, error);
			return;
		}
		callback?.(true, null);
	});
}

function normalizeWindow(windowId, bounds, callback, options = {}) {
	if (!windowId || !bounds) {
		callback?.(false);
		return;
	}

	const wanted = {
		left: Math.round(bounds.left),
		top: Math.round(bounds.top),
		width: Math.round(bounds.width),
		height: Math.round(bounds.height),
		focused: false,
	};

	const passes = Number.isFinite(options.passes) ? options.passes : 3;
	const firstDelay = Number.isFinite(options.firstDelay) ? options.firstDelay : 120;
	const passDelay = Number.isFinite(options.passDelay) ? options.passDelay : 120;

	const applyWanted = (passesLeft) => {
		if (passesLeft <= 0) {
			callback?.(true);
			return;
		}

		safeWindowUpdate(windowId, { ...wanted, state: "normal" }, (ok) => {
			if (!ok) {
				callback?.(false);
				return;
			}

			setTimeout(() => applyWanted(passesLeft - 1), passDelay);
		});
	};

	safeWindowUpdate(windowId, { state: "normal", focused: false }, (ok) => {
		if (!ok) {
			callback?.(false);
			return;
		}

		setTimeout(() => applyWanted(passes), firstDelay);
	});
}

function normalizeWindowFast(windowId, bounds, callback) {
	// Première passe rapide : le but est que la fenêtre arrive déjà au bon endroit
	// avant de naviguer vers Stremio, pour éviter l'effet « ça s'ouvre puis ça bouge ».
	normalizeWindow(windowId, bounds, callback, { passes: 1, firstDelay: 0, passDelay: 0 });
}

function resizeSourceWindow(sender, layout) {
	if (!sender?.tab?.windowId || !layout?.trakt) return;
	normalizeWindow(sender.tab.windowId, layout.trakt, () => {});
}

function focusSourceTab(sender) {
	if (!sender?.tab?.id || !sender?.tab?.windowId) return;
	safeTabUpdate(sender.tab.id, { active: true }, () => {});
	safeWindowUpdate(sender.tab.windowId, { focused: true }, () => {});
}

function focusStremioWindow(windowId, sendResponse) {
	safeWindowUpdate(windowId, { focused: true }, (ok) => {
		sendResponse({ ok: !!ok, windowId });
	});
}

function createStremioPopup(url, layout, sender, sendResponse) {
	// On cale Trakt avant de créer Stremio : sinon Chrome affiche brièvement
	// les fenêtres à l'ancienne taille puis les recolle une seconde plus tard.
	normalizeWindowFast(sender?.tab?.windowId, layout.trakt, () => {
		chrome.windows.create(
			{
				url,
				type: "popup",
				left: layout.popup.left,
				top: layout.popup.top,
				width: layout.popup.width,
				height: layout.popup.height,
				focused: true,
			},
			(newWindow) => {
				if (chrome.runtime.lastError || !newWindow?.id) {
					sendResponse({ ok: false });
					return;
				}

				saveWindowId(newWindow.id);

				// Petite passe de sécurité : normalement la fenêtre est déjà créée au bon endroit.
				normalizeWindowFast(newWindow.id, layout.popup, () => {
					focusStremioWindow(newWindow.id, sendResponse);
				});
			}
		);
	});
}

function moveAndReuseStremioPopup(existingWindow, url, layout, sender, sendResponse) {
	const firstTab = existingWindow.tabs?.[0];

	const openAfterPreLayout = () => {
		// On applique les bounds AVANT de changer l'URL : la fenêtre ne doit plus
		// apparaître à droite puis se recaler après le chargement.
		normalizeWindowFast(existingWindow.id, layout.popup, () => {
			normalizeWindowFast(sender?.tab?.windowId, layout.trakt, () => {
				if (firstTab?.id) {
					safeTabUpdate(firstTab.id, { url, active: true }, (ok) => {
						if (!ok) {
							forgetWindowId();
							createStremioPopup(url, layout, sender, sendResponse);
							return;
						}

						normalizeWindowFast(existingWindow.id, layout.popup, () => {
							focusStremioWindow(existingWindow.id, sendResponse);
						});
					});
				} else {
					chrome.tabs.create({ windowId: existingWindow.id, url, active: true }, () => {
						const error = readLastError();
						if (error) {
							forgetWindowId();
							createStremioPopup(url, layout, sender, sendResponse);
							return;
						}

						normalizeWindowFast(existingWindow.id, layout.popup, () => {
							focusStremioWindow(existingWindow.id, sendResponse);
						});
					});
				}
			});
		});
	};

	openAfterPreLayout();
}

function openOrReuseStremioWindow(url, layout, sender, sendResponse) {
	getSavedWindowId((savedWindowId) => {
		if (!savedWindowId) {
			createStremioPopup(url, layout, sender, sendResponse);
			return;
		}

		chrome.windows.get(savedWindowId, { populate: true }, (existingWindow) => {
			if (chrome.runtime.lastError || !existingWindow?.id) {
				forgetWindowId();
				createStremioPopup(url, layout, sender, sendResponse);
				return;
			}

			moveAndReuseStremioPopup(existingWindow, url, layout, sender, sendResponse);
		});
	});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type !== "WATCH_ON_STREMIO_OPEN_WEB" || !message.url) return false;

	getDisplayBoundsForSource(sender, message.screenBounds, (displayBounds) => {
		const layout = getPopupLayout(displayBounds);
		openOrReuseStremioWindow(message.url, layout, sender, sendResponse);
	});

	return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
	getSavedWindowId((savedWindowId) => {
		if (savedWindowId === windowId) forgetWindowId();
	});
});
