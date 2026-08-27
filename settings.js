(() => {
	'use strict';

	const STORAGE_KEY = 'cinetrakt:feature-settings:v1';
	const TMDB_CREDENTIAL_KEY = 'cinetrakt:tmdb-credential:v1';
	const DEFAULTS = Object.freeze({
		traktStremioLinks: true,
		traktRatingColors: true,
		traktRatingsToggle: true,
		imdbEpisodeRatingsPopup: true,
		traktPosterLayout: true,
		traktSoundtrack: true,
		traktSoundtrackAutoplay: true,
		traktCollectionCard: true,
		traktNavigationCleanup: true,
		imdbTraktButton: true,
		imdbRatingColors: true,
		stremioCompactPanel: true,
		newTabMovieDiscovery: false,
	});

	const DEFINITIONS = Object.freeze([
		{ key: 'traktStremioLinks', group: 'Trakt', title: 'Ouverture Stremio', description: 'Jaquettes et titres d’episodes ouvrent directement Stremio.' },
		{ key: 'traktRatingColors', group: 'Trakt', title: 'Notes et etoiles', description: 'Affiche les notes /10 et applique les couleurs aux notes et etoiles.' },
		{ key: 'traktRatingsToggle', group: 'Trakt', title: 'IMDb uniquement', description: 'Masque les autres sources sur la fiche tout en conservant le panneau natif des notes.' },
		{ key: 'imdbEpisodeRatingsPopup', group: 'Trakt', title: 'IMDb Ratings', description: 'Ajoute le bouton Heatmap et la fenetre des notes par episode.' },
		{ key: 'traktPosterLayout', group: 'Trakt', title: 'Grande affiche', description: 'Conserve la mise en page CineTrakt avec une affiche agrandie.' },
		{ key: 'traktSoundtrack', group: 'Trakt', title: 'Lecteur Soundtrack', description: 'Affiche la pochette Spotify et le controle dans la barre laterale.' },
		{ key: 'traktSoundtrackAutoplay', group: 'Trakt', title: 'Lecture automatique', description: 'Lance automatiquement une piste quand une bande-son est disponible.' },
		{ key: 'traktCollectionCard', group: 'Trakt', title: 'Carte Collection', description: 'Affiche la collection officielle sous le synopsis du film.' },
		{ key: 'traktNavigationCleanup', group: 'Trakt', title: 'Navigation simplifiee', description: 'Masque Library et Collaborations dans la barre laterale.' },
		{ key: 'imdbTraktButton', group: 'IMDb', title: 'Bouton Trakt', description: 'Affiche le logo Trakt et ouvre la bonne fiche depuis IMDb.' },
		{ key: 'imdbRatingColors', group: 'IMDb', title: 'Couleurs des notes', description: 'Colorise les notes, heatmaps et moyennes sur IMDb.' },
		{ key: 'stremioCompactPanel', group: 'Stremio Web', title: 'Panneau compact', description: 'Isole la liste des streams et preserve son defilement.' },
		{ key: 'newTabMovieDiscovery', group: 'Nouvel onglet', title: 'Film ou serie aleatoire', description: 'Affiche une pochette et des artworks TMDB sans texte.' },
	]);

	let values = { ...DEFAULTS };
	let tmdbCredential = '';
	let loaded = false;
	const listeners = new Set();
	const canReadPrivateSettings = globalThis.location?.protocol === 'chrome-extension:';

	function normalize(nextValues) {
		const normalized = { ...DEFAULTS };
		for (const key of Object.keys(DEFAULTS)) {
			if (typeof nextValues?.[key] === 'boolean') normalized[key] = nextValues[key];
		}
		return normalized;
	}

	function notify() {
		const snapshot = { ...values };
		listeners.forEach((listener) => listener(snapshot));
	}

	function getRuntimeErrorMessage() {
		try {
			return chrome.runtime?.lastError?.message || '';
		} catch {
			return 'Extension context unavailable.';
		}
	}

	function readStorage(keys) {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.get(keys, (result) => {
					resolve(getRuntimeErrorMessage() ? {} : (result || {}));
				});
			} catch {
				resolve({});
			}
		});
	}

	function writeStorage(entries) {
		return new Promise((resolve, reject) => {
			try {
				chrome.storage.local.set(entries, () => {
					const errorMessage = getRuntimeErrorMessage();
					if (errorMessage) {
						reject(new Error(errorMessage));
						return;
					}
					resolve();
				});
			} catch (error) {
				reject(error);
			}
		});
	}

	const ready = (async () => {
		const storageKeys = canReadPrivateSettings ? [STORAGE_KEY, TMDB_CREDENTIAL_KEY] : [STORAGE_KEY];
		const result = await readStorage(storageKeys);
		values = normalize(result?.[STORAGE_KEY]);
		tmdbCredential = typeof result?.[TMDB_CREDENTIAL_KEY] === 'string'
			? result[TMDB_CREDENTIAL_KEY].trim()
			: '';
		loaded = true;
		notify();
		return { ...values };
	})();

	function handleStorageChanges(changes, areaName) {
		if (areaName !== 'local') return;
		if (changes[STORAGE_KEY]) {
			values = normalize(changes[STORAGE_KEY].newValue);
			loaded = true;
			notify();
		}
		if (canReadPrivateSettings && changes[TMDB_CREDENTIAL_KEY]) {
			tmdbCredential = typeof changes[TMDB_CREDENTIAL_KEY].newValue === 'string'
				? changes[TMDB_CREDENTIAL_KEY].newValue.trim()
				: '';
		}
	}

	try {
		chrome.storage.onChanged.addListener(handleStorageChanges);
	} catch {
		// A content script from a previous extension version can outlive its context.
	}

	globalThis.CineTraktSettings = Object.freeze({
		STORAGE_KEY,
		TMDB_CREDENTIAL_KEY,
		DEFAULTS,
		DEFINITIONS,
		ready,
		get loaded() {
			return loaded;
		},
		getAll() {
			return { ...values };
		},
		getTmdbCredential() {
			return tmdbCredential;
		},
		isEnabled(key) {
			return values[key] !== false;
		},
		save(nextValues) {
			const normalized = normalize(nextValues);
			return writeStorage({ [STORAGE_KEY]: normalized }).then(() => ({ ...normalized }));
		},
		saveTmdbCredential(nextCredential) {
			const normalized = String(nextCredential || '').trim();
			return writeStorage({ [TMDB_CREDENTIAL_KEY]: normalized }).then(() => normalized);
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
})();
