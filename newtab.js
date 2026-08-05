(() => {
	'use strict';

	const API_BASE = 'https://api.themoviedb.org/3';
	const IMAGE_BASE = 'https://image.tmdb.org/t/p/original';
	const MAX_DISCOVER_PAGE = 250;
	const MAX_MEDIA_ATTEMPTS = 8;
	const MIN_VOTE_COUNT = 200;
	const REQUEST_TIMEOUT_MS = 12000;
	const settings = globalThis.CineTraktSettings;
	const {
		getBackdropPaths,
		getImagePreferences,
		getMediaConfiguration,
		getPreferredPosterPath,
		isBearerToken,
		shuffle,
	} = globalThis.CineTraktTmdbUtils;

	const mediaView = document.getElementById('media-view');
	const loadingState = document.getElementById('loading-state');
	const errorState = document.getElementById('error-state');
	const posterLink = document.getElementById('poster-link');
	const posterImage = document.getElementById('poster-image');
	const artworkButton = document.getElementById('artwork-button');
	const artworkImage = document.getElementById('artwork-image');
	const retryButton = document.getElementById('retry-button');

	let tmdbCredential = '';
	let backdrops = [];
	let currentBackdropIndex = 0;

	async function fetchTmdb(path, parameters = {}) {
		const url = new URL(`${API_BASE}${path}`);
		Object.entries(parameters).forEach(([key, value]) => {
			if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
		});

		const headers = { accept: 'application/json' };
		if (isBearerToken(tmdbCredential)) {
			headers.Authorization = `Bearer ${tmdbCredential}`;
		} else {
			url.searchParams.set('api_key', tmdbCredential);
		}

		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const response = await fetch(url, { headers, signal: controller.signal });
			if (!response.ok) {
				const details = await response.json().catch(() => ({}));
				throw new Error(details.status_message || `TMDB request failed: ${response.status}`);
			}
			return response.json();
		} finally {
			window.clearTimeout(timeout);
		}
	}

	async function findRandomMediaByType(mediaType) {
		const configuration = getMediaConfiguration(mediaType);
		const discoverParameters = {
			include_adult: false,
			language: 'en-US',
			sort_by: 'popularity.desc',
			'vote_count.gte': MIN_VOTE_COUNT,
		};
		if (mediaType === 'movie') discoverParameters.include_video = false;
		if (mediaType === 'tv') discoverParameters.include_null_first_air_dates = false;

		const firstPage = await fetchTmdb(configuration.discoverPath, { ...discoverParameters, page: 1 });
		const availablePages = Math.max(1, Math.min(MAX_DISCOVER_PAGE, Number(firstPage.total_pages) || 1));

		for (let attempt = 0; attempt < MAX_MEDIA_ATTEMPTS; attempt += 1) {
			const page = 1 + Math.floor(Math.random() * availablePages);
			const discovered = page === 1
				? firstPage
				: await fetchTmdb(configuration.discoverPath, { ...discoverParameters, page });
			const candidates = shuffle(discovered.results || [])
				.filter((media) => media.poster_path && media.backdrop_path);

			for (const candidate of candidates.slice(0, 4)) {
				const imagePreferences = getImagePreferences(candidate.original_language);
				const details = await fetchTmdb(`/${configuration.detailsPath}/${candidate.id}`, {
					append_to_response: 'images,external_ids',
					include_image_language: imagePreferences.includedLanguages,
					language: imagePreferences.apiLanguage,
				});
				const imdbId = details.external_ids?.imdb_id;
				const posterPath = getPreferredPosterPath(details, imagePreferences.posterLanguages);
				const artworkPaths = getBackdropPaths(details);
				if (posterPath && /^tt\d{7,}$/.test(imdbId || '') && artworkPaths.length) {
					return { details, imdbId, mediaType, posterPath, artworkPaths, traktPath: configuration.traktPath };
				}
			}
		}

		return null;
	}

	async function findRandomMedia() {
		const firstType = Math.random() < 0.5 ? 'movie' : 'tv';
		const mediaTypes = [firstType, firstType === 'movie' ? 'tv' : 'movie'];
		for (const mediaType of mediaTypes) {
			const media = await findRandomMediaByType(mediaType);
			if (media) return media;
		}
		throw new Error('No compatible TMDB title found.');
	}

	function showArtwork(index) {
		if (!backdrops.length) return;
		currentBackdropIndex = (index + backdrops.length) % backdrops.length;
		artworkImage.src = `${IMAGE_BASE}${backdrops[currentBackdropIndex]}`;
	}

	async function renderMedia(media) {
		const title = media.details.title || media.details.name || media.details.original_title || media.details.original_name || '';
		posterLink.href = `https://app.trakt.tv/${media.traktPath}/${media.imdbId}`;
		posterLink.setAttribute('aria-label', `Ouvrir ${title || 'ce titre'} sur Trakt`);
		posterImage.src = `${IMAGE_BASE}${media.posterPath}`;
		posterImage.alt = title ? `Affiche de ${title}` : 'Affiche';
		artworkImage.alt = title ? `Artwork de ${title}` : 'Artwork';
		artworkButton.setAttribute('aria-label', `Afficher l'artwork suivant${title ? ` de ${title}` : ''}`);
		backdrops = media.artworkPaths;
		showArtwork(Math.floor(Math.random() * backdrops.length));
		await Promise.allSettled([posterImage.decode(), artworkImage.decode()]);

		loadingState.hidden = true;
		errorState.hidden = true;
		mediaView.setAttribute('aria-busy', 'false');
		mediaView.classList.add('is-ready');
	}

	function showError(error) {
		loadingState.hidden = true;
		mediaView.classList.remove('is-ready');
		errorState.setAttribute('aria-label', error?.message || 'Impossible de charger TMDB');
		errorState.hidden = false;
	}

	async function loadMedia() {
		mediaView.classList.remove('is-ready');
		mediaView.setAttribute('aria-busy', 'true');
		errorState.hidden = true;
		loadingState.hidden = false;

		try {
			await settings.ready;
			tmdbCredential = settings.getTmdbCredential();
			if (!tmdbCredential) throw new Error('TMDB credential missing.');
			await renderMedia(await findRandomMedia());
		} catch (error) {
			showError(error);
		}
	}

	function updatePosterTilt(event) {
		const rect = posterLink.getBoundingClientRect();
		const horizontal = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		const vertical = ((event.clientY - rect.top) / rect.height) * 2 - 1;
		posterLink.style.setProperty('--poster-rotate-x', `${(-vertical * 3).toFixed(2)}deg`);
		posterLink.style.setProperty('--poster-rotate-y', `${(horizontal * 3).toFixed(2)}deg`);
	}

	function resetPosterTilt() {
		posterLink.style.setProperty('--poster-rotate-x', '0deg');
		posterLink.style.setProperty('--poster-rotate-y', '0deg');
	}

	artworkButton.addEventListener('click', () => showArtwork(currentBackdropIndex + 1));
	retryButton.addEventListener('click', loadMedia);
	posterLink.addEventListener('pointermove', updatePosterTilt);
	posterLink.addEventListener('pointerleave', resetPosterTilt);
	document.addEventListener('keydown', (event) => {
		if (event.key === 'ArrowLeft') showArtwork(currentBackdropIndex - 1);
		if (event.key === 'ArrowRight') showArtwork(currentBackdropIndex + 1);
	});

	void loadMedia();
})();
