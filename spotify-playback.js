(() => {
	'use strict';
	function createPlaybackMonitor(graceMs = 12000) {
		let startedAt = null; let lastPosition = null; let positionChangedAt = null; let lastAdvanceAt = null; let lastDuration = null; let ended = false;
		function reset() { startedAt = lastPosition = positionChangedAt = lastAdvanceAt = lastDuration = null; ended = false; }
		function sample({ state, position, duration, now }) {
			if (ended) return 'ended';
			if (state !== 'playing') {
				// Spotify often switches to Play and resets the slider to zero at EOF.
				// Require recent real progress near the end, and enough elapsed time;
				// a failed start, ordinary pause or seek must not finish a song.
				const remaining = lastDuration - lastPosition;
				if (state === 'paused' && lastAdvanceAt !== null && lastDuration > 0
					&& remaining >= 0 && remaining <= 6500 && now - lastAdvanceAt >= Math.max(0, remaining - 250)
					&& Number.isFinite(position) && (position === 0 || position >= lastDuration)) {
					ended = true; return 'ended';
				}
				reset(); return state;
			}
			if (startedAt === null) startedAt = now;
			if (Number.isFinite(position) && position >= 0) {
				if (lastPosition !== null && positionChangedAt !== null) {
					const delta = position - lastPosition;
					// A seek alone is not evidence that audio is advancing.
					if (delta < 0 || delta > Math.max(4000, now - positionChangedAt + 1500)) {
						startedAt = now; lastAdvanceAt = null;
					} else if (delta > 0) lastAdvanceAt = now;
				}
				if (position !== lastPosition) positionChangedAt = now;
				lastPosition = position;
				if (Number.isFinite(duration) && duration > 0) lastDuration = duration;
				if (lastAdvanceAt !== null && lastDuration > 0 && position >= lastDuration) { ended = true; return 'ended'; }
			}
			if (now - (lastAdvanceAt ?? startedAt) >= graceMs) return 'stalled';
			return lastAdvanceAt === null ? 'buffering' : 'playing';
		}
		return Object.freeze({ sample, reset });
	}
	const api = Object.freeze({ createPlaybackMonitor });
	globalThis.CineTraktSpotifyPlayback = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
