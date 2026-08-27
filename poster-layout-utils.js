(() => {
	'use strict';

	const MIN_BOOTSTRAP_VIEWPORT_WIDTH = 1160;
	const MIN_STICKY_RIGHT_CONTENT_WIDTH = 840;
	const STICKY_RIGHT_PADDING = 12;

	function getViewportWidth(...values) {
		const widths = values.filter((value) => Number.isFinite(value) && value > 0);
		return widths.length ? Math.floor(Math.min(...widths)) : 0;
	}

	function canBootstrapStickyLayout(viewportWidth) {
		return Number(viewportWidth) >= MIN_BOOTSTRAP_VIEWPORT_WIDTH;
	}

	function getRightContentWidth(viewportWidth, contentLeft) {
		return Math.max(0, Math.floor(Number(viewportWidth) - Number(contentLeft) - STICKY_RIGHT_PADDING));
	}

	function getRightListInnerWidth(viewportWidth, contentLeft) {
		return getRightContentWidth(viewportWidth, contentLeft);
	}

	function canUseStickyLayout(viewportWidth, contentLeft) {
		return canBootstrapStickyLayout(viewportWidth)
			&& getRightContentWidth(viewportWidth, contentLeft) >= MIN_STICKY_RIGHT_CONTENT_WIDTH;
	}

	const api = Object.freeze({
		MIN_BOOTSTRAP_VIEWPORT_WIDTH,
		MIN_STICKY_RIGHT_CONTENT_WIDTH,
		STICKY_RIGHT_PADDING,
		getViewportWidth,
		canBootstrapStickyLayout,
		getRightContentWidth,
		getRightListInnerWidth,
		canUseStickyLayout,
	});

	globalThis.CineTraktPosterLayoutUtils = api;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
