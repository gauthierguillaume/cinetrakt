(() => {
	'use strict';

	const COLORS = Object.freeze({
		1: Object.freeze({ bg: '#ef4444', text: '#ffffff' }),
		2: Object.freeze({ bg: '#ef4444', text: '#ffffff' }),
		3: Object.freeze({ bg: '#ef4444', text: '#ffffff' }),
		4: Object.freeze({ bg: '#f97316', text: '#ffffff' }),
		5: Object.freeze({ bg: '#eab308', text: '#111111' }),
		6: Object.freeze({ bg: '#22c55e', text: '#111111' }),
		7: Object.freeze({ bg: '#3b82f6', text: '#ffffff' }),
		8: Object.freeze({ bg: '#ec4899', text: '#ffffff' }),
		9: Object.freeze({ bg: '#8b5cf6', text: '#ffffff' }),
		10: Object.freeze({ bg: '#ffffff', text: '#111111' }),
	});

	function normalizeRating(value) {
		const rating = Number(value);
		return Number.isFinite(rating) && rating >= 1 && rating <= 10 ? rating : null;
	}

	function getScoreBucket(value) {
		if (value === null || value === undefined || typeof value === 'boolean') return null;
		if (typeof value === 'string' && !value.trim()) return null;
		const rating = Number(value);
		if (!Number.isFinite(rating) || rating < 0 || rating > 10) return null;
		return Math.max(1, Math.min(10, Math.floor(rating)));
	}

	function getStyleForRating(value) {
		const bucket = getScoreBucket(value);
		return bucket === null ? null : COLORS[bucket];
	}

	function formatRating(value) {
		const rating = normalizeRating(value);
		if (rating === null) return '';
		const fixed = rating.toFixed(1);
		return fixed.endsWith('.0') ? String(Math.round(rating)) : fixed;
	}

	function parseDisplayRating(text) {
		const raw = String(text || '').trim().replace(',', '.');
		const match = raw.match(/^(\d+(?:\.\d+)?)(\s*%)?/);
		if (!match) return null;

		const value = Number(match[1]);
		if (!Number.isFinite(value)) return null;
		const rating = match[2] ? value / 10 : value;
		return rating >= 0 && rating <= 10 ? rating : null;
	}

	function getStarFillRatios(value, starCount = 5) {
		const rating = Number(value);
		const count = Number(starCount);
		if (!Number.isFinite(rating) || rating <= 0 || !Number.isInteger(count) || count <= 0) return [];

		const starRating = Math.max(0, Math.min(count, rating / 2));
		return Array.from({ length: count }, (_, index) => {
			const remaining = starRating - index;
			if (remaining >= 1) return 1;
			if (remaining >= 0.5) return 0.5;
			return 0;
		});
	}

	function calculateAverage(values) {
		const ratings = values.map(normalizeRating).filter((rating) => rating !== null);
		if (!ratings.length) return null;
		return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
	}

	const api = Object.freeze({
		COLORS,
		normalizeRating,
		getScoreBucket,
		getStyleForRating,
		formatRating,
		parseDisplayRating,
		getStarFillRatios,
		calculateAverage,
	});

	globalThis.CineTraktRatingUtils = api;

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
