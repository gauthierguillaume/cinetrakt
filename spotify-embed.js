(() => {
	if (window.top === window) return;

	const {
		MESSAGE_TYPES,
		SPOTIFY_ORIGIN,
		TRAKT_ORIGIN,
	} = globalThis.CineTraktSpotifyProtocol;
	let lastPayloadKey = '';
	let lastPlaybackState = '';
	let publishTimer = null;
	let backgroundPlaybackAllowed = document.visibilityState === 'visible';
	const playbackMonitor = globalThis.CineTraktSpotifyPlayback.createPlaybackMonitor();
	let healthTimer = null;
	let restartTimer = null;
	let manualPause = false;
	let userInitiatedPause = false;
	let pendingPlay = false;
	let playRetryTimer = null;
	let playAttemptCount = 0;
	const MAX_START_ATTEMPTS = 4;

	function cancelSpotifyStartRetries() {
		pendingPlay = false;
		window.clearTimeout(playRetryTimer); playRetryTimer = null;
	}

	function startPendingSpotifyPlayback() {
		if (!pendingPlay || manualPause || (document.visibilityState !== 'visible' && !backgroundPlaybackAllowed) || playRetryTimer !== null) return;
		const control = findSpotifyPlaybackControl();
		const state = getSpotifyPlaybackState();
		if (!control || state === 'unknown') return;
		if (state === 'playing' || playAttemptCount >= MAX_START_ATTEMPTS) {
			cancelSpotifyStartRetries(); return;
		}
		playAttemptCount++;
		control.click();
		// The controls can mount before Spotify accepts play commands. Keep the
		// request alive briefly, without letting duplicate parent messages rush it.
		playRetryTimer = window.setTimeout(() => {
			playRetryTimer = null;
			startPendingSpotifyPlayback();
			scheduleSpotifyMetadataPublish(0);
		}, 1000 * (2 ** (playAttemptCount - 1)));
	}

	function getObservedSpotifyPlaybackState() {
		const progress = document.querySelector('input[type="range"][max]');
		const state = playbackMonitor.sample({ state: getSpotifyPlaybackState(),
			position: progress ? Number(progress.value) : null,
			duration: progress ? Number(progress.max) : null, now: Date.now() });
		// Chromium can suspend Spotify's visual progress updates in a hidden
		// frame while audio keeps playing. A frozen slider there is not a stall.
		if (state === 'stalled' && document.visibilityState !== 'visible' && backgroundPlaybackAllowed) {
			return lastPlaybackState === 'playing' ? 'playing' : 'buffering';
		}
		return state;
	}

	function findSpotifyPlaybackControl() {
		return document.querySelector('button[data-testid="play-pause-button"]')
			|| Array.from(document.querySelectorAll('button[aria-label]')).find((button) => {
				return /play|pause|lecture|lire|reprendre|mettre en pause|ecouter|pausar|pausieren|abspielen/i
					.test(button.getAttribute('aria-label') || '');
			}) || null;
	}

	function getSpotifyPlaybackState() {
		const control = findSpotifyPlaybackControl();
		if (!control) return 'unknown';
		const label = (control.getAttribute('aria-label') || '').trim();
		if (/pause|mettre en pause|pausar|pausieren/i.test(label)) return 'playing';
		if (/play|lecture|lire|reprendre|ecouter|abspielen/i.test(label)) return 'paused';
		return 'unknown';
	}

	function publishSpotifyPlaybackState() {
		window.clearTimeout(healthTimer); healthTimer = null;
		if (manualPause && getSpotifyPlaybackState() === 'playing') { pauseSpotifyPlayback(); return; }
		if (document.visibilityState !== 'visible' && !backgroundPlaybackAllowed && getSpotifyPlaybackState() === 'playing') {
			pauseSpotifyPlayback();
			return;
		}
		const playbackState = getObservedSpotifyPlaybackState();
		if (playbackState === 'playing' && !userInitiatedPause) manualPause = false;
		if (getSpotifyPlaybackState() === 'playing') healthTimer = window.setTimeout(publishSpotifyPlaybackState, 1000);
		if (playbackState === 'unknown' || playbackState === lastPlaybackState) return;
		lastPlaybackState = playbackState;
		window.top.postMessage({
			type: MESSAGE_TYPES.PLAYBACK_STATE,
			embedUrl: window.location.href,
			playbackState,
			userInitiated: userInitiatedPause && playbackState === 'paused',
		}, TRAKT_ORIGIN);
		userInitiatedPause = false;
	}

	function getLargestSpotifyCover() {
		return Array.from(document.images)
			.filter((image) => {
				const source = image.currentSrc || image.src;
				return source
					&& image.naturalWidth >= 64
					&& image.naturalHeight >= 64;
			})
			.sort((first, second) => {
				const firstArea = first.getBoundingClientRect().width * first.getBoundingClientRect().height;
				const secondArea = second.getBoundingClientRect().width * second.getBoundingClientRect().height;
				return secondArea - firstArea;
			})[0] || null;
	}

	function getSpotifyLinkText(pathType) {
		return Array.from(document.querySelectorAll(`a[href*="open.spotify.com/${pathType}/"]`))
			.map((link) => link.textContent?.trim() || '')
			.find(Boolean) || '';
	}

	function publishSpotifyMetadata() {
		publishTimer = null;
		startPendingSpotifyPlayback();
		publishSpotifyPlaybackState();
		const cover = getLargestSpotifyCover();
		const coverUrl = cover?.currentSrc || cover?.src || '';
		const title = getSpotifyLinkText('track') || getSpotifyLinkText('episode');
		const artist = getSpotifyLinkText('artist') || getSpotifyLinkText('show');
		if (!coverUrl || !title || !artist) return;

		const payload = {
			type: MESSAGE_TYPES.METADATA,
			embedUrl: window.location.href,
			coverUrl,
			title,
			artist,
			playbackState: getObservedSpotifyPlaybackState(),
		};
		const payloadKey = `${coverUrl}|${title}|${artist}`;
		if (payloadKey === lastPayloadKey) return;
		lastPayloadKey = payloadKey;
		window.top.postMessage(payload, TRAKT_ORIGIN);
	}

	function scheduleSpotifyMetadataPublish(delay = 80) {
		window.clearTimeout(publishTimer);
		publishTimer = window.setTimeout(publishSpotifyMetadata, delay);
	}

	function pauseSpotifyPlayback() {
		playbackMonitor.reset();
		cancelSpotifyStartRetries();
		playAttemptCount = 0;
		window.clearTimeout(restartTimer); restartTimer = null;
		if (getSpotifyPlaybackState() === 'playing') findSpotifyPlaybackControl()?.click();
	}

	function handleSpotifyPlayRequest(event) {
		if (event.origin !== TRAKT_ORIGIN
			|| event.source !== window.top
			|| ![MESSAGE_TYPES.PLAY_REQUEST, MESSAGE_TYPES.PAUSE_REQUEST].includes(event.data?.type)) return;
		if (event.data.type === MESSAGE_TYPES.PAUSE_REQUEST) {
			if (event.data.userInitiated) manualPause = true;
			backgroundPlaybackAllowed = false;
			pauseSpotifyPlayback();
			scheduleSpotifyMetadataPublish(0);
			return;
		}
		if (document.visibilityState !== 'visible' && event.data.continueInBackground !== true) return;
		if (manualPause && !event.data.userInitiated) return;
		if (event.data.userInitiated) {
			manualPause = false;
			cancelSpotifyStartRetries(); playAttemptCount = 0;
		}
		backgroundPlaybackAllowed = true;
		if (lastPlaybackState === 'ended') playbackMonitor.reset();
		pendingPlay = true;

		const control = findSpotifyPlaybackControl();
		if (control && getSpotifyPlaybackState() === 'playing' && getObservedSpotifyPlaybackState() === 'stalled' && restartTimer === null) {
			cancelSpotifyStartRetries();
			control.click();
			restartTimer = window.setTimeout(() => {
				restartTimer = null;
				if (!manualPause && backgroundPlaybackAllowed && getSpotifyPlaybackState() === 'paused') {
					findSpotifyPlaybackControl()?.click();
				}
				playbackMonitor.reset(); scheduleSpotifyMetadataPublish(0);
			}, 150);
			return;
		}
		startPendingSpotifyPlayback();
		scheduleSpotifyMetadataPublish(100);
		window.setTimeout(() => scheduleSpotifyMetadataPublish(0), 500);
	}

	globalThis.CineTraktSettings.ready.then(() => {
		if (!globalThis.CineTraktSettings.isEnabled('traktSoundtrack')) return;
		window.top.postMessage({
			type: MESSAGE_TYPES.READY,
			embedUrl: window.location.href,
		}, TRAKT_ORIGIN);

		const observer = new MutationObserver(() => scheduleSpotifyMetadataPublish());
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['alt', 'aria-label', 'data-testid', 'href', 'src'],
			characterData: true,
			childList: true,
			subtree: true,
		});

		document.addEventListener('DOMContentLoaded', () => scheduleSpotifyMetadataPublish(0));
		window.addEventListener('load', () => scheduleSpotifyMetadataPublish(0));
		window.addEventListener('message', handleSpotifyPlayRequest);
		document.addEventListener('click', (event) => {
			if (!event.isTrusted || event.target?.closest?.('button') !== findSpotifyPlaybackControl()) return;
			manualPause = getSpotifyPlaybackState() === 'playing';
			if (manualPause) backgroundPlaybackAllowed = false;
			if (manualPause || lastPlaybackState === 'ended') playbackMonitor.reset();
			userInitiatedPause = manualPause;
			cancelSpotifyStartRetries(); playAttemptCount = 0;
			window.top.postMessage({ type: MESSAGE_TYPES.PLAYBACK_STATE, embedUrl: window.location.href,
				playbackState: manualPause ? 'paused' : 'buffering', userInitiated: true }, TRAKT_ORIGIN);
			if (manualPause) {
				window.clearTimeout(restartTimer); restartTimer = null;
			}
		}, true);
		window.addEventListener('pagehide', () => {
			cancelSpotifyStartRetries(); window.clearTimeout(healthTimer); window.clearTimeout(restartTimer);
		});
		document.addEventListener('visibilitychange', () => {
			backgroundPlaybackAllowed = backgroundPlaybackAllowed || document.visibilityState === 'visible' || getSpotifyPlaybackState() === 'playing';
			// Give the visual timer a fresh grace period after returning to a tab.
			if (document.visibilityState === 'visible') playbackMonitor.reset();
			scheduleSpotifyMetadataPublish(0);
		});
		if (document.visibilityState !== 'visible') pauseSpotifyPlayback();
		scheduleSpotifyMetadataPublish(250);
	});
})();
