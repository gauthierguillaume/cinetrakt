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
		const rating = normalizeRating(value);
		if (rating === null) return null;
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

	function calculateAverage(values) {
		const ratings = values.map(normalizeRating).filter((rating) => rating !== null);
		if (!ratings.length) return null;
		return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
	}

	globalThis.CineTraktRatingsTable = Object.freeze({
		COLORS,
		normalizeRating,
		getStyleForRating,
		formatRating,
		calculateAverage,
	});
})();
