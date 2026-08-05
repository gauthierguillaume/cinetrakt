(() => {
	'use strict';
	const { MESSAGE_TYPES, SPOTIFY_ORIGIN } = globalThis.CineTraktSpotifyProtocol;

	function isCinetraktFeatureEnabled(key) {
		return globalThis.CineTraktSettings?.isEnabled(key) !== false;
	}
/* Soundtrack autoplay and the compact control next to the Trakt logo. */
const CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS = 4;
const CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY = 1300;
const CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT = 30000;
const cinetraktReadySpotifyEmbeds = new WeakSet();
const cinetraktSoundtrackState = {
	routeKey: '',
	status: 'idle',
	discoveryDeadline: 0,
	autoplayAttempted: false,
	autoplaySettled: false,
	autoplayAttemptCount: 0,
	autoplayClickedControl: null,
	selectedTrackKey: '',
	selectedControl: null,
	section: null,
	card: null,
	coverButton: null,
	coverImage: null,
	titleElement: null,
	artistElement: null,
	cardReady: false,
	playbackState: 'paused',
	displayedTrackKey: '',
	displayedCoverUrl: '',
	metadataRequestId: 0,
	soundtrackObserver: null,
	syncTimer: null,
	autoplayTimer: null,
	settleTimer: null,
};

function getCinetraktSoundtrackRouteKey() {
	const match = window.location.pathname.match(/^\/(movies|shows)\/([^/]+)\/?$/);
	return match ? `/${match[1]}/${match[2]}` : '';
}

function findCinetraktSoundtrackSummarySection() {
	return Array.from(document.querySelectorAll('section.trakt-soundtrack-section'))
		.find((section) => !section.closest('.trakt-drawer, .trakt-soundtrack-upsell')) || null;
}

function getCinetraktSoundtrackTrackKey(row) {
	const position = row.querySelector('.row-position')?.textContent?.trim() || '';
	const title = row.querySelector('.row-title')?.textContent?.trim() || '';
	const performer = row.querySelector('.row-performer')?.textContent?.trim() || '';
	return title ? `${position}|${title}|${performer}` : '';
}

function findCinetraktSoundtrackNativeControl(row) {
	if (!row || row.closest('.trakt-soundtrack-upsell') || row.querySelector('.row-unmatched')) return null;

	const control = row.querySelector('button.row-action[type="button"]')
		|| Array.from(row.querySelectorAll('button[type="button"][aria-label]')).find((button) => {
			return /play|pause|ecouter|mettre en pause/i.test(button.getAttribute('aria-label') || '');
		});

	if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return null;
	return control;
}

function isCinetraktSoundtrackControlPlaying(control) {
	if (!control?.isConnected) return false;
	const label = (control.getAttribute('aria-label') || '').trim();
	if (/pause|mettre en pause|pausar|pausieren|pauze|suspend/i.test(label)) return true;
	return !!control.querySelector('svg path[d^="M560-200"]');
}

function createCinetraktSoundtrackTrack(row, fallbackIndex) {
	const control = findCinetraktSoundtrackNativeControl(row);
	const key = getCinetraktSoundtrackTrackKey(row);
	if (!control || !key) return null;

	return {
		index: Number.parseInt(row.querySelector('.row-position')?.textContent || '', 10) || fallbackIndex,
		key,
		title: row.querySelector('.row-title')?.textContent?.trim() || '',
		artist: row.querySelector('.row-performer')?.textContent?.trim() || '',
		row,
		control,
	};
}

function collectCinetraktPlayableSummaryTracks(section = cinetraktSoundtrackState.section) {
	if (!section?.isConnected) return [];

	const tracks = [];
	const seenKeys = new Set();
	for (const row of section.querySelectorAll('.trakt-soundtrack-row')) {
		if (row.hidden || row.getAttribute('aria-hidden') === 'true' || row.getClientRects().length === 0) continue;
		const track = createCinetraktSoundtrackTrack(row, tracks.length + 1);
		if (!track || seenKeys.has(track.key)) continue;
		seenKeys.add(track.key);
		tracks.push(track);
	}
	return tracks;
}

function collectCinetraktControllableSoundtrackTracks() {
	const tracks = [];
	const seenControls = new Set();
	for (const row of document.querySelectorAll('.trakt-soundtrack-row')) {
		const track = createCinetraktSoundtrackTrack(row, tracks.length + 1);
		if (!track || seenControls.has(track.control)) continue;
		seenControls.add(track.control);
		tracks.push(track);
	}
	return tracks;
}

function findCinetraktActiveSoundtrackTrack(tracks = collectCinetraktControllableSoundtrackTracks()) {
	return tracks.find((track) => isCinetraktSoundtrackControlPlaying(track.control))
		|| tracks.find((track) => track.row.classList.contains('is-playing'))
		|| null;
}

function injectCinetraktSoundtrackCardStyles() {
	if (document.getElementById('cinetrakt-soundtrack-card-style')) return;

	const style = document.createElement('style');
	style.id = 'cinetrakt-soundtrack-card-style';
	style.textContent = `
		.trakt-side-navbar.cinetrakt-soundtrack-card-mounted {
			justify-content: flex-start !important;
		}

		.trakt-side-navbar.cinetrakt-soundtrack-card-mounted > .trakt-side-navbar-bottom {
			margin-top: auto;
		}

		.cinetrakt-soundtrack-card {
			box-sizing: border-box;
			color: rgba(255, 255, 255, 0.92);
			flex: 0 0 auto;
			margin: 0 8px;
			min-width: 0;
			width: calc(100% - 16px);
		}

		.cinetrakt-soundtrack-card[hidden] {
			display: none !important;
		}

		.cinetrakt-soundtrack-cover-button {
			aspect-ratio: 1;
			background: rgba(255, 255, 255, 0.06);
			border: 0;
			border-radius: 6px;
			box-shadow: none;
			cursor: pointer;
			display: block;
			overflow: hidden;
			padding: 0;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button:focus-visible {
			outline: 2px solid var(--purple-500, #8b5cf6);
			outline-offset: 2px;
		}

		.cinetrakt-soundtrack-cover {
			display: block;
			height: 100%;
			object-fit: cover;
			opacity: 1;
			transition: opacity 120ms ease;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button:hover .cinetrakt-soundtrack-cover {
			opacity: 0.86;
		}

		.cinetrakt-soundtrack-title,
		.cinetrakt-soundtrack-artist {
			display: -webkit-box;
			overflow: hidden;
			padding: 0 2px;
			text-overflow: ellipsis;
			-webkit-box-orient: vertical;
		}

		.cinetrakt-soundtrack-title {
			font-size: 14px;
			font-weight: 700;
			line-height: 1.3;
			margin: 9px 0 0;
			-webkit-line-clamp: 2;
		}

		.cinetrakt-soundtrack-artist {
			color: rgba(255, 255, 255, 0.62);
			font-size: 12px;
			font-weight: 400;
			line-height: 1.35;
			margin: 3px 0 0;
			-webkit-line-clamp: 1;
		}
	`;
	document.head.appendChild(style);
}

function createCinetraktSoundtrackCard() {
	const card = document.createElement('div');
	card.className = 'cinetrakt-soundtrack-card';
	card.hidden = true;

	const coverButton = document.createElement('button');
	coverButton.type = 'button';
	coverButton.className = 'cinetrakt-soundtrack-cover-button';
	coverButton.setAttribute('aria-label', 'Play soundtrack');
	coverButton.setAttribute('aria-pressed', 'false');
	coverButton.title = 'Play soundtrack';

	const coverImage = document.createElement('img');
	coverImage.className = 'cinetrakt-soundtrack-cover';
	coverImage.alt = '';
	coverImage.draggable = false;
	coverButton.appendChild(coverImage);

	const titleElement = document.createElement('p');
	titleElement.className = 'cinetrakt-soundtrack-title';
	const artistElement = document.createElement('p');
	artistElement.className = 'cinetrakt-soundtrack-artist';

	card.append(coverButton, titleElement, artistElement);
	coverButton.addEventListener('click', toggleCinetraktSoundtrackPlayback);
	Object.assign(cinetraktSoundtrackState, { card, coverButton, coverImage, titleElement, artistElement });
	return card;
}

function ensureCinetraktSoundtrackCardPlacement() {
	const sidebar = document.querySelector('.trakt-side-navbar');
	const top = sidebar?.querySelector(':scope > .trakt-side-navbar-top');
	const content = sidebar?.querySelector(':scope > .trakt-side-navbar-content');
	if (!sidebar || !top || !content) return null;

	if (!cinetraktSoundtrackState.card) {
		injectCinetraktSoundtrackCardStyles();
		createCinetraktSoundtrackCard();
	}

	for (const duplicate of document.querySelectorAll('.cinetrakt-soundtrack-card')) {
		if (duplicate !== cinetraktSoundtrackState.card) duplicate.remove();
	}
	if (cinetraktSoundtrackState.card.parentElement !== sidebar
		|| cinetraktSoundtrackState.card.previousElementSibling !== top) {
		sidebar.insertBefore(cinetraktSoundtrackState.card, content);
	}

	const visible = cinetraktSoundtrackState.cardReady && top.classList.contains('is-expanded');
	sidebar.classList.toggle('cinetrakt-soundtrack-card-mounted', visible);
	cinetraktSoundtrackState.card.hidden = !visible;
	return cinetraktSoundtrackState.card;
}

function updateCinetraktSoundtrackPlaybackState(nextState) {
	if (nextState === cinetraktSoundtrackState.playbackState) return;
	cinetraktSoundtrackState.playbackState = nextState;
	const playing = nextState === 'playing';
	const label = playing ? 'Pause soundtrack' : 'Play soundtrack';
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-label', label);
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-pressed', playing ? 'true' : 'false');
	if (cinetraktSoundtrackState.coverButton) cinetraktSoundtrackState.coverButton.title = label;
}

function normalizeCinetraktSpotifyEntityUrl(value) {
	if (!value) return '';
	try {
		const url = new URL(value, window.location.href);
		const pathMatch = url.pathname.match(/^\/(?:embed\/)?(track|episode|album)\/([A-Za-z0-9]+)/);
		if (pathMatch) return `https://open.spotify.com/${pathMatch[1]}/${pathMatch[2]}`;

		const uriMatch = (url.searchParams.get('uri') || '').match(/^spotify:(track|episode|album):([A-Za-z0-9]+)$/);
		return uriMatch ? `https://open.spotify.com/${uriMatch[1]}/${uriMatch[2]}` : '';
	} catch (_error) {
		return '';
	}
}

function preloadCinetraktSoundtrackCover(url) {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(url);
		image.onerror = reject;
		image.src = url;
	});
}

function isCinetraktSpotifyCoverUrl(value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:'
			&& (url.hostname === 'i.scdn.co' || url.hostname.endsWith('.spotifycdn.com'));
	} catch (_error) {
		return false;
	}
}

async function applyCinetraktSpotifyEmbedMetadata(track, metadata) {
	const coverUrl = typeof metadata.coverUrl === 'string' ? metadata.coverUrl : '';
	const title = typeof metadata.title === 'string' ? metadata.title.trim().slice(0, 300) : '';
	const artist = typeof metadata.artist === 'string' ? metadata.artist.trim().slice(0, 300) : '';
	if (!track || !isCinetraktSpotifyCoverUrl(coverUrl) || !title || !artist) return;
	if (track.key === cinetraktSoundtrackState.displayedTrackKey
		&& coverUrl === cinetraktSoundtrackState.displayedCoverUrl) return;

	const requestId = ++cinetraktSoundtrackState.metadataRequestId;
	try {
		await preloadCinetraktSoundtrackCover(coverUrl);
		if (requestId !== cinetraktSoundtrackState.metadataRequestId
			|| track.key !== cinetraktSoundtrackState.selectedTrackKey
			|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()) return;

		cinetraktSoundtrackState.coverImage.src = coverUrl;
		cinetraktSoundtrackState.titleElement.textContent = title;
		cinetraktSoundtrackState.artistElement.textContent = artist;
		cinetraktSoundtrackState.displayedTrackKey = track.key;
		cinetraktSoundtrackState.displayedCoverUrl = coverUrl;
		cinetraktSoundtrackState.cardReady = true;
		ensureCinetraktSoundtrackCardPlacement();
		if (isCinetraktFeatureEnabled('traktSoundtrackAutoplay')
			&& !cinetraktSoundtrackState.autoplaySettled) {
			scheduleCinetraktSoundtrackAutoplayAttempt(80);
		}
	} catch (_error) {
		// Keep the card hidden rather than showing metadata that does not match the iframe.
	}
}

function handleCinetraktSpotifyEmbedMessage(event) {
	if (event.origin !== SPOTIFY_ORIGIN
		|| ![
			MESSAGE_TYPES.READY,
			MESSAGE_TYPES.METADATA,
			MESSAGE_TYPES.PLAYBACK_STATE,
		].includes(event.data?.type)) return;

	const iframe = Array.from(document.querySelectorAll('iframe[src*="open.spotify.com/embed/"]'))
		.find((candidate) => candidate.contentWindow === event.source);
	if (!iframe) return;
	cinetraktReadySpotifyEmbeds.add(iframe);
	if (event.data.type === MESSAGE_TYPES.READY) {
		scheduleCinetraktSoundtrackSync(0);
		if (isCinetraktFeatureEnabled('traktSoundtrackAutoplay')) {
			scheduleCinetraktSoundtrackAutoplayAttempt(0);
		}
		return;
	}

	const track = resolveCinetraktSoundtrackControl();
	const soundtrackScope = track?.row.closest('section.trakt-soundtrack-section');
	if (!track || !soundtrackScope?.contains(iframe)) return;

	if (event.data.playbackState === 'playing') {
		completeCinetraktSoundtrackAutoplay('playing');
	} else if (event.data.playbackState === 'paused') {
		updateCinetraktSoundtrackPlaybackState('paused');
	}
	if (event.data.type === MESSAGE_TYPES.PLAYBACK_STATE) return;

	const iframeEntityUrl = normalizeCinetraktSpotifyEntityUrl(iframe.src || iframe.getAttribute('src') || '');
	const messageEntityUrl = normalizeCinetraktSpotifyEntityUrl(event.data.embedUrl);
	if (iframeEntityUrl && messageEntityUrl && iframeEntityUrl !== messageEntityUrl) return;
	applyCinetraktSpotifyEmbedMetadata(track, event.data);
}

function clearCinetraktSoundtrackTimer(name) {
	if (cinetraktSoundtrackState[name] == null) return;
	window.clearTimeout(cinetraktSoundtrackState[name]);
	cinetraktSoundtrackState[name] = null;
}

function scheduleCinetraktSoundtrackSync(delay = 60) {
	clearCinetraktSoundtrackTimer('syncTimer');
	cinetraktSoundtrackState.syncTimer = window.setTimeout(() => {
		cinetraktSoundtrackState.syncTimer = null;
		syncCinetraktSoundtrackState();
	}, delay);
}

function scheduleCinetraktSoundtrackAutoplayAttempt(delay = CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY) {
	if (cinetraktSoundtrackState.autoplaySettled || cinetraktSoundtrackState.autoplayTimer != null) return;
	cinetraktSoundtrackState.autoplayTimer = window.setTimeout(() => {
		cinetraktSoundtrackState.autoplayTimer = null;
		if (cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()) {
			attemptCinetraktSoundtrackAutoplay();
		}
	}, delay);
}

function requestCinetraktSpotifyEmbedPlayback(track) {
	const section = track?.row.closest('section.trakt-soundtrack-section');
	const iframe = section?.querySelector('iframe[src*="open.spotify.com/embed/"]');
	if (!iframe?.contentWindow) return false;

	const allowedFeatures = new Set((iframe.getAttribute('allow') || '').split(';').map((value) => value.trim()).filter(Boolean));
	allowedFeatures.add('autoplay');
	iframe.setAttribute('allow', [...allowedFeatures].join('; '));
	if (!cinetraktReadySpotifyEmbeds.has(iframe)) return true;

	iframe.contentWindow.postMessage({ type: MESSAGE_TYPES.PLAY_REQUEST }, SPOTIFY_ORIGIN);
	return true;
}

function observeCinetraktSoundtrackSection(section) {
	if (cinetraktSoundtrackState.section === section && cinetraktSoundtrackState.soundtrackObserver) return;
	cinetraktSoundtrackState.soundtrackObserver?.disconnect();
	cinetraktSoundtrackState.section = section;
	cinetraktSoundtrackState.soundtrackObserver = new MutationObserver(() => scheduleCinetraktSoundtrackSync());
	cinetraktSoundtrackState.soundtrackObserver.observe(section, {
		attributes: true,
		attributeFilter: ['aria-label', 'class', 'disabled', 'src', 'title'],
		childList: true,
		subtree: true,
	});
}

function resolveCinetraktSoundtrackControl() {
	const tracks = collectCinetraktControllableSoundtrackTracks();
	const activeTrack = findCinetraktActiveSoundtrackTrack(tracks);
	if (activeTrack) {
		cinetraktSoundtrackState.selectedTrackKey = activeTrack.key;
		cinetraktSoundtrackState.selectedControl = activeTrack.control;
		return activeTrack;
	}

	const selectedTrack = tracks.find((track) => track.key === cinetraktSoundtrackState.selectedTrackKey) || null;
	if (selectedTrack) cinetraktSoundtrackState.selectedControl = selectedTrack.control;
	return selectedTrack;
}

function syncCinetraktSoundtrackState() {
	if (!cinetraktSoundtrackState.routeKey
		|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()) return;

	const section = findCinetraktSoundtrackSummarySection();
	if (!section) return;
	observeCinetraktSoundtrackSection(section);
	ensureCinetraktSoundtrackCardPlacement();

	const track = resolveCinetraktSoundtrackControl();
	if (!track) return;
	if (track.key !== cinetraktSoundtrackState.displayedTrackKey) {
		cinetraktSoundtrackState.cardReady = false;
		ensureCinetraktSoundtrackCardPlacement();
	}
	if (!cinetraktSoundtrackState.autoplaySettled) {
		if (isCinetraktSoundtrackControlPlaying(track.control)) {
			completeCinetraktSoundtrackAutoplay('playing');
		}
		return;
	}
	const nextState = isCinetraktSoundtrackControlPlaying(track.control) ? 'playing' : 'paused';
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function completeCinetraktSoundtrackAutoplay(playbackState = '') {
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('settleTimer');
	cinetraktSoundtrackState.autoplayAttempted = true;
	cinetraktSoundtrackState.autoplaySettled = true;
	const track = resolveCinetraktSoundtrackControl();
	const nextState = playbackState || (track && isCinetraktSoundtrackControlPlaying(track.control) ? 'playing' : 'paused');
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function attemptCinetraktSoundtrackAutoplay() {
	if (cinetraktSoundtrackState.autoplaySettled) return;
	cinetraktSoundtrackState.autoplayAttempted = true;

	const tracks = collectCinetraktPlayableSummaryTracks();
	const selected = tracks.find((track) => track.key === cinetraktSoundtrackState.selectedTrackKey);
	if (!selected?.control?.isConnected) {
		if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS) {
			completeCinetraktSoundtrackAutoplay('paused');
		} else {
			cinetraktSoundtrackState.autoplayAttemptCount += 1;
			scheduleCinetraktSoundtrackAutoplayAttempt();
		}
		return;
	}

	if (isCinetraktSoundtrackControlPlaying(selected.control)) {
		completeCinetraktSoundtrackAutoplay('playing');
		return;
	}

	cinetraktSoundtrackState.autoplayAttemptCount += 1;
	const isFirstAttempt = cinetraktSoundtrackState.autoplayAttemptCount === 1;
	const controlWasReplaced = cinetraktSoundtrackState.autoplayClickedControl
		&& cinetraktSoundtrackState.autoplayClickedControl !== selected.control;
	cinetraktSoundtrackState.selectedControl = selected.control;

	if (isFirstAttempt || controlWasReplaced) {
		cinetraktSoundtrackState.autoplayClickedControl = selected.control;
		selected.control.click();
	} else if (!requestCinetraktSpotifyEmbedPlayback(selected)) {
		selected.control.click();
	}

	if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS) {
		clearCinetraktSoundtrackTimer('settleTimer');
		cinetraktSoundtrackState.settleTimer = window.setTimeout(() => {
			cinetraktSoundtrackState.settleTimer = null;
			if (cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()) {
				completeCinetraktSoundtrackAutoplay();
			}
		}, CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY);
		return;
	}

	scheduleCinetraktSoundtrackAutoplayAttempt();
}

function toggleCinetraktSoundtrackPlayback() {
	if (!cinetraktSoundtrackState.autoplaySettled) return;
	const track = resolveCinetraktSoundtrackControl();
	if (!track?.control?.isConnected) return;
	track.control.click();
	scheduleCinetraktSoundtrackSync(80);
}

function cleanupCinetraktSoundtrackFeature({ pause = true, resetRoute = true } = {}) {
	clearCinetraktSoundtrackTimer('syncTimer');
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('settleTimer');

	if (pause) {
		const playingTrack = collectCinetraktControllableSoundtrackTracks()
			.find((track) => isCinetraktSoundtrackControlPlaying(track.control));
		playingTrack?.control.click();
	}

	cinetraktSoundtrackState.soundtrackObserver?.disconnect();
	if (cinetraktSoundtrackState.coverButton) {
		cinetraktSoundtrackState.coverButton.removeEventListener('click', toggleCinetraktSoundtrackPlayback);
	}
	document.querySelector('.trakt-side-navbar')?.classList.remove('cinetrakt-soundtrack-card-mounted');
	cinetraktSoundtrackState.card?.remove();
	cinetraktSoundtrackState.metadataRequestId += 1;

	Object.assign(cinetraktSoundtrackState, {
		status: 'idle',
		discoveryDeadline: 0,
		autoplayAttempted: false,
		autoplaySettled: false,
		autoplayAttemptCount: 0,
		autoplayClickedControl: null,
		selectedTrackKey: '',
		selectedControl: null,
		section: null,
		card: null,
		coverButton: null,
		coverImage: null,
		titleElement: null,
		artistElement: null,
		cardReady: false,
		playbackState: 'paused',
		displayedTrackKey: '',
		displayedCoverUrl: '',
		soundtrackObserver: null,
	});
	if (resetRoute) cinetraktSoundtrackState.routeKey = '';
}

function initializeCinetraktSoundtrackFeatureForRoute() {
	const routeKey = getCinetraktSoundtrackRouteKey();
	if (routeKey !== cinetraktSoundtrackState.routeKey) {
		cleanupCinetraktSoundtrackFeature();
		if (!routeKey) return;
		cinetraktSoundtrackState.routeKey = routeKey;
		cinetraktSoundtrackState.status = 'discovering';
		cinetraktSoundtrackState.discoveryDeadline = Date.now() + CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT;
	}

	if (!routeKey || cinetraktSoundtrackState.status === 'unavailable') return;
	const section = findCinetraktSoundtrackSummarySection();
	if (!section) {
		if (cinetraktSoundtrackState.status === 'discovering'
			&& Date.now() >= cinetraktSoundtrackState.discoveryDeadline) {
			cinetraktSoundtrackState.status = 'unavailable';
		}
		return;
	}
	observeCinetraktSoundtrackSection(section);

	const tracks = collectCinetraktPlayableSummaryTracks(section);
	if (tracks.length === 0) {
		if (cinetraktSoundtrackState.status === 'discovering'
			&& Date.now() >= cinetraktSoundtrackState.discoveryDeadline) {
			cinetraktSoundtrackState.status = 'unavailable';
			cinetraktSoundtrackState.soundtrackObserver?.disconnect();
			cinetraktSoundtrackState.soundtrackObserver = null;
		}
		return;
	}

	if (!cinetraktSoundtrackState.selectedTrackKey) {
		const selected = tracks[Math.floor(Math.random() * tracks.length)];
		cinetraktSoundtrackState.selectedTrackKey = selected.key;
		cinetraktSoundtrackState.selectedControl = selected.control;
		cinetraktSoundtrackState.status = 'ready';
		ensureCinetraktSoundtrackCardPlacement();
	}

	if (!isCinetraktFeatureEnabled('traktSoundtrackAutoplay')) {
		cinetraktSoundtrackState.autoplayAttempted = true;
		cinetraktSoundtrackState.autoplaySettled = true;
		updateCinetraktSoundtrackPlaybackState('paused');
		ensureCinetraktSoundtrackCardPlacement();
	} else if (!cinetraktSoundtrackState.autoplayAttempted) {
		scheduleCinetraktSoundtrackAutoplayAttempt(450);
	}

	syncCinetraktSoundtrackState();
}
	const api = Object.freeze({
		update: initializeCinetraktSoundtrackFeatureForRoute,
		cleanup: cleanupCinetraktSoundtrackFeature,
		handleEmbedMessage: handleCinetraktSpotifyEmbedMessage,
	});

	globalThis.CineTraktTraktSoundtrack = api;
})();
