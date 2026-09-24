importScripts("settings.js", "extension-protocol.js", "stremio-url.js", "trakt-imdb-resolver.js", "window-layout.js");

const {
	getFallbackDisplayBounds,
	getImdbRatingsPopupLayout,
	getPopupLayout,
	getResizedImdbRatingsPopupLayout,
	pickBestDisplayForWindow,
} = globalThis.CineTraktWindowLayout;
const { isStremioWebUrl } = globalThis.CineTraktStremioUrls;
const {
	TRAKT_API_CLIENT_ID,
	findImdbIdInTraktResponse,
	getTraktApiMediaUrl,
} = globalThis.CineTraktTraktImdbResolver;
const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;

const STREMIO_WEB_WINDOW_KEY = "watchOnStremioWebWindowId";
const IMDB_RATINGS_WINDOW_KEY = "cinetraktImdbRatingsWindowId";
const TRAKT_APP_ORIGIN = "https://app.trakt.tv";

function hasExactOrigin(value, expectedOrigin) {
	try {
		return new URL(String(value || "")).origin === expectedOrigin;
	} catch {
		return false;
	}
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

function getSavedImdbRatingsWindowId(callback) {
	chrome.storage.local.get(IMDB_RATINGS_WINDOW_KEY, (result) => {
		callback(result?.[IMDB_RATINGS_WINDOW_KEY]);
	});
}

function saveImdbRatingsWindowId(windowId) {
	chrome.storage.local.set({ [IMDB_RATINGS_WINDOW_KEY]: windowId });
}

function forgetImdbRatingsWindowId() {
	chrome.storage.local.remove(IMDB_RATINGS_WINDOW_KEY);
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

function normalizeWindowFast(windowId, bounds, callback) {
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

	safeWindowUpdate(windowId, { state: "normal", focused: false }, (ok) => {
		if (!ok) {
			callback?.(false);
			return;
		}

		setTimeout(() => {
			safeWindowUpdate(windowId, { ...wanted, state: "normal" }, (boundsApplied) => {
				callback?.(boundsApplied);
			});
		}, 0);
	});
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
				type: "normal",
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

function getImdbRatingsPopupUrl(imdbId) {
	return `https://www.imdb.com/title/${imdbId}/ratings/?cinetrakt_ratings_popup=1`;
}

function getImdbIdFromRatingsUrl(url) {
	return String(url || "").match(/\/title\/(tt\d{7,})\/ratings\/?/i)?.[1] || "";
}

function focusImdbRatingsWindow(windowId, sendResponse) {
	safeWindowUpdate(windowId, { focused: true }, (ok) => {
		sendResponse({ ok: !!ok, windowId });
	});
}

function createImdbRatingsPopup(imdbId, layout, sendResponse) {
	chrome.windows.create({
		url: getImdbRatingsPopupUrl(imdbId),
		type: "popup",
		left: layout.left,
		top: layout.top,
		width: layout.width,
		height: layout.height,
		focused: true,
	}, (newWindow) => {
		if (readLastError() || !newWindow?.id) {
			sendResponse({ ok: false });
			return;
		}

		saveImdbRatingsWindowId(newWindow.id);
		sendResponse({ ok: true, windowId: newWindow.id });
	});
}

function reuseImdbRatingsPopup(existingWindow, imdbId, layout, sendResponse) {
	const tab = existingWindow.tabs?.[0];
	if (!tab?.id) {
		forgetImdbRatingsWindowId();
		createImdbRatingsPopup(imdbId, layout, sendResponse);
		return;
	}

	const currentImdbId = getImdbIdFromRatingsUrl(tab.url);
	const isPopupUrl = String(tab.url || "").includes("cinetrakt_ratings_popup=1");
	if (currentImdbId === imdbId && isPopupUrl) {
		safeTabUpdate(tab.id, { active: true }, () => {
			focusImdbRatingsWindow(existingWindow.id, sendResponse);
		});
		return;
	}

	safeTabUpdate(tab.id, { url: getImdbRatingsPopupUrl(imdbId), active: true }, (ok) => {
		if (!ok) {
			forgetImdbRatingsWindowId();
			createImdbRatingsPopup(imdbId, layout, sendResponse);
			return;
		}
		focusImdbRatingsWindow(existingWindow.id, sendResponse);
	});
}

function resizeImdbRatingsPopup(message, sender, sendResponse) {
	const senderWindowId = sender?.tab?.windowId;
	const senderUrl = sender?.tab?.url || sender?.url || "";
	const requestedWidth = Number(message.width);
	const requestedHeight = Number(message.height);
	if (!senderWindowId
		|| !senderUrl.includes("cinetrakt_ratings_popup=1")
		|| !Number.isFinite(requestedWidth)
		|| !Number.isFinite(requestedHeight)) {
		sendResponse({ ok: false });
		return;
	}

	getSavedImdbRatingsWindowId((savedWindowId) => {
		if (savedWindowId !== senderWindowId) {
			sendResponse({ ok: false });
			return;
		}

		getDisplayBoundsForSource(sender, null, (displayBounds) => {
			const layout = getResizedImdbRatingsPopupLayout(displayBounds, requestedWidth, requestedHeight);
			safeWindowUpdate(senderWindowId, { ...layout, state: "normal" }, (ok) => {
				sendResponse({ ok: !!ok, windowId: senderWindowId, layout: ok ? layout : undefined });
			});
		});
	});
}

function openOrReuseImdbRatingsWindow(imdbId, layout, sendResponse) {
	getSavedImdbRatingsWindowId((savedWindowId) => {
		if (!savedWindowId) {
			createImdbRatingsPopup(imdbId, layout, sendResponse);
			return;
		}

		chrome.windows.get(savedWindowId, { populate: true }, (existingWindow) => {
			if (readLastError() || !existingWindow?.id) {
				forgetImdbRatingsWindowId();
				createImdbRatingsPopup(imdbId, layout, sendResponse);
				return;
			}
			reuseImdbRatingsPopup(existingWindow, imdbId, layout, sendResponse);
		});
	});
}

async function resolveTraktImdbId(pathname) {
	const apiUrl = getTraktApiMediaUrl(pathname);
	if (!apiUrl) return '';

	try {
		const response = await fetch(apiUrl, {
			credentials: 'omit',
			headers: {
				'trakt-api-key': TRAKT_API_CLIENT_ID,
				'trakt-api-version': '2',
			},
		});
		if (!response.ok) return '';
		return findImdbIdInTraktResponse(await response.json());
	} catch (error) {
		console.warn('CineTrakt: official Trakt API IMDb lookup failed', error);
		return '';
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === MESSAGE_TYPES.RESOLVE_TRAKT_IMDB_ID) {
		const senderUrl = sender?.tab?.url || sender?.url || '';
		if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN)) {
			sendResponse({ ok: false, imdbId: '' });
			return false;
		}

		resolveTraktImdbId(message.pathname).then((imdbId) => {
			sendResponse({ ok: Boolean(imdbId), imdbId });
		});
		return true;
	}

	if (message?.type === MESSAGE_TYPES.RESIZE_IMDB_RATINGS_POPUP) {
		resizeImdbRatingsPopup(message, sender, sendResponse);
		return true;
	}

	if (message?.type === MESSAGE_TYPES.OPEN_IMDB_RATINGS_POPUP) {
		const imdbId = String(message.imdbId || "");
		const senderUrl = sender?.tab?.url || sender?.url || "";
		if (!/^tt\d{7,}$/.test(imdbId) || !hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN)) {
			sendResponse({ ok: false });
			return false;
		}

		getDisplayBoundsForSource(sender, message.screenBounds, (displayBounds) => {
			openOrReuseImdbRatingsWindow(imdbId, getImdbRatingsPopupLayout(displayBounds), sendResponse);
		});
		return true;
	}

	if (message?.type !== MESSAGE_TYPES.OPEN_STREMIO_WEB || !message.url) return false;
	const senderUrl = sender?.tab?.url || sender?.url || "";
	if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN) || !isStremioWebUrl(message.url)) {
		sendResponse({ ok: false });
		return false;
	}

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
	getSavedImdbRatingsWindowId((savedWindowId) => {
		if (savedWindowId === windowId) forgetImdbRatingsWindowId();
	});
});
