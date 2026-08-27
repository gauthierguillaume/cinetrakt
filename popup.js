(() => {
	'use strict';

	const settings = globalThis.CineTraktSettings;
	const groupsRoot = document.getElementById('feature-groups');
	const masterToggle = document.getElementById('master-toggle');
	const enabledCount = document.getElementById('enabled-count');
	const applyButton = document.getElementById('apply-button');
	const resetButton = document.getElementById('reset-button');
	const status = document.getElementById('status');
	const inputs = new Map();
	let currentValues = { ...settings.DEFAULTS };
	let savedValues = { ...settings.DEFAULTS };
	let currentTmdbCredential = '';
	let savedTmdbCredential = '';
	let tmdbCredentialInput = null;

	function getGroupTheme(groupName) {
		if (groupName === 'IMDb') return 'imdb';
		if (groupName === 'Stremio Web') return 'stremio';
		if (groupName === 'Nouvel onglet') return 'tmdb';
		return 'trakt';
	}

	function createTmdbCredentialRow() {
		const wrapper = document.createElement('div');
		wrapper.className = 'credential-row';
		const label = document.createElement('label');
		label.htmlFor = 'tmdb-credential';
		label.textContent = 'Clé API ou jeton TMDB';
		const field = document.createElement('div');
		field.className = 'credential-field';
		tmdbCredentialInput = document.createElement('input');
		tmdbCredentialInput.id = 'tmdb-credential';
		tmdbCredentialInput.type = 'password';
		tmdbCredentialInput.autocomplete = 'off';
		tmdbCredentialInput.placeholder = 'Enregistrée uniquement sur cet appareil';
		tmdbCredentialInput.addEventListener('input', () => {
			currentTmdbCredential = tmdbCredentialInput.value.trim();
			if (status.classList.contains('error')) {
				status.className = '';
				status.textContent = 'Les changements seront appliqués après validation.';
			}
			updateSummary();
		});
		const revealButton = document.createElement('button');
		revealButton.className = 'credential-reveal';
		revealButton.type = 'button';
		revealButton.textContent = 'Voir';
		revealButton.setAttribute('aria-label', 'Afficher ou masquer la clé TMDB');
		revealButton.addEventListener('click', () => {
			const reveal = tmdbCredentialInput.type === 'password';
			tmdbCredentialInput.type = reveal ? 'text' : 'password';
			revealButton.textContent = reveal ? 'Masquer' : 'Voir';
		});
		field.append(tmdbCredentialInput, revealButton);
		const note = document.createElement('p');
		note.textContent = 'Stockée localement, jamais dans le code.';
		wrapper.append(label, field, note);
		return wrapper;
	}

	function createFeatureRow(feature) {
		const row = document.createElement('div');
		row.className = 'feature-row';
		row.title = feature.description;
		const copy = document.createElement('div');
		copy.className = 'feature-copy';
		const title = document.createElement('strong');
		title.textContent = feature.title;
		const description = document.createElement('p');
		description.textContent = feature.description;
		copy.append(title, description);

		const label = document.createElement('label');
		label.className = 'switch';
		label.title = feature.title;
		const input = document.createElement('input');
		input.type = 'checkbox';
		input.dataset.feature = feature.key;
		input.setAttribute('aria-label', feature.title);
		input.addEventListener('change', () => {
			currentValues[feature.key] = input.checked;
			updateSummary();
		});
		const track = document.createElement('span');
		track.setAttribute('aria-hidden', 'true');
		label.append(input, track);
		row.append(copy, label);
		inputs.set(feature.key, input);
		return row;
	}

	function createFeatureList(features) {
		const list = document.createElement('div');
		list.className = 'feature-list';
		features.forEach((feature) => list.appendChild(createFeatureRow(feature)));
		return list;
	}

	function createTraktSubgroups(features) {
		const categories = new Map();
		features.forEach((feature) => {
			const category = feature.category || 'Général';
			if (!categories.has(category)) categories.set(category, []);
			categories.get(category).push(feature);
		});

		const container = document.createElement('div');
		container.className = 'feature-subgroups';
		const categoryColumns = [
			['Lecture et Stremio'],
			['Notes et IMDb'],
			['Affichage des fiches', 'Navigation'],
		];
		categoryColumns.forEach((categoryNames) => {
			const column = document.createElement('div');
			column.className = 'feature-subgroup-column';
			categoryNames.forEach((categoryName) => {
				const categoryFeatures = categories.get(categoryName);
				if (!categoryFeatures) return;
				const subgroup = document.createElement('section');
				subgroup.className = 'feature-subgroup';
				const heading = document.createElement('h3');
				heading.textContent = categoryName;
				subgroup.append(heading, createFeatureList(categoryFeatures));
				column.appendChild(subgroup);
				categories.delete(categoryName);
			});
			container.appendChild(column);
		});
		categories.forEach((categoryFeatures, categoryName) => {
			const subgroup = document.createElement('section');
			subgroup.className = 'feature-subgroup';
			const heading = document.createElement('h3');
			heading.textContent = categoryName;
			subgroup.append(heading, createFeatureList(categoryFeatures));
			container.appendChild(subgroup);
		});
		return container;
	}

	function renderFeatures() {
		const grouped = new Map();
		settings.DEFINITIONS.forEach((feature) => {
			if (!grouped.has(feature.group)) grouped.set(feature.group, []);
			grouped.get(feature.group).push(feature);
		});

		grouped.forEach((features, groupName) => {
			const section = document.createElement('section');
			section.className = 'feature-group';
			section.dataset.group = getGroupTheme(groupName);
			const heading = document.createElement('h2');
			heading.textContent = groupName;
			const content = groupName === 'Trakt'
				? createTraktSubgroups(features)
				: createFeatureList(features);

			section.append(heading, content);
			if (groupName === 'Nouvel onglet') section.appendChild(createTmdbCredentialRow());
			groupsRoot.appendChild(section);
		});
	}

	function hasChanges() {
		return currentTmdbCredential !== savedTmdbCredential
			|| Object.keys(settings.DEFAULTS).some((key) => currentValues[key] !== savedValues[key]);
	}

	function updateSummary() {
		const keys = Object.keys(settings.DEFAULTS);
		const activeCount = keys.filter((key) => currentValues[key]).length;
		masterToggle.checked = activeCount === keys.length;
		masterToggle.indeterminate = activeCount > 0 && activeCount < keys.length;
		enabledCount.textContent = `${activeCount} sur ${keys.length} activées`;
		applyButton.disabled = !hasChanges();
		inputs.forEach((input, key) => {
			input.checked = currentValues[key];
		});
	}

	function setAll(enabled) {
		Object.keys(settings.DEFAULTS).forEach((key) => {
			currentValues[key] = enabled;
		});
		status.className = '';
		status.textContent = 'Les changements seront appliqués après validation.';
		updateSummary();
	}

	async function reloadActiveSupportedTab() {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id || !/^https:\/\/(app\.trakt\.tv|www\.imdb\.com|web\.stremio\.com)\//i.test(tab.url || '')) return false;
		await chrome.tabs.reload(tab.id);
		return true;
	}

	masterToggle.addEventListener('change', () => setAll(masterToggle.checked));
	resetButton.addEventListener('click', () => {
		currentValues = { ...settings.DEFAULTS };
		status.className = '';
		status.textContent = 'Réglages par défaut restaurés. Cliquez sur Appliquer.';
		updateSummary();
	});

	applyButton.addEventListener('click', async () => {
		if (currentValues.newTabMovieDiscovery && !currentTmdbCredential) {
			status.className = 'error';
			status.textContent = 'Ajoutez votre clé API ou jeton TMDB pour activer le nouvel onglet.';
			tmdbCredentialInput?.focus();
			return;
		}

		applyButton.disabled = true;
		resetButton.disabled = true;
		status.className = '';
		status.textContent = 'Enregistrement…';

		try {
			await Promise.all([
				settings.save(currentValues),
				settings.saveTmdbCredential(currentTmdbCredential),
			]);
			savedValues = { ...currentValues };
			savedTmdbCredential = currentTmdbCredential;

			let reloaded = false;
			try {
				reloaded = await reloadActiveSupportedTab();
			} catch {
				// Saving succeeded; a closed or restricted tab only prevents auto-refresh.
			}

			status.className = 'success';
			status.textContent = reloaded ? 'Enregistré. Onglet actualisé.' : 'Enregistré. Actualisez le site concerné.';
		} catch {
			status.className = 'error';
			status.textContent = 'Enregistrement impossible. Rechargez l’extension puis réessayez.';
		} finally {
			resetButton.disabled = false;
			updateSummary();
		}
	});

	renderFeatures();
	updateSummary();
	settings.ready.then((values) => {
		currentValues = { ...values };
		savedValues = { ...values };
		currentTmdbCredential = settings.getTmdbCredential();
		savedTmdbCredential = currentTmdbCredential;
		if (tmdbCredentialInput) tmdbCredentialInput.value = currentTmdbCredential;
		updateSummary();
	});
})();
