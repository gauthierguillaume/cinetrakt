importScripts("settings.js", "extension-protocol.js", "stremio-url.js", "window-layout.js");

const {
	getFallbackDisplayBounds,
	getImdbRatingsPopupLayout,
	getPopupLayout,
	getResizedImdbRatingsPopupLayout,
	pickBestDisplayForWindow,
} = globalThis.CineTraktWindowLayout;
const { isStremioWebUrl } = globalThis.CineTraktStremioUrls;
const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;

const STREMIO_WEB_WINDOW_KEY = "watchOnStremioWebWindowId";
const IMDB_RATINGS_WINDOW_KEY = "cinetraktImdbRatingsWindowId";

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === MESSAGE_TYPES.RESIZE_IMDB_RATINGS_POPUP) {
		resizeImdbRatingsPopup(message, sender, sendResponse);
		return true;
	}

	if (message?.type === MESSAGE_TYPES.OPEN_IMDB_RATINGS_POPUP) {
		const imdbId = String(message.imdbId || "");
		const senderUrl = sender?.tab?.url || sender?.url || "";
		if (!/^tt\d{7,}$/.test(imdbId) || !senderUrl.startsWith("https://app.trakt.tv/")) {
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
	if (!senderUrl.startsWith("https://app.trakt.tv/") || !isStremioWebUrl(message.url)) {
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

const cinetraktRedirectedNewTabIds = new Set();

function isNativeChromeNewTabUrl(url) {
	return /^chrome:\/\/(newtab|new-tab-page)\/?$/i.test(String(url || ""));
}

async function maybeOpenCineTraktNewTab(tab) {
	if (!tab?.id || cinetraktRedirectedNewTabIds.has(tab.id)) return;
	const initialUrl = tab.pendingUrl || tab.url;
	if (initialUrl && !isNativeChromeNewTabUrl(initialUrl)) return;

	await globalThis.CineTraktSettings.ready;
	if (!globalThis.CineTraktSettings.isEnabled("newTabMovieDiscovery")) return;
	if (!globalThis.CineTraktSettings.getTmdbCredential()) return;

	if (!initialUrl) {
		tab = await new Promise((resolve) => {
			chrome.tabs.get(tab.id, (currentTab) => {
				resolve(chrome.runtime.lastError ? null : currentTab);
			});
		});
	}
	if (!isNativeChromeNewTabUrl(tab?.pendingUrl || tab?.url)) return;

	cinetraktRedirectedNewTabIds.add(tab.id);
	chrome.tabs.update(tab.id, { url: chrome.runtime.getURL("newtab.html") }, () => {
		if (chrome.runtime.lastError) cinetraktRedirectedNewTabIds.delete(tab.id);
	});
}

chrome.tabs.onCreated.addListener((tab) => {
	void maybeOpenCineTraktNewTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (!isNativeChromeNewTabUrl(changeInfo.url)) {
		if (changeInfo.url) cinetraktRedirectedNewTabIds.delete(tabId);
		return;
	}
	void maybeOpenCineTraktNewTab({ ...tab, id: tabId, url: changeInfo.url });
});

chrome.tabs.onRemoved.addListener((tabId) => {
	cinetraktRedirectedNewTabIds.delete(tabId);
});
