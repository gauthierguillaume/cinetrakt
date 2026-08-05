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
		const playbackState = getSpotifyPlaybackState();
		if (playbackState === 'unknown' || playbackState === lastPlaybackState) return;
		lastPlaybackState = playbackState;
		window.top.postMessage({
			type: MESSAGE_TYPES.PLAYBACK_STATE,
			embedUrl: window.location.href,
			playbackState,
		}, TRAKT_ORIGIN);
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
			playbackState: getSpotifyPlaybackState(),
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

	function handleSpotifyPlayRequest(event) {
		if (event.origin !== TRAKT_ORIGIN
			|| event.source !== window.top
			|| event.data?.type !== MESSAGE_TYPES.PLAY_REQUEST) return;

		const control = findSpotifyPlaybackControl();
		if (!control || getSpotifyPlaybackState() !== 'paused') {
			publishSpotifyPlaybackState();
			return;
		}

		control.click();
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
		scheduleSpotifyMetadataPublish(250);
	});
})();
