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
		{ key: 'traktStremioLinks', group: 'Trakt', category: 'Lecture et Stremio', title: 'Ouvrir dans Stremio', description: 'Ouvre films, séries et épisodes dans Stremio depuis leurs jaquettes et leurs titres.' },
		{ key: 'traktSoundtrack', group: 'Trakt', category: 'Lecture et Stremio', title: 'Lecteur de bande-son', description: 'Affiche la pochette Spotify et les commandes de lecture dans la barre latérale.' },
		{ key: 'traktSoundtrackAutoplay', group: 'Trakt', category: 'Lecture et Stremio', title: 'Lecture automatique', description: 'Lance automatiquement une piste lorsqu’une bande-son est disponible.' },
		{ key: 'traktRatingColors', group: 'Trakt', category: 'Notes et IMDb', title: 'Notes et étoiles colorées', description: 'Affiche les notes sur 10 et applique leur couleur aux notes et aux étoiles.' },
		{ key: 'traktRatingsToggle', group: 'Trakt', category: 'Notes et IMDb', title: 'Afficher seulement IMDb', description: 'Masque les autres sources sur la fiche, sans retirer le panneau natif des notes.' },
		{ key: 'imdbEpisodeRatingsPopup', group: 'Trakt', category: 'Notes et IMDb', title: 'Notes IMDb par épisode', description: 'Ajoute le bouton Heatmap et ouvre le détail des notes de chaque épisode.' },
		{ key: 'traktPosterLayout', group: 'Trakt', category: 'Affichage des fiches', title: 'Grande affiche', description: 'Agrandit l’affiche et active la mise en page détaillée de CineTrakt.' },
		{ key: 'traktCollectionCard', group: 'Trakt', category: 'Affichage des fiches', title: 'Collection officielle', description: 'Place la collection officielle directement sous le synopsis du film.' },
		{ key: 'traktNavigationCleanup', group: 'Trakt', category: 'Navigation', title: 'Navigation simplifiée', description: 'Masque Library et Collaborations dans la barre latérale de Trakt.' },
		{ key: 'imdbTraktButton', group: 'IMDb', title: 'Bouton Trakt', description: 'Ajoute le logo Trakt et ouvre la fiche correspondante depuis IMDb.' },
		{ key: 'imdbRatingColors', group: 'IMDb', title: 'Couleurs des notes', description: 'Colorise les notes, les heatmaps et les moyennes affichées sur IMDb.' },
		{ key: 'stremioCompactPanel', group: 'Stremio Web', title: 'Panneau compact', description: 'Isole la liste des sources et conserve son défilement indépendant.' },
		{ key: 'newTabMovieDiscovery', group: 'Nouvel onglet', title: 'Film ou série aléatoire', description: 'Affiche une sélection visuelle aléatoire à partir des images TMDB.' },
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
