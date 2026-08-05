(() => {
	'use strict';

	const IMDB_RATINGS_MIN_WIDTH = 500;
	const IMDB_RATINGS_MIN_HEIGHT = 300;
	const IMDB_RATINGS_SCREEN_MARGIN = 40;
	const POPUP_MIN_WIDTH = 560;
	const POPUP_MAX_WIDTH = 760;
	const POPUP_DEFAULT_WIDTH = 610;
	const SOURCE_MIN_WIDTH = 900;
	const WINDOW_SEAM_OVERLAP = 15;
	const SNAP_EDGE_LEFT_FIX = -7;
	const SNAP_EDGE_TOP_FIX = -6;
	const SNAP_EDGE_RIGHT_FIX = 8;
	const SNAP_EDGE_BOTTOM_FIX = 8;
	const POPUP_INNER_RIGHT_FIX = 1;

	function clampNumber(value, min, max) {
		const lower = Math.min(min, max);
		const upper = Math.max(min, max);
		return Math.max(lower, Math.min(upper, value));
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
			const score = getIntersectionArea(sourceBounds, {
				left: area.left,
				top: area.top,
				width: area.width,
				height: area.height,
			});
			if (score > bestScore) {
				bestScore = score;
				bestDisplay = display;
			}
		}

		if (bestScore > 0) return bestDisplay;
		const center = getWindowCenter(sourceBounds);
		return displays.find((display) => {
			const area = display.workArea || display.bounds;
			return center.x >= area.left
				&& center.x < area.left + area.width
				&& center.y >= area.top
				&& center.y < area.top + area.height;
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

	function getPopupLayout(displayBounds) {
		const rawWidth = Math.max(1, Math.round(Number(displayBounds.width) || 1920));
		const rawHeight = Math.max(1, Math.round(Number(displayBounds.height) || 1080));
		const rawLeft = Math.round(Number(displayBounds.left) || 0);
		const rawTop = Math.round(Number(displayBounds.top) || 0);
		const left = rawLeft + SNAP_EDGE_LEFT_FIX;
		const top = rawTop + SNAP_EDGE_TOP_FIX;
		const width = rawWidth + Math.abs(SNAP_EDGE_LEFT_FIX) + SNAP_EDGE_RIGHT_FIX;
		const height = rawHeight + Math.abs(SNAP_EDGE_TOP_FIX) + SNAP_EDGE_BOTTOM_FIX;
		const maxPopupWidth = Math.max(1, Math.min(POPUP_MAX_WIDTH, Math.floor(width * 0.36)));
		const minPopupWidth = Math.min(POPUP_MIN_WIDTH, maxPopupWidth);
		const popupWidth = clampNumber(POPUP_DEFAULT_WIDTH, minPopupWidth, maxPopupWidth);
		const seamOverlap = Math.min(WINDOW_SEAM_OVERLAP, Math.max(0, width - popupWidth - SOURCE_MIN_WIDTH));

		return {
			trakt: {
				left,
				top,
				width: Math.max(1, width - popupWidth + seamOverlap),
				height,
			},
			popup: {
				left: left + width - popupWidth,
				top,
				width: Math.max(1, popupWidth - POPUP_INNER_RIGHT_FIX),
				height,
			},
		};
	}

	function getImdbRatingsPopupLayout(displayBounds) {
		const displayWidth = Math.max(1, Math.round(Number(displayBounds.width) || 1920));
		const displayHeight = Math.max(1, Math.round(Number(displayBounds.height) || 1080));
		const width = Math.min(1320, Math.max(1, displayWidth - IMDB_RATINGS_SCREEN_MARGIN * 2));
		const height = Math.min(900, Math.max(1, displayHeight - IMDB_RATINGS_SCREEN_MARGIN * 2));
		return {
			left: Math.round(Number(displayBounds.left) || 0) + Math.floor((displayWidth - width) / 2),
			top: Math.round(Number(displayBounds.top) || 0) + Math.floor((displayHeight - height) / 2),
			width,
			height,
		};
	}

	function getResizedImdbRatingsPopupLayout(displayBounds, requestedWidth, requestedHeight) {
		const displayWidth = Math.max(1, Math.round(Number(displayBounds.width) || 1920));
		const displayHeight = Math.max(1, Math.round(Number(displayBounds.height) || 1080));
		const maxWidth = Math.max(1, displayWidth - IMDB_RATINGS_SCREEN_MARGIN * 2);
		const maxHeight = Math.max(1, displayHeight - IMDB_RATINGS_SCREEN_MARGIN * 2);
		const width = clampNumber(
			Math.round(Number(requestedWidth) || Math.min(IMDB_RATINGS_MIN_WIDTH, maxWidth)),
			Math.min(IMDB_RATINGS_MIN_WIDTH, maxWidth),
			maxWidth,
		);
		const height = clampNumber(
			Math.round(Number(requestedHeight) || Math.min(IMDB_RATINGS_MIN_HEIGHT, maxHeight)),
			Math.min(IMDB_RATINGS_MIN_HEIGHT, maxHeight),
			maxHeight,
		);

		return {
			left: Math.round(Number(displayBounds.left) || 0) + Math.floor((displayWidth - width) / 2),
			top: Math.round(Number(displayBounds.top) || 0) + Math.floor((displayHeight - height) / 2),
			width,
			height,
		};
	}

	const api = Object.freeze({
		clampNumber,
		pickBestDisplayForWindow,
		getFallbackDisplayBounds,
		getPopupLayout,
		getImdbRatingsPopupLayout,
		getResizedImdbRatingsPopupLayout,
	});
	globalThis.CineTraktWindowLayout = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
