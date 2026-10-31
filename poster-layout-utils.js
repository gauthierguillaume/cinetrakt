(() => {
	'use strict';

	const MIN_BOOTSTRAP_VIEWPORT_WIDTH = 1024;
	const MIN_STICKY_RIGHT_CONTENT_WIDTH = 360;
	// Native outer inset (24px) plus the trailing list gap (12px).
	const STICKY_RIGHT_PADDING = 36;

	function getPosterAspectRatio(image) {
		// Native geometry is available before the image bytes arrive. Loading a
		// larger version of the same poster must never delay or resize the rail.
		const rect = image?.getBoundingClientRect?.();
		if (rect?.width > 0 && rect?.height > 0) return rect.width / rect.height;
		for (const [width, height] of [[image?.width, image?.height], [image?.naturalWidth, image?.naturalHeight]]) {
			if (width > 0 && height > 0) return width / height;
		}
		return 2 / 3;
	}

	function getDetailedPosterUrl(source) {
		try {
			const url = new URL(source);
			if (url.origin !== 'https://media.trakt.tv' || url.search || url.hash || url.username || url.password
				|| !/^\/images\/(movies|shows)\/\d{3}\/\d{3}\/\d{3}\/posters\/(thumb|medium|original)\/[a-z0-9_.-]+$/i.test(url.pathname)) return '';
			// Only use sizes Trakt actually supplies. An "original" URL cannot be
			// invented from medium: some current CDN images have no such variant.
			url.pathname = url.pathname.replace('/thumb/', '/medium/');
			return url.href;
		} catch { return ''; }
	}

	function getViewportWidth(...values) {
		const widths = values.filter((value) => Number.isFinite(value) && value > 0);
		return widths.length ? Math.floor(Math.min(...widths)) : 0;
	}

	function canBootstrapStickyLayout(viewportWidth) {
		return Number(viewportWidth) >= MIN_BOOTSTRAP_VIEWPORT_WIDTH;
	}

	function getRightContentWidth(viewportWidth, contentLeft, sideInset = STICKY_RIGHT_PADDING) {
		return Math.max(0, Math.floor(Number(viewportWidth) - Number(contentLeft) - sideInset));
	}

	function getStickyPosterSize(viewportWidth, posterLeft, availableHeight, imageRatio, sideGap = STICKY_RIGHT_PADDING, sideInset = STICKY_RIGHT_PADDING) {
		const maximumWidth = Math.max(1, viewportWidth - posterLeft - sideGap
			- sideInset - MIN_STICKY_RIGHT_CONTENT_WIDTH);
		const width = Math.max(1, Math.min(Math.floor(availableHeight * imageRatio), Math.floor(maximumWidth)));
		return { width, height: Math.min(Math.floor(availableHeight), Math.floor(width / imageRatio)) };
	}

	function canUseStickyLayout(viewportWidth, contentLeft, sideInset = STICKY_RIGHT_PADDING) {
		return canBootstrapStickyLayout(viewportWidth)
			&& getRightContentWidth(viewportWidth, contentLeft, sideInset) >= MIN_STICKY_RIGHT_CONTENT_WIDTH;
	}

	const api = Object.freeze({
		MIN_BOOTSTRAP_VIEWPORT_WIDTH,
		MIN_STICKY_RIGHT_CONTENT_WIDTH,
		STICKY_RIGHT_PADDING,
		getPosterAspectRatio,
		getDetailedPosterUrl,
		getViewportWidth,
		canBootstrapStickyLayout,
		getRightContentWidth,
		getStickyPosterSize,
		canUseStickyLayout,
	});

	globalThis.CineTraktPosterLayoutUtils = api;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
