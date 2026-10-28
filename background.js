importScripts("settings.js", "extension-protocol.js", "stremio-url.js", "trakt-imdb-resolver.js", "window-layout.js");
importScripts('season-rating-utils.js');
importScripts('episode-rating-utils.js', 'imdb-episode-loader.js');
globalThis.CineTraktImdbEpisodeLoader.start();
const { getSeasonRatingsUrl, parseSeasonRatings, parseSeasonPosters, parseSeasonDetails } = globalThis.CineTraktSeasonRatings;

const {
	getFallbackDisplayBounds,
	getPopupLayout,
	pickBestDisplayForWindow,
} = globalThis.CineTraktWindowLayout;
const { isStremioWebUrl } = globalThis.CineTraktStremioUrls;
const {
	TRAKT_API_CLIENT_ID,
	findImdbIdInTraktResponse,
	getTraktApiMediaUrl,
	getTraktApiRatingsUrl,
	findExternalRatingsInTraktResponse,
} = globalThis.CineTraktTraktImdbResolver;
const { MESSAGE_TYPES } = globalThis.CineTraktExtensionProtocol;

const STREMIO_WEB_WINDOW_KEY = "watchOnStremioWebWindowId";
const STREMIO_SOURCE_STATE_KEY = "cinetraktStremioSourceState";
const STREMIO_MIN_WIDTH_KEY = "cinetraktStremioMinimumWidth";
const stremioPlacementJobs = new Map();
const stremioClosedDuringPlacement = new Set();
const TRAKT_APP_ORIGIN = "https://app.trakt.tv";
const TRAKT_LOOKUP_TIMEOUT_MS = 12000;
let soundtrackClaimSerial = Date.now() * 1000;

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

function restoreStremioSourceState(record, focused = true) {
	if (!record?.sourceWindowId) return;
	chrome.windows.get(record.sourceWindowId, (win) => {
		if (readLastError() || !win) return;
		if (record.state === "fullscreen" || record.state === "maximized") {
			// Fullscreen cannot be combined with focused:false or explicit bounds.
			safeWindowUpdate(win.id, { state: record.state, ...(focused ? { focused: true } : {}) });
		} else if (record.state === "normal" && record.bounds) {
			normalizeWindowFast(win.id, record.bounds, (ok) => {
				if (ok && focused) safeWindowUpdate(win.id, { focused: true });
			});
		}
	});
}

function rememberStremioSourceState(panelWindowId, sourceWindow, callback) {
	chrome.storage.session.get(STREMIO_SOURCE_STATE_KEY, (result) => {
		const previous = result?.[STREMIO_SOURCE_STATE_KEY];
		if (previous?.panelWindowId === panelWindowId && previous.sourceWindowId === sourceWindow.id) {
			callback(); return;
		}
		// Keep the original state across episode clicks and replacement panels.
		const original = previous?.sourceWindowId === sourceWindow.id ? previous : {
			sourceWindowId: sourceWindow.id,
			state: sourceWindow.state,
			bounds: Object.fromEntries(["left", "top", "width", "height"].map(key => [key, sourceWindow[key]])),
		};
		if (previous && previous.sourceWindowId !== sourceWindow.id) restoreStremioSourceState(previous, false);
		chrome.storage.session.set({ [STREMIO_SOURCE_STATE_KEY]: { ...original, panelWindowId } }, callback);
	});
}

function restoreStremioSourceAfterClose(closedWindowId) {
	if (stremioPlacementJobs.has(closedWindowId)) {
		stremioClosedDuringPlacement.add(closedWindowId); return;
	}
	chrome.storage.session.get(STREMIO_SOURCE_STATE_KEY, (result) => {
		const record = result?.[STREMIO_SOURCE_STATE_KEY];
		if (!record || (record.panelWindowId !== closedWindowId && record.sourceWindowId !== closedWindowId)) return;
		chrome.storage.session.remove(STREMIO_SOURCE_STATE_KEY, () => {
			if (record.panelWindowId === closedWindowId) restoreStremioSourceState(record);
		});
	});
}

function beginStremioPlacement(panelWindowId, sendResponse) {
	stremioPlacementJobs.set(panelWindowId, (stremioPlacementJobs.get(panelWindowId) || 0) + 1);
	return (response) => {
		const remaining = stremioPlacementJobs.get(panelWindowId) - 1;
		if (remaining > 0) stremioPlacementJobs.set(panelWindowId, remaining);
		else {
			stremioPlacementJobs.delete(panelWindowId);
			if (stremioClosedDuringPlacement.delete(panelWindowId)) restoreStremioSourceAfterClose(panelWindowId);
		}
		sendResponse(response);
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

function readLastError() {
	return chrome.runtime.lastError || null;
}

function safeWindowUpdate(windowId, updateInfo, callback) {
	if (!windowId) {
		callback?.(false);
		return;
	}

	chrome.windows.update(windowId, updateInfo, (updatedWindow) => {
		const error = readLastError();
		if (error) {
			callback?.(false, error);
			return;
		}
		callback?.(true, null, updatedWindow);
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
	let attempts = 0;
	const matches = (win) => win?.state === "normal"
		&& ["left", "top", "width", "height"].every((key) => {
			// Width 1 probes the browser's accepted minimum, not a literal 1px window.
			if (key === "width" && wanted.width === 1) return win.width > 0;
			return Number.isFinite(win[key]) && Math.abs(win[key] - wanted[key]) <= 2;
		});
	const retry = (win) => {
		if (attempts >= 5) { callback?.(false, win); return; }
		setTimeout(apply, attempts * 100);
	};
	const apply = () => {
		attempts++;
		chrome.windows.get(windowId, (win) => {
			if (readLastError() || !win) { callback?.(false); return; }
			if (win.state !== "normal") {
				// Restoring a maximized/fullscreen window can finish after update's
				// callback. Read its state again before sending separate bounds.
				safeWindowUpdate(windowId, { state: "normal" }, () => retry(win));
				return;
			}
			if (wanted.width !== 1 && matches(win)) { callback?.(true, win); return; }
			safeWindowUpdate(windowId, wanted, (ok) => {
				if (!ok) { retry(win); return; }
				setTimeout(() => {
					chrome.windows.get(windowId, (settledWindow) => {
						if (readLastError() || !settledWindow) { callback?.(false); return; }
						if (matches(settledWindow)) callback?.(true, settledWindow);
						else retry(settledWindow);
					});
				}, 100);
			});
		});
	};
	apply();
}

function focusStremioWindow(windowId, sendResponse, sourceWindowId, sourceBounds) {
	// Creating/fitting the panel may overlap the source window's native restore.
	// Recheck Trakt at the end too; an already-correct window needs no update.
	normalizeWindowFast(sourceWindowId, sourceBounds, (sourcePlaced) => {
		safeWindowUpdate(windowId, { focused: true }, (ok) => {
			sendResponse({ ok: !!ok && !!sourcePlaced, windowId });
		});
	});
}

function createStremioPopup(url, layout, sender, sendResponse) {
	chrome.storage.local.get(STREMIO_MIN_WIDTH_KEY, (stored) => {
		const knownWidth = Number(stored?.[STREMIO_MIN_WIDTH_KEY]);
		const initial = getPopupLayout(layout.displayBounds, Number.isFinite(knownWidth) && knownWidth > 0 ? knownWidth : 1);
		chrome.windows.create(
			{
				url,
				type: "normal",
				state: "normal",
				left: initial.popup.left,
				top: layout.popup.top,
				width: layout.popup.width,
				height: layout.popup.height,
				// Fit behind Trakt before restoring it: no grey panel flashing on the left.
				focused: false,
			},
			(newWindow) => {
				if (chrome.runtime.lastError || !newWindow?.id) {
					sendResponse({ ok: false });
					return;
				}

				sendResponse = beginStremioPlacement(newWindow.id, sendResponse);
				saveWindowId(newWindow.id);
				chrome.storage.local.set({ [STREMIO_MIN_WIDTH_KEY]: newWindow.width });
				const fittedLayout = getPopupLayout(layout.displayBounds, newWindow.width);
				rememberStremioSourceState(newWindow.id, layout.sourceWindow, () => {
					normalizeWindowFast(newWindow.id, fittedLayout.popup, () => {
						normalizeWindowFast(sender?.tab?.windowId, fittedLayout.trakt, () => {
							focusStremioWindow(newWindow.id, sendResponse, sender?.tab?.windowId, fittedLayout.trakt);
						});
					});
				});
			}
		);
	});
}

function moveAndReuseStremioPopup(existingWindow, url, layout, sender, sendResponse) {
	sendResponse = beginStremioPlacement(existingWindow.id, sendResponse);
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
							focusStremioWindow(existingWindow.id, sendResponse, sender?.tab?.windowId, layout.trakt);
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
							focusStremioWindow(existingWindow.id, sendResponse, sender?.tab?.windowId, layout.trakt);
						});
					});
				}
			});
		});
	};

	// Windows/Vivaldi decide the minimum outer width. Measure it rather than
	// reserving a guessed 560-610 pixels, then give the remaining space to Trakt.
	rememberStremioSourceState(existingWindow.id, layout.sourceWindow, () => normalizeWindowFast(existingWindow.id, {
		...layout.popup, left: existingWindow.left, width: 1,
	}, (ok, minimumWindow) => {
		if (!ok) {
			sendResponse({ ok: false });
			return;
		}
		layout = {
			...layout,
			...getPopupLayout(layout.displayBounds, minimumWindow?.width || existingWindow.width),
			displayBounds: layout.displayBounds,
		};
		chrome.storage.local.set({ [STREMIO_MIN_WIDTH_KEY]: minimumWindow?.width || existingWindow.width });
		openAfterPreLayout();
	}));
}

function openOrReuseStremioWindow(url, layout, sender, sendResponse) {
	chrome.windows.get(sender?.tab?.windowId, (sourceWindow) => {
		if (readLastError() || !sourceWindow) { sendResponse({ ok: false }); return; }
		layout = { ...layout, sourceWindow };
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
	});
}

const externalRatingsCache = new Map();

function getTraktExternalRatings(pathname, seasonsOnly = false) {
	const resultKey = seasonsOnly ? 'seasons' : 'ratings';
	const apiUrl = seasonsOnly ? getSeasonRatingsUrl(pathname) : getTraktApiRatingsUrl(pathname);
	if (!apiUrl) return Promise.resolve({ [resultKey]: null, retryable: false });
	const cached = externalRatingsCache.get(apiUrl);
	if (cached && cached.expiresAt > Date.now()) return cached.promise;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRAKT_LOOKUP_TIMEOUT_MS);
	const entry = { expiresAt: Infinity, promise: null };
	entry.promise = (async () => {
		try {
			const response = await fetch(apiUrl, {
				signal: controller.signal, credentials: 'omit',
				headers: { 'trakt-api-key': TRAKT_API_CLIENT_ID, 'trakt-api-version': '2' },
			});
			if (!response.ok) throw new Error(`Trakt ratings: ${response.status}`);
			const body = await response.json();
			const rating = seasonsOnly ? parseSeasonRatings(body) : findExternalRatingsInTraktResponse(body);
			entry.expiresAt = Date.now() + (rating ? (seasonsOnly ? 3 : 6) * 60 * 60 * 1000 : 5 * 60 * 1000);
			return { [resultKey]: rating, ...(seasonsOnly ? { posters: parseSeasonPosters(body), details: parseSeasonDetails(body) } : {}), retryable: false };
		} catch {
			entry.expiresAt = Date.now() + 1000;
			return { [resultKey]: null, retryable: true };
		} finally {
			clearTimeout(timeout);
		}
	})();
	externalRatingsCache.set(apiUrl, entry);
	if (externalRatingsCache.size > 100) externalRatingsCache.delete(externalRatingsCache.keys().next().value);
	return entry.promise;
}

async function resolveTraktImdbId(pathname) {
	const apiUrl = getTraktApiMediaUrl(pathname);
	if (!apiUrl) return '';
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRAKT_LOOKUP_TIMEOUT_MS);

	try {
		const response = await fetch(apiUrl, {
			signal: controller.signal,
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
	} finally {
		clearTimeout(timeout);
	}
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type === MESSAGE_TYPES.GET_TRAKT_RATINGS || message?.type === MESSAGE_TYPES.GET_SHOW_SEASON_RATINGS) {
		// sender.url can retain the document's initial URL across Trakt's SPA
		// navigation. The browser tab URL tracks the currently displayed fiche.
		const senderUrl = sender?.tab?.url || sender?.url || '';
		if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN) || sender.frameId !== 0
			|| new URL(senderUrl).pathname.replace(/\/$/, '') !== String(message.pathname || '').replace(/\/$/, '')) {
			sendResponse({ ok: false });
			return false;
		}
		getTraktExternalRatings(message.pathname, message.type === MESSAGE_TYPES.GET_SHOW_SEASON_RATINGS)
			.then((result) => sendResponse({ ok: !result.retryable, ...result }));
		return true;
	}

	if (message?.type === MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK) {
		const senderUrl = sender?.tab?.url || sender?.url || '';
		if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN) || sender.frameId !== 0
			|| !sender.tab?.active || !/^\/(movies|shows)\/[^/]+\/?$/.test(new URL(senderUrl).pathname)) {
			sendResponse({ ok: false }); return false;
		}
		const serial = ++soundtrackClaimSerial;
		chrome.tabs.query({ url: `${TRAKT_APP_ORIGIN}/*` }, (tabs) => {
			if (readLastError() || serial !== soundtrackClaimSerial) { sendResponse({ ok: false }); return; }
			const others = (tabs || []).filter(tab => tab.id && tab.id !== sender.tab.id
				&& hasExactOrigin(tab.url, TRAKT_APP_ORIGIN) && /^\/(movies|shows)\/[^/]+\/?$/.test(new URL(tab.url).pathname));
			let remaining = others.length;
			const complete = () => sendResponse({ ok: serial === soundtrackClaimSerial, claimSerial: serial });
			if (!remaining) { complete(); return; }
			for (const tab of others) {
				chrome.tabs.sendMessage(tab.id, { type: MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK, claimSerial: serial },
					{ frameId: 0 }, () => { readLastError(); if (!--remaining) complete(); });
			}
		});
		return true;
	}

	if (message?.type === MESSAGE_TYPES.CLEAR_STREMIO_STREAM_HOVER) {
		const senderUrl = sender?.tab?.url || sender?.url || '';
		if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN) || !Number.isFinite(message.at)) return false;
		getSavedWindowId((windowId) => {
			if (!windowId) return;
			chrome.windows.get(windowId, { populate: true }, (popup) => {
				if (readLastError()) return;
				for (const tab of popup?.tabs || []) {
					if (!tab.id || !isStremioWebUrl(tab.url)) continue;
					if (new URL(tab.url).searchParams.get('wos_stream_panel') !== '1') continue;
					chrome.tabs.sendMessage(tab.id, { type: message.type, at: message.at }, () => { readLastError(); });
				}
			});
		});
		return false;
	}

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

	if (message?.type !== MESSAGE_TYPES.OPEN_STREMIO_WEB || !message.url) return false;
	const senderUrl = sender?.tab?.url || sender?.url || "";
	if (!hasExactOrigin(senderUrl, TRAKT_APP_ORIGIN) || !isStremioWebUrl(message.url)) {
		sendResponse({ ok: false });
		return false;
	}

	getDisplayBoundsForSource(sender, message.screenBounds, (displayBounds) => {
		const layout = { ...getPopupLayout(displayBounds), displayBounds };
		openOrReuseStremioWindow(message.url, layout, sender, sendResponse);
	});

	return true;
});

chrome.windows.onRemoved.addListener((windowId) => {
	restoreStremioSourceAfterClose(windowId);
	getSavedWindowId((savedWindowId) => {
		if (savedWindowId === windowId) forgetWindowId();
	});
});
