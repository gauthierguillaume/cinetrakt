(() => {
	'use strict';
	const { MESSAGE_TYPES, SPOTIFY_ORIGIN } = globalThis.CineTraktSpotifyProtocol;
	const HANDOFF_MESSAGE = globalThis.CineTraktExtensionProtocol.MESSAGE_TYPES.HANDOFF_TRAKT_SOUNDTRACK;

	function isCinetraktFeatureEnabled(key) {
		return globalThis.CineTraktSettings?.isEnabled(key) !== false;
	}
/* Soundtrack autoplay and the compact control next to the Trakt logo. */
const CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS = 4;
const CINETRAKT_SOUNDTRACK_AUTOPLAY_RETRY_DELAY = 1300;
const CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT = 30000;
const cinetraktReadySpotifyEmbeds = new WeakSet();
const cinetraktSpotifyPlaybackReports = new WeakMap();
const cinetraktSpotifyEmbedLoads = new WeakMap();
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
	coverFrame: null,
	playbackIndicator: null,
	previousButton: null,
	nextButton: null,
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
	embedLoadTimer: null,
	embedLoadIframe: null,
	backgroundSuspended: false,
	resumeOnVisible: false,
	backgroundPlaybackAllowed: false,
	playbackClaimed: false,
	playbackClaimPending: null,
	lastClaimSerial: 0,
	userPaused: false,
	playRequested: false,
	recoveryAttempts: 0,
	managedPlayer: null,
	catalogRequest: null,
	catalogAttempts: 0,
	catalogSettled: false,
	catalogTimer: null,
};

function withCinetraktSoundtrackClaim(action) {
	if (cinetraktSoundtrackState.playbackClaimed) { action(); return true; }
	if (!isCinetraktSoundtrackTabVisible()) return false;
	if (cinetraktSoundtrackState.playbackClaimPending) {
		cinetraktSoundtrackState.playbackClaimPending.action = action; return true;
	}
	const claim = { route: getCinetraktSoundtrackRouteKey(), action };
	cinetraktSoundtrackState.playbackClaimPending = claim;
	// This start was requested in the foreground. A quick visit to an unrelated
	// site must not cancel it while the other players acknowledge their pause.
	cinetraktSoundtrackState.backgroundPlaybackAllowed = true;
	try {
		chrome.runtime.sendMessage({ type: HANDOFF_MESSAGE }, response => {
			const error = chrome.runtime.lastError;
			if (cinetraktSoundtrackState.playbackClaimPending !== claim) return;
			cinetraktSoundtrackState.playbackClaimPending = null;
			if (error || !response?.ok || !isCinetraktFeatureEnabled('traktSoundtrack')
				|| claim.route !== getCinetraktSoundtrackRouteKey() || cinetraktSoundtrackState.userPaused
				|| !cinetraktSoundtrackState.playRequested
				|| (Number.isFinite(response.claimSerial) && response.claimSerial < cinetraktSoundtrackState.lastClaimSerial)
				|| (!isCinetraktSoundtrackTabVisible() && !cinetraktSoundtrackState.backgroundPlaybackAllowed)) return;
			cinetraktSoundtrackState.playbackClaimed = true;
			if (Number.isFinite(response.claimSerial)) cinetraktSoundtrackState.lastClaimSerial = response.claimSerial;
			cinetraktSoundtrackState.backgroundPlaybackAllowed = true;
			claim.action();
		});
		return true;
	} catch {
		cinetraktSoundtrackState.playbackClaimPending = null; return false;
	}
}

function handleCinetraktSoundtrackHandoff(message, sender, sendResponse) {
	if (message?.type !== HANDOFF_MESSAGE || !isCinetraktFeatureEnabled('traktSoundtrack')
		|| !cinetraktSoundtrackState.routeKey) return;
	if (Number.isFinite(message.claimSerial)) {
		if (message.claimSerial < cinetraktSoundtrackState.lastClaimSerial) { sendResponse?.({ ok: true }); return; }
		cinetraktSoundtrackState.lastClaimSerial = message.claimSerial;
	}
	cinetraktSoundtrackState.playbackClaimed = false;
	const playing = collectCinetraktControllableSoundtrackTracks()
		.some((track) => isCinetraktSoundtrackControlPlaying(track.control));
	cinetraktSoundtrackState.resumeOnVisible ||= playing || cinetraktSoundtrackState.playbackState === 'playing';
	cinetraktSoundtrackState.backgroundSuspended = true;
	cinetraktSoundtrackState.backgroundPlaybackAllowed = false;
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('embedLoadTimer');
	pauseCinetraktSoundtrackPlayback();
	sendResponse?.({ ok: true });
}

function isCinetraktSoundtrackTabVisible() {
	return document.visibilityState === 'visible';
}

function pauseCinetraktSoundtrackPlayback() {
	const playing = collectCinetraktControllableSoundtrackTracks()
		.find((track) => isCinetraktSoundtrackControlPlaying(track.control));
	const activeEmbed = getCinetraktSpotifyEmbed(playing);
	// Use one pause path: toggling Trakt and Spotify together can toggle back to play.
	if (!activeEmbed || !cinetraktReadySpotifyEmbeds.has(activeEmbed)) playing?.control.click();
	for (const iframe of document.querySelectorAll('section.trakt-soundtrack-section iframe[src*="open.spotify.com/embed/"]')) {
		iframe.contentWindow?.postMessage({ type: MESSAGE_TYPES.PAUSE_REQUEST }, SPOTIFY_ORIGIN);
	}
	updateCinetraktSoundtrackPlaybackState('paused');
}

function suspendCinetraktSoundtrackForBackground() {
	if (!cinetraktSoundtrackState.routeKey) return;
	if (!cinetraktSoundtrackState.backgroundSuspended) {
		const playing = cinetraktSoundtrackState.managedPlayer ? cinetraktSoundtrackState.playbackState === 'playing'
			: collectCinetraktControllableSoundtrackTracks().some((track) => isCinetraktSoundtrackControlPlaying(track.control));
		cinetraktSoundtrackState.backgroundPlaybackAllowed = !cinetraktSoundtrackState.userPaused && (playing
			|| (cinetraktSoundtrackState.backgroundPlaybackAllowed && cinetraktSoundtrackState.playRequested));
		cinetraktSoundtrackState.resumeOnVisible = cinetraktSoundtrackState.backgroundPlaybackAllowed
			|| (!cinetraktSoundtrackState.autoplaySettled && isCinetraktFeatureEnabled('traktSoundtrackAutoplay'));
		cinetraktSoundtrackState.backgroundSuspended = true;
	}
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('embedLoadTimer');
	// Keep an already playing soundtrack until another visible media tab takes over.
	if (!cinetraktSoundtrackState.backgroundPlaybackAllowed) pauseCinetraktSoundtrackPlayback();
	else if (cinetraktSoundtrackState.playbackState === 'paused') recoverCinetraktBackgroundPlayback();
}

function recoverCinetraktBackgroundPlayback() {
	// A native visibility pause must not revoke a confirmed soundtrack's ownership.
	// Explicit user pauses and handoffs revoke that permission before reaching here.
	if (isCinetraktSoundtrackTabVisible() || !cinetraktSoundtrackState.backgroundPlaybackAllowed
		|| !cinetraktSoundtrackState.playRequested || cinetraktSoundtrackState.userPaused
		|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()
		|| cinetraktSoundtrackState.recoveryAttempts >= 2) return;
	cinetraktSoundtrackState.recoveryAttempts++;
	requestCinetraktSpotifyEmbedPlayback(resolveCinetraktSoundtrackControl());
}

function handleCinetraktSoundtrackVisibilityChange() {
	if (!isCinetraktFeatureEnabled('traktSoundtrack')) return;
	if (!isCinetraktSoundtrackTabVisible()) {
		suspendCinetraktSoundtrackForBackground();
		return;
	}
	if (cinetraktSoundtrackState.backgroundSuspended) {
		const resume = cinetraktSoundtrackState.resumeOnVisible && isCinetraktFeatureEnabled('traktSoundtrackAutoplay');
		cinetraktSoundtrackState.backgroundSuspended = false;
		cinetraktSoundtrackState.resumeOnVisible = false;
		cinetraktSoundtrackState.recoveryAttempts = 0;
		if (resume) {
			cinetraktSoundtrackState.autoplayAttempted = false;
			cinetraktSoundtrackState.autoplaySettled = false;
			cinetraktSoundtrackState.autoplayAttemptCount = 0;
			cinetraktSoundtrackState.autoplayClickedControl = null;
			cinetraktSoundtrackState.discoveryDeadline = Date.now() + CINETRAKT_SOUNDTRACK_DISCOVERY_TIMEOUT;
		}
	}
	initializeCinetraktSoundtrackFeatureForRoute();
}

function getCinetraktSoundtrackRouteKey() {
	const match = window.location.pathname.match(/^\/(movies|shows)\/([^/]+)\/?$/);
	return match ? `/${match[1]}/${match[2]}` : '';
}

function findCinetraktSoundtrackSummarySection() {
	return Array.from(document.querySelectorAll('section.trakt-soundtrack-section'))
		.find((section) => !section.closest('.trakt-drawer, .trakt-soundtrack-upsell')) || null;
}

function getCinetraktSoundtrackTrackKey(row) {
	if (row.dataset?.cinetraktTrackKey) return row.dataset.cinetraktTrackKey;
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
	if (cinetraktSoundtrackState.managedPlayer) return cinetraktSoundtrackState.managedPlayer.tracks;
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
	if (cinetraktSoundtrackState.managedPlayer) return cinetraktSoundtrackState.managedPlayer.tracks;
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
			color: var(--color-text-primary, var(--color-foreground, rgba(255, 255, 255, 0.92)));
			flex: 0 0 auto;
			margin: 0 8px;
			min-width: 0;
			width: calc(100% - 16px);
		}

		.cinetrakt-soundtrack-card[hidden] {
			display: none !important;
		}

		.cinetrakt-soundtrack-artwork {
			aspect-ratio: 1;
			background: rgba(255, 255, 255, 0.06);
			border-radius: 6px;
			outline: 2px solid transparent;
			outline-offset: 0;
			transition: outline-color 150ms ease-in-out;
			position: relative;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button {
			background: transparent;
			border: 0;
			border-radius: inherit;
			box-shadow: none;
			cursor: pointer;
			display: block;
			height: 100%;
			overflow: hidden;
			padding: 0;
			width: 100%;
		}

		.cinetrakt-soundtrack-cover-button:focus-visible { outline: none; }
		.cinetrakt-soundtrack-artwork:hover,
		.cinetrakt-soundtrack-artwork:has(:focus-visible) {
			outline-color: var(--color-card-border-hover, var(--cinetrakt-accent));
		}

		.cinetrakt-soundtrack-overlay {
			position: absolute; inset: 0; display: grid; place-items: center;
			border-radius: inherit; pointer-events: none; background: rgba(0, 0, 0, .12);
			opacity: 0; transition: opacity 150ms ease-in-out;
		}
		.cinetrakt-soundtrack-playback-icon {
			display: grid; place-items: center; width: 40px; height: 40px;
			border-radius: 50%; background: #fff; color: #171717;
			box-shadow: 0 2px 8px rgba(0, 0, 0, .18);
		}
		.cinetrakt-soundtrack-playback-icon svg { width: 22px; height: 22px; }
		.cinetrakt-soundtrack-playback-icon .pause-icon,
		.cinetrakt-soundtrack-playback-icon[data-playing="true"] .play-icon { display: none; }
		.cinetrakt-soundtrack-playback-icon[data-playing="true"] .pause-icon { display: block; }
		.cinetrakt-soundtrack-skip {
			box-sizing: border-box;
			position: absolute; top: 50%; transform: translate(-50%, -50%);
			width: 32px; height: 32px; padding: 6px; display: grid; place-items: center;
			border: 0; border-radius: 50%; color: #fff; background: rgba(30, 30, 30, .72);
			cursor: pointer; transition: background 120ms ease, opacity 120ms ease;
			opacity: 0; pointer-events: none;
		}
		.cinetrakt-soundtrack-artwork:is(:hover, :has(:focus-visible)) .cinetrakt-soundtrack-overlay,
		.cinetrakt-soundtrack-artwork:is(:hover, :has(:focus-visible)) .cinetrakt-soundtrack-skip { opacity: 1; }
		.cinetrakt-soundtrack-artwork:is(:hover, :has(:focus-visible)) .cinetrakt-soundtrack-skip { pointer-events: auto; }
		.cinetrakt-soundtrack-previous { left: 18%; }
		.cinetrakt-soundtrack-next { left: 82%; }
		.cinetrakt-soundtrack-skip svg { width: 20px; height: 20px; }
		.cinetrakt-soundtrack-skip:hover:not(:disabled) { background: rgba(20, 20, 20, .95); }
		.cinetrakt-soundtrack-skip:disabled { cursor: default; }
		.cinetrakt-soundtrack-artwork:is(:hover, :has(:focus-visible)) .cinetrakt-soundtrack-skip:disabled { opacity: .35; }
		.cinetrakt-soundtrack-skip:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
		.cinetrakt-soundtrack-artwork[data-track-loading] .cinetrakt-soundtrack-cover { opacity: .35; }

		.cinetrakt-soundtrack-cover {
			display: block;
			height: 100%;
			object-fit: cover;
			width: 100%;
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
			color: var(--cinetrakt-accent-text);
			font-size: 14px;
			font-weight: 700;
			line-height: 1.3;
			margin: 9px 0 0;
			-webkit-line-clamp: 2;
		}

		.cinetrakt-soundtrack-artist {
			color: var(--color-text-secondary, var(--color-foreground, rgba(255, 255, 255, 0.62)));
			font-size: 12px;
			font-weight: 400;
			line-height: 1.35;
			margin: 3px 0 0;
			-webkit-line-clamp: 1;
		}

		button[data-cinetrakt-soundtrack-playing] svg { visibility: hidden; }
		button[data-cinetrakt-soundtrack-playing] { position: relative; }
		button[data-cinetrakt-soundtrack-playing]::after {
			content: ''; position: absolute; width: 10px; height: 12px;
			background: linear-gradient(to right, currentColor 0 35%, transparent 35% 65%, currentColor 65%);
		}
	`;
	document.head.appendChild(style);
}

function createCinetraktSoundtrackCard() {
	const card = document.createElement('div');
	card.className = 'cinetrakt-soundtrack-card';
	card.hidden = true;
	const coverFrame = document.createElement('div');
	coverFrame.className = 'cinetrakt-soundtrack-artwork';

	const coverButton = document.createElement('button');
	coverButton.type = 'button';
	coverButton.className = 'cinetrakt-soundtrack-cover-button';
	coverButton.setAttribute('aria-label', 'Play soundtrack');
	coverButton.setAttribute('aria-pressed', 'false');
	coverButton.setAttribute('aria-busy', 'false');
	coverButton.title = 'Play soundtrack';

	const coverImage = document.createElement('img');
	coverImage.className = 'cinetrakt-soundtrack-cover';
	coverImage.alt = '';
	coverImage.draggable = false;
	coverButton.appendChild(coverImage);
	const overlay = document.createElement('span'); overlay.className = 'cinetrakt-soundtrack-overlay'; overlay.setAttribute('aria-hidden', 'true');
	const playbackIndicator = document.createElement('span'); playbackIndicator.className = 'cinetrakt-soundtrack-playback-icon';
	playbackIndicator.innerHTML = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg><svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
	overlay.appendChild(playbackIndicator); coverButton.appendChild(overlay);
	const skipButton = (direction, label, path) => {
		const button = document.createElement('button'); button.type = 'button';
		button.className = `cinetrakt-soundtrack-skip cinetrakt-soundtrack-${direction}`;
		button.setAttribute('aria-label', label); button.disabled = true;
		button.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;
		button.addEventListener('click', event => { event.stopPropagation(); navigateCinetraktSoundtrack(direction); });
		return button;
	};
	const previousButton = skipButton('previous', 'Previous soundtrack', 'M6 5h2v14H6zm3 7 11 7V5z');
	const nextButton = skipButton('next', 'Next soundtrack', 'M16 5h2v14h-2zM4 5v14l11-7z');
	previousButton.title = 'Musique précédente'; nextButton.title = 'Musique suivante';
	coverFrame.append(coverButton, previousButton, nextButton);

	const titleElement = document.createElement('p');
	titleElement.className = 'cinetrakt-soundtrack-title';
	const artistElement = document.createElement('p');
	artistElement.className = 'cinetrakt-soundtrack-artist';

	card.append(coverFrame, titleElement, artistElement);
	coverButton.addEventListener('click', toggleCinetraktSoundtrackPlayback);
	Object.assign(cinetraktSoundtrackState, { card, coverButton, coverImage, coverFrame, playbackIndicator, previousButton, nextButton, titleElement, artistElement });
	updateCinetraktSoundtrackCardControls(cinetraktSoundtrackState.playbackState);
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
	cinetraktSoundtrackState.managedPlayer?.update(nextState, cinetraktSoundtrackState.selectedTrackKey);
	if (nextState === 'playing' && !cinetraktSoundtrackState.userPaused
		&& (isCinetraktSoundtrackTabVisible() || cinetraktSoundtrackState.backgroundPlaybackAllowed)) {
		cinetraktSoundtrackState.backgroundPlaybackAllowed = true;
	}
	updateCinetraktSoundtrackCardControls(nextState);
	if (nextState === cinetraktSoundtrackState.playbackState) return;
	cinetraktSoundtrackState.playbackState = nextState;
	const playing = nextState === 'playing';
	const loading = nextState === 'buffering';
	const label = playing || loading ? 'Pause soundtrack' : 'Play soundtrack';
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-label', label);
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-pressed', playing ? 'true' : 'false');
	cinetraktSoundtrackState.coverButton?.setAttribute('aria-busy', loading ? 'true' : 'false');
	if (cinetraktSoundtrackState.coverButton) cinetraktSoundtrackState.coverButton.title = label;
}

function updateCinetraktSoundtrackCardControls(state) {
	const { managedPlayer, previousButton, nextButton, playbackIndicator } = cinetraktSoundtrackState;
	if (previousButton) previousButton.disabled = !managedPlayer?.canPrevious;
	if (nextButton) nextButton.disabled = !managedPlayer?.canNext;
	const value = ['playing', 'buffering'].includes(state) ? 'true' : 'false';
	if (playbackIndicator && playbackIndicator.getAttribute('data-playing') !== value) playbackIndicator.setAttribute('data-playing', value);
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
		&& coverUrl === cinetraktSoundtrackState.displayedCoverUrl) {
		cinetraktSoundtrackState.titleElement.textContent = title;
		cinetraktSoundtrackState.artistElement.textContent = artist;
		cinetraktSoundtrackState.coverFrame?.removeAttribute('data-track-loading');
		return;
	}

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
		cinetraktSoundtrackState.coverFrame?.removeAttribute('data-track-loading');
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
	if (!isCinetraktFeatureEnabled('traktSoundtrack') || event.origin !== SPOTIFY_ORIGIN
		|| ![
			MESSAGE_TYPES.READY,
			MESSAGE_TYPES.METADATA,
			MESSAGE_TYPES.PLAYBACK_STATE,
		].includes(event.data?.type)) return;

	const iframe = Array.from(document.querySelectorAll('iframe[src*="open.spotify.com/embed/"]'))
		.find((candidate) => candidate.contentWindow === event.source);
	if (!iframe) return;
	if (cinetraktSoundtrackState.managedPlayer && iframe !== cinetraktSoundtrackState.managedPlayer.iframe) return;
	const iframeEntityUrl = normalizeCinetraktSpotifyEntityUrl(iframe.src || iframe.getAttribute('src') || '');
	const messageEntityUrl = normalizeCinetraktSpotifyEntityUrl(event.data.embedUrl);
	if (iframeEntityUrl && messageEntityUrl && iframeEntityUrl !== messageEntityUrl) return;
	cinetraktReadySpotifyEmbeds.add(iframe);
	if (iframe === cinetraktSoundtrackState.embedLoadIframe) clearCinetraktSoundtrackTimer('embedLoadTimer');
	if (event.data.type === MESSAGE_TYPES.READY) {
		scheduleCinetraktSoundtrackSync(0);
		if (cinetraktSoundtrackState.userPaused) {
			iframe.contentWindow?.postMessage({ type: MESSAGE_TYPES.PAUSE_REQUEST, userInitiated: true }, SPOTIFY_ORIGIN);
		} else if (cinetraktSoundtrackState.playRequested) {
			requestCinetraktSpotifyEmbedPlayback(resolveCinetraktSoundtrackControl());
		}
		if (isCinetraktFeatureEnabled('traktSoundtrackAutoplay') && !cinetraktSoundtrackState.userPaused) {
			scheduleCinetraktSoundtrackAutoplayAttempt(0);
		}
		return;
	}

	const track = resolveCinetraktSoundtrackControl();
	const soundtrackScope = track?.row.closest('section.trakt-soundtrack-section');
	if (!track || !soundtrackScope?.contains(iframe)) return;
	if (['playing', 'paused', 'buffering', 'stalled', 'ended'].includes(event.data.playbackState)) {
		cinetraktSpotifyPlaybackReports.set(iframe, { entity: iframeEntityUrl, state: event.data.playbackState });
	}
	if (event.data.userInitiated && event.data.playbackState === 'paused') {
		cinetraktSoundtrackState.userPaused = true;
		cinetraktSoundtrackState.playRequested = false;
		completeCinetraktSoundtrackAutoplay('paused');
	} else if (event.data.userInitiated && ['playing', 'buffering'].includes(event.data.playbackState)) {
		cinetraktSoundtrackState.userPaused = false;
		cinetraktSoundtrackState.playRequested = true;
		cinetraktSoundtrackState.recoveryAttempts = 0;
		if (!cinetraktSoundtrackState.playbackClaimed) requestCinetraktSpotifyEmbedPlayback(track, true);
	}

	if (event.data.playbackState === 'playing') {
		if (cinetraktSoundtrackState.userPaused) {
			iframe.contentWindow?.postMessage({ type: MESSAGE_TYPES.PAUSE_REQUEST, userInitiated: true }, SPOTIFY_ORIGIN);
			return;
		}
		if (!cinetraktSoundtrackState.playbackClaimed) {
			pauseCinetraktSoundtrackPlayback(); return;
		}
		if (!isCinetraktSoundtrackTabVisible() && !cinetraktSoundtrackState.backgroundPlaybackAllowed) {
			pauseCinetraktSoundtrackPlayback();
			return;
		}
		completeCinetraktSoundtrackAutoplay('playing');
	} else if (event.data.playbackState === 'ended') {
		const advance = cinetraktSoundtrackState.playRequested && !cinetraktSoundtrackState.userPaused
			&& cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()
			&& !(cinetraktSoundtrackState.backgroundSuspended && !cinetraktSoundtrackState.backgroundPlaybackAllowed)
			&& (isCinetraktSoundtrackTabVisible() || cinetraktSoundtrackState.backgroundPlaybackAllowed);
		updateCinetraktSoundtrackPlaybackState('paused');
		if (advance && navigateCinetraktSoundtrack('next', { automatic: true })) return;
		cinetraktSoundtrackState.playRequested = false;
	} else if (event.data.playbackState === 'paused') {
		updateCinetraktSoundtrackPlaybackState('paused');
		if (!event.data.userInitiated) recoverCinetraktBackgroundPlayback();
	} else if (event.data.playbackState === 'buffering' && !cinetraktSoundtrackState.userPaused) {
		updateCinetraktSoundtrackPlaybackState('buffering');
	} else if (event.data.playbackState === 'stalled') {
		updateCinetraktSoundtrackPlaybackState('stalled');
		recoverCinetraktBackgroundPlayback();
		if (isCinetraktSoundtrackTabVisible() && cinetraktSoundtrackState.playRequested && !cinetraktSoundtrackState.userPaused) {
			if (cinetraktSoundtrackState.recoveryAttempts < 2) {
				cinetraktSoundtrackState.recoveryAttempts++;
				requestCinetraktSpotifyEmbedPlayback(track);
			} else {
				cinetraktSoundtrackState.playRequested = false;
				pauseCinetraktSoundtrackPlayback();
				completeCinetraktSoundtrackAutoplay('paused');
			}
		}
	}
	if (event.data.type === MESSAGE_TYPES.PLAYBACK_STATE) return;

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
	if (!isCinetraktSoundtrackTabVisible() || !isCinetraktFeatureEnabled('traktSoundtrack')
		|| !isCinetraktFeatureEnabled('traktSoundtrackAutoplay')
		|| cinetraktSoundtrackState.autoplaySettled || cinetraktSoundtrackState.autoplayTimer != null) return;
	cinetraktSoundtrackState.autoplayTimer = window.setTimeout(() => {
		cinetraktSoundtrackState.autoplayTimer = null;
		if (cinetraktSoundtrackState.routeKey === getCinetraktSoundtrackRouteKey()) {
			attemptCinetraktSoundtrackAutoplay();
		}
	}, delay);
}

function getCinetraktSpotifyEmbed(track) {
	if (cinetraktSoundtrackState.managedPlayer) return cinetraktSoundtrackState.managedPlayer.iframe;
	const section = track?.row.closest('section.trakt-soundtrack-section');
	return section?.querySelector('iframe[src*="open.spotify.com/embed/"]') || null;
}

function prepareCinetraktSpotifyEmbed(track) {
	const iframe = getCinetraktSpotifyEmbed(track);
	if (!iframe) return null;
	// An offscreen lazy frame may never load, so Spotify cannot send READY.
	if (iframe.getAttribute('loading') !== 'eager') iframe.setAttribute('loading', 'eager');
	const allowed = new Set((iframe.getAttribute('allow') || '').split(';').map(value => value.trim()).filter(Boolean));
	if (!allowed.has('autoplay')) { allowed.add('autoplay'); iframe.setAttribute('allow', [...allowed].join('; ')); }
	const entity = normalizeCinetraktSpotifyEntityUrl(iframe.src || iframe.getAttribute('src') || '');
	let load = cinetraktSpotifyEmbedLoads.get(iframe);
	if (!load || load.entity !== entity) {
		if (load) { cinetraktReadySpotifyEmbeds.delete(iframe); cinetraktSpotifyPlaybackReports.delete(iframe); }
		load = { entity, reloaded: false }; cinetraktSpotifyEmbedLoads.set(iframe, load);
		clearCinetraktSoundtrackTimer('embedLoadTimer');
	}
	if (cinetraktSoundtrackState.embedLoadIframe !== iframe) clearCinetraktSoundtrackTimer('embedLoadTimer');
	cinetraktSoundtrackState.embedLoadIframe = iframe;
	if (entity && !load.reloaded && !cinetraktReadySpotifyEmbeds.has(iframe)
		&& cinetraktSoundtrackState.playRequested && !cinetraktSoundtrackState.userPaused
		&& cinetraktSoundtrackState.embedLoadTimer == null && isCinetraktSoundtrackTabVisible()) {
		const route = cinetraktSoundtrackState.routeKey;
		cinetraktSoundtrackState.embedLoadTimer = window.setTimeout(() => {
			cinetraktSoundtrackState.embedLoadTimer = null;
			if (!iframe.isConnected || route !== getCinetraktSoundtrackRouteKey() || !isCinetraktSoundtrackTabVisible()
				|| cinetraktSoundtrackState.userPaused || !cinetraktSoundtrackState.playRequested
				|| cinetraktReadySpotifyEmbeds.has(iframe) || cinetraktSpotifyEmbedLoads.get(iframe) !== load) return;
			load.reloaded = true;
			iframe.setAttribute('src', iframe.src || iframe.getAttribute('src'));
		}, 8000);
	}
	return iframe;
}

function getCinetraktObservedSoundtrackPlayback(track) {
	const iframe = getCinetraktSpotifyEmbed(track);
	if (!iframe) return isCinetraktSoundtrackControlPlaying(track?.control) ? 'playing' : 'paused';
	const report = cinetraktSpotifyPlaybackReports.get(iframe);
	const entity = normalizeCinetraktSpotifyEntityUrl(iframe.src || iframe.getAttribute('src') || '');
	if (report && report.entity === entity) return report.state;
	return isCinetraktSoundtrackControlPlaying(track?.control) ? 'buffering' : 'paused';
}

function requestCinetraktSpotifyEmbedPlayback(track, userInitiated = false) {
	const continueInBackground = !isCinetraktSoundtrackTabVisible() && cinetraktSoundtrackState.backgroundPlaybackAllowed
		&& cinetraktSoundtrackState.playRequested && !cinetraktSoundtrackState.userPaused;
	if (!isCinetraktSoundtrackTabVisible() && !continueInBackground) return false;
	const iframe = prepareCinetraktSpotifyEmbed(track);
	if (!iframe?.contentWindow) return false;

	// L'iframe existe parfois plusieurs secondes avant que son bridge Spotify
	// soit réellement prêt. Ne pas prétendre qu'une requête a été envoyée :
	// l'appelant peut ainsi retenter le contrôle Trakt natif pendant ce délai.
	if (!cinetraktReadySpotifyEmbeds.has(iframe)) return false;

	return withCinetraktSoundtrackClaim(() => {
		if (getCinetraktSpotifyEmbed(track) !== iframe || !iframe.isConnected) return;
		iframe.contentWindow.postMessage({ type: MESSAGE_TYPES.PLAY_REQUEST, userInitiated,
			continueInBackground: continueInBackground || !isCinetraktSoundtrackTabVisible() }, SPOTIFY_ORIGIN);
	});
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
	if (!isCinetraktSoundtrackTabVisible()) {
		suspendCinetraktSoundtrackForBackground();
		return;
	}
	if (!cinetraktSoundtrackState.routeKey
		|| cinetraktSoundtrackState.routeKey !== getCinetraktSoundtrackRouteKey()) return;

	const section = findCinetraktSoundtrackSummarySection();
	if (!section) return;
	observeCinetraktSoundtrackSection(section);
	ensureCinetraktSoundtrackCardPlacement();
	cinetraktSoundtrackState.managedPlayer?.update(cinetraktSoundtrackState.playbackState, cinetraktSoundtrackState.selectedTrackKey);

	const track = resolveCinetraktSoundtrackControl();
	if (!track) return;
	prepareCinetraktSpotifyEmbed(track);
	if (track.key !== cinetraktSoundtrackState.displayedTrackKey) {
		if (!cinetraktSoundtrackState.managedPlayer) cinetraktSoundtrackState.cardReady = false;
		ensureCinetraktSoundtrackCardPlacement();
	}
	if (!cinetraktSoundtrackState.autoplaySettled) {
		if (getCinetraktObservedSoundtrackPlayback(track) === 'playing') {
			completeCinetraktSoundtrackAutoplay('playing');
		}
		return;
	}
	const nextState = cinetraktSoundtrackState.userPaused ? 'paused' : getCinetraktObservedSoundtrackPlayback(track);
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function completeCinetraktSoundtrackAutoplay(playbackState = '') {
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('embedLoadTimer');
	cinetraktSoundtrackState.autoplayAttempted = true;
	cinetraktSoundtrackState.autoplaySettled = true;
	const track = resolveCinetraktSoundtrackControl();
	const nextState = playbackState || (getCinetraktObservedSoundtrackPlayback(track) === 'playing' ? 'playing' : 'paused');
	updateCinetraktSoundtrackPlaybackState(nextState);
	ensureCinetraktSoundtrackCardPlacement();
}

function attemptCinetraktSoundtrackAutoplay() {
	if (!isCinetraktSoundtrackTabVisible() || !isCinetraktFeatureEnabled('traktSoundtrack')
		|| !isCinetraktFeatureEnabled('traktSoundtrackAutoplay')) return;
	if (cinetraktSoundtrackState.autoplaySettled || cinetraktSoundtrackState.userPaused) return;
	cinetraktSoundtrackState.autoplayAttempted = true;
	cinetraktSoundtrackState.playRequested = true;

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

	if (getCinetraktObservedSoundtrackPlayback(selected) === 'playing') {
		completeCinetraktSoundtrackAutoplay('playing');
		return;
	}

	const spotifyEmbed = prepareCinetraktSpotifyEmbed(selected);
	const spotifyEmbedReady = spotifyEmbed && cinetraktReadySpotifyEmbeds.has(spotifyEmbed);
	if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS
		&& Date.now() < cinetraktSoundtrackState.discoveryDeadline) {
		// Les clics initiaux ont déjà demandé à Trakt de monter le lecteur. Une fois
		// ce quota atteint, attendre son signal READY évite de marteler le bouton tout
		// en laissant l'autoplay reprendre si Spotify a simplement chargé lentement.
		scheduleCinetraktSoundtrackAutoplayAttempt();
		return;
	}
	if (cinetraktSoundtrackState.autoplayAttemptCount >= CINETRAKT_SOUNDTRACK_AUTOPLAY_MAX_ATTEMPTS) {
		completeCinetraktSoundtrackAutoplay('paused'); return;
	}

	cinetraktSoundtrackState.autoplayAttemptCount += 1;
	const isFirstAttempt = cinetraktSoundtrackState.autoplayAttemptCount === 1;
	const controlWasReplaced = cinetraktSoundtrackState.autoplayClickedControl
		&& cinetraktSoundtrackState.autoplayClickedControl !== selected.control;
	cinetraktSoundtrackState.selectedControl = selected.control;

	if ((isFirstAttempt || controlWasReplaced) && !isCinetraktSoundtrackControlPlaying(selected.control)) {
		cinetraktSoundtrackState.autoplayClickedControl = selected.control;
		if (cinetraktSoundtrackState.managedPlayer) selected.control.click();
		else withCinetraktSoundtrackClaim(() => selected.control.click());
	} else if (spotifyEmbedReady) {
		requestCinetraktSpotifyEmbedPlayback(selected);
	} else if (!spotifyEmbed && !isCinetraktSoundtrackControlPlaying(selected.control)) {
		withCinetraktSoundtrackClaim(() => selected.control.click());
	}

	scheduleCinetraktSoundtrackAutoplayAttempt();
}

function toggleCinetraktSoundtrackPlayback() {
	if (!isCinetraktSoundtrackTabVisible()) return;
	const track = resolveCinetraktSoundtrackControl();
	if (!track?.control?.isConnected) return;
	const pause = ['playing', 'buffering'].includes(cinetraktSoundtrackState.playbackState);
	cinetraktSoundtrackState.userPaused = pause;
	cinetraktSoundtrackState.playRequested = !pause;
	cinetraktSoundtrackState.recoveryAttempts = 0;
	completeCinetraktSoundtrackAutoplay('paused');
	if (pause) pauseCinetraktSoundtrackPlayback();
	else if (!requestCinetraktSpotifyEmbedPlayback(track, true)) {
		if (cinetraktSoundtrackState.managedPlayer) track.control.click();
		else withCinetraktSoundtrackClaim(() => track.control.click());
	}
	scheduleCinetraktSoundtrackSync(80);
}

function navigateCinetraktSoundtrack(direction, { automatic = false } = {}) {
	if (!isCinetraktSoundtrackTabVisible() && !(automatic && cinetraktSoundtrackState.backgroundPlaybackAllowed)) return false;
	const player = cinetraktSoundtrackState.managedPlayer;
	const track = direction === 'previous' ? player?.previous() : player?.next();
	if (!track) return false;
	if (automatic) cinetraktSoundtrackState.backgroundPlaybackAllowed = true;
	completeCinetraktSoundtrackAutoplay('paused');
	playCinetraktLibraryTrack(track, !automatic, { continuation: automatic });
	return true;
}

function playCinetraktLibraryTrack(track, userInitiated = false, { continuation = false } = {}) {
	if (!isCinetraktSoundtrackTabVisible() && !(continuation && cinetraktSoundtrackState.backgroundPlaybackAllowed)) return;
	cinetraktSoundtrackState.selectedTrackKey = track.key;
	cinetraktSoundtrackState.selectedControl = track.control;
	cinetraktSoundtrackState.userPaused = false;
	cinetraktSoundtrackState.playRequested = true;
	cinetraktSoundtrackState.recoveryAttempts = 0;
	cinetraktSoundtrackState.managedPlayer.select(track);
	if (cinetraktSoundtrackState.cardReady) {
		cinetraktSoundtrackState.titleElement.textContent = track.title;
		cinetraktSoundtrackState.artistElement.textContent = track.artist;
		if (track.key !== cinetraktSoundtrackState.displayedTrackKey) cinetraktSoundtrackState.coverFrame?.setAttribute('data-track-loading', 'true');
		else cinetraktSoundtrackState.coverFrame?.removeAttribute('data-track-loading');
	}
	updateCinetraktSoundtrackPlaybackState('buffering');
	requestCinetraktSpotifyEmbedPlayback(track, userInitiated);
	scheduleCinetraktSoundtrackSync(0);
}

function ensureCinetraktSoundtrackCatalog(section) {
	const library = globalThis.CineTraktSoundtrackLibrary;
	if (!library || cinetraktSoundtrackState.catalogSettled) return true;
	if (cinetraktSoundtrackState.catalogRequest || cinetraktSoundtrackState.catalogTimer != null) return false;
	const route = cinetraktSoundtrackState.routeKey;
	const request = library.readCatalog(route);
	cinetraktSoundtrackState.catalogRequest = request;
	const receive = tracks => {
		if (cinetraktSoundtrackState.catalogRequest !== request) return;
		cinetraktSoundtrackState.catalogRequest = null;
		if (route !== getCinetraktSoundtrackRouteKey() || !section.isConnected || !isCinetraktFeatureEnabled('traktSoundtrack')) return;
		cinetraktSoundtrackState.catalogAttempts++;
		if (tracks.length) {
			const previous = resolveCinetraktSoundtrackControl();
			const continueManualPlay = previous && cinetraktSoundtrackState.playRequested && !cinetraktSoundtrackState.userPaused;
			if (previous) pauseCinetraktSoundtrackPlayback();
			cinetraktSoundtrackState.managedPlayer = library.createPlayer(section, tracks, playCinetraktLibraryTrack);
			cinetraktSoundtrackState.catalogSettled = true;
			const selected = previous && cinetraktSoundtrackState.managedPlayer.matchRow(previous.row);
			if (selected) {
				cinetraktSoundtrackState.selectedTrackKey = selected.key;
				cinetraktSoundtrackState.selectedControl = selected.control;
				if (continueManualPlay) playCinetraktLibraryTrack(selected);
			} else if (previous) {
				cinetraktSoundtrackState.selectedTrackKey = '';
				cinetraktSoundtrackState.selectedControl = null;
			}
		} else if (cinetraktSoundtrackState.catalogAttempts < 4) {
			cinetraktSoundtrackState.catalogTimer = window.setTimeout(() => {
				cinetraktSoundtrackState.catalogTimer = null;
				initializeCinetraktSoundtrackFeatureForRoute();
			}, [250, 750, 1500][cinetraktSoundtrackState.catalogAttempts - 1]);
		} else cinetraktSoundtrackState.catalogSettled = true;
		initializeCinetraktSoundtrackFeatureForRoute();
	};
	request.then(receive, () => receive([]));
	return false;
}

function cleanupCinetraktSoundtrackFeature({ pause = true, resetRoute = true } = {}) {
	clearCinetraktSoundtrackTimer('syncTimer');
	clearCinetraktSoundtrackTimer('autoplayTimer');
	clearCinetraktSoundtrackTimer('embedLoadTimer');
	clearCinetraktSoundtrackTimer('catalogTimer');

	if (pause) pauseCinetraktSoundtrackPlayback();
	cinetraktSoundtrackState.managedPlayer?.cleanup();

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
		coverFrame: null,
		playbackIndicator: null,
		previousButton: null,
		nextButton: null,
		titleElement: null,
		artistElement: null,
		cardReady: false,
		playbackState: 'paused',
		displayedTrackKey: '',
		displayedCoverUrl: '',
		soundtrackObserver: null,
		backgroundSuspended: false,
		resumeOnVisible: false,
		backgroundPlaybackAllowed: false,
		playbackClaimed: false,
		playbackClaimPending: null,
		lastClaimSerial: 0,
		userPaused: false,
		playRequested: false,
		recoveryAttempts: 0,
		embedLoadIframe: null,
		managedPlayer: null,
		catalogRequest: null,
		catalogAttempts: 0,
		catalogSettled: false,
	});
	if (resetRoute) cinetraktSoundtrackState.routeKey = '';
}

function initializeCinetraktSoundtrackFeatureForRoute() {
	if (!isCinetraktSoundtrackTabVisible()) {
		suspendCinetraktSoundtrackForBackground();
		return;
	}
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
	if (cinetraktSoundtrackState.managedPlayer && !cinetraktSoundtrackState.managedPlayer.root.isConnected) {
		cinetraktSoundtrackState.managedPlayer.cleanup();
		cinetraktSoundtrackState.managedPlayer = null;
		cinetraktSoundtrackState.catalogSettled = false;
		if (!cinetraktSoundtrackState.userPaused) {
			cinetraktSoundtrackState.autoplayAttempted = false;
			cinetraktSoundtrackState.autoplaySettled = false;
			cinetraktSoundtrackState.autoplayAttemptCount = 0;
			cinetraktSoundtrackState.autoplayClickedControl = null;
		}
	}
	observeCinetraktSoundtrackSection(section);
	if (!ensureCinetraktSoundtrackCatalog(section)) return;

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
		scheduleCinetraktSoundtrackAutoplayAttempt(cinetraktSoundtrackState.managedPlayer ? 0 : 450);
	}

	syncCinetraktSoundtrackState();
}
	document.addEventListener('visibilitychange', handleCinetraktSoundtrackVisibilityChange);
	document.addEventListener('click', (event) => {
		if (!event.isTrusted) return;
		const button = event.target?.closest?.('button');
		const row = button?.closest?.('.trakt-soundtrack-row');
		if (!row || findCinetraktSoundtrackNativeControl(row) !== button) return;
		const managedTrack = cinetraktSoundtrackState.managedPlayer?.matchRow(row);
		if (managedTrack) {
			event.preventDefault(); event.stopImmediatePropagation();
			const pause = managedTrack.key === cinetraktSoundtrackState.selectedTrackKey
				&& ['playing', 'buffering'].includes(cinetraktSoundtrackState.playbackState);
			completeCinetraktSoundtrackAutoplay('paused');
			if (pause) {
				cinetraktSoundtrackState.userPaused = true; cinetraktSoundtrackState.playRequested = false;
				pauseCinetraktSoundtrackPlayback();
			} else playCinetraktLibraryTrack(managedTrack, true);
			return;
		}
		cinetraktSoundtrackState.userPaused = isCinetraktSoundtrackControlPlaying(button);
		cinetraktSoundtrackState.playRequested = !cinetraktSoundtrackState.userPaused;
		cinetraktSoundtrackState.recoveryAttempts = 0;
		completeCinetraktSoundtrackAutoplay('paused');
		if (cinetraktSoundtrackState.userPaused) {
			// Cancel a queued start in the embed as well as Trakt's native pause.
			const iframe = getCinetraktSpotifyEmbed(createCinetraktSoundtrackTrack(row, 0));
			iframe?.contentWindow?.postMessage({ type: MESSAGE_TYPES.PAUSE_REQUEST, userInitiated: true }, SPOTIFY_ORIGIN);
		} else {
			cinetraktSoundtrackState.selectedTrackKey = getCinetraktSoundtrackTrackKey(row);
			cinetraktSoundtrackState.selectedControl = button;
			event.preventDefault(); event.stopImmediatePropagation();
			withCinetraktSoundtrackClaim(() => button.click());
		}
	}, true);
	window.addEventListener('pageshow', handleCinetraktSoundtrackVisibilityChange);
	chrome.runtime.onMessage.addListener(handleCinetraktSoundtrackHandoff);
	const api = Object.freeze({
		update: initializeCinetraktSoundtrackFeatureForRoute,
		cleanup: cleanupCinetraktSoundtrackFeature,
		handleEmbedMessage: handleCinetraktSpotifyEmbedMessage,
	});

	globalThis.CineTraktTraktSoundtrack = api;
})();
