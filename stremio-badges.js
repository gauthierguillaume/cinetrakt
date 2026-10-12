(() => {
	'use strict';

	const ORIGINAL_CLASS = 'wos-stream-badge-original';
	const states = new Map();
	const suppressedTitles = new Map();
	const pngIds = new Set(['4k', '1080p', '720p', 'remux', 'bluray', 'webdl', 'webrip']);
	const labels = Object.freeze({
		'4k': '4K', '1080p': '1080p', '720p': '720p', remux: 'Remux', bluray: 'BluRay',
		webdl: 'WebDL', webrip: 'WebRip', hdr: 'HDR', hdr10: 'HDR10', hdr10plus: 'HDR10+',
		dv: 'Dolby Vision', sdr: 'SDR', '10bit': '10 bit', ai: 'AI', digital: 'Dolby Digital',
		digitalplus: 'Dolby Digital Plus', atmos: 'Dolby Atmos', truehd: 'Dolby TrueHD',
		dts: 'DTS', dtses: 'DTS-ES', dtshd: 'DTS-HD', dtshdma: 'DTS-HD Master Audio', dtsx: 'DTS:X',
		aac: 'AAC', opus: 'Opus', flac: 'FLAC', mp3: 'MP3', imax: 'IMAX',
		'channels-20': '2.0', 'channels-21': '2.1', 'channels-51': '5.1',
		'channels-61': '6.1', 'channels-71': '7.1',
	});

	function clear(original) {
		const state = states.get(original);
		if (!state) return;
		original.classList.remove(ORIGINAL_CLASS);
		state.presentation.remove();
		states.delete(original);
	}

	function clearAll() {
		for (const original of states.keys()) clear(original);
		for (const element of suppressedTitles.keys()) restoreTitle(element);
	}

	function restoreTitle(element) {
		if (!element.hasAttribute('title')) element.setAttribute('title', suppressedTitles.get(element));
		suppressedTitles.delete(element);
	}

	function suppressTitles(card) {
		for (const element of [card, ...card.querySelectorAll('[title]')]) {
			if (!element.hasAttribute('title')) continue;
			suppressedTitles.set(element, element.getAttribute('title'));
			element.removeAttribute('title');
		}
	}

	function createBadge(id, technical) {
		const badge = document.createElement('span');
		badge.className = `wos-stream-badge${technical ? ' wos-stream-technical-badge' : ''}`;
		badge.dataset.badge = id;
		const image = document.createElement('img');
		image.src = chrome.runtime.getURL(`assets/stream-badges/${id}.${pngIds.has(id) ? 'png' : 'svg'}`);
		image.alt = labels[id];
		image.draggable = false;
		image.addEventListener('error', () => image.replaceWith(document.createTextNode(labels[id])), { once: true });
		badge.appendChild(image);
		return badge;
	}

	function createRow(line, ids = [], technical = false) {
		const row = document.createElement('div');
		row.className = 'wos-stream-badge-row';
		if (ids.length) {
			ids.forEach((id) => row.appendChild(createBadge(id, technical)));
		} else {
			// Trim decorative indentation, never rewrite languages or provider details.
			row.textContent = line.replace(/^[\s\u2800]+|[\s\u2800]+$/gu, '');
			if (globalThis.CineTraktStreamFormatting.getFileSizeRanges(line).length) {
				row.classList.add('wos-stream-file-size');
				row.textContent = globalThis.CineTraktStreamFormatting.formatFileSizeText(row.textContent);
			}
		}
		return row;
	}

	function createVideoRow(line) {
		const parts = globalThis.CineTraktStreamFormatting.getVideoBadgeParts(line);
		if (!parts.some((part) => part.id)) return createRow(line);
		const row = createRow('');
		for (const part of parts) {
			if (part.id) row.appendChild(createBadge(part.id, true));
			else if (part.text.trim()) row.appendChild(document.createTextNode(part.text));
		}
		return row;
	}

	function createProviderRow(line) {
		const provider = globalThis.CineTraktStreamFormatting.getProviderPrefix(line);
		if (!provider) return createRow(line);
		const row = createRow('');
		row.classList.add('wos-stream-provider-row');
		const image = document.createElement('img');
		image.className = 'wos-stream-provider-logo';
		image.dataset.provider = provider.id;
		image.src = chrome.runtime.getURL(`assets/stream-providers/${provider.id}.png`);
		image.alt = provider.prefix.trim();
		image.draggable = false;
		image.addEventListener('error', () => image.replaceWith(document.createTextNode(provider.prefix)), { once: true });
		row.appendChild(image);
		const details = document.createElement('span');
		details.textContent = provider.rest.trimStart();
		row.appendChild(details);
		return row;
	}

	function createAudioRow(line) {
		const formatting = globalThis.CineTraktStreamFormatting;
		if (formatting.getProviderPrefix(line)) return createProviderRow(line);
		const ids = formatting.getTechnicalBadgeIds(line, 'audio');
		if (ids.length) return createRow(line, ids, true);
		const parts = formatting.getAudioChannelParts(line);
		if (!parts.some((part) => part.id)) return createRow(line);
		const row = createRow('');
		for (const part of parts) {
			if (part.id) row.appendChild(createBadge(part.id, true));
			else row.appendChild(document.createTextNode(part.text));
		}
		return row;
	}

	function createEditionRow(line) {
		const row = createRow('');
		for (const part of globalThis.CineTraktStreamFormatting.getEditionBadgeParts(line)) {
			if (part.id) row.appendChild(createBadge(part.id, true));
			else row.appendChild(document.createTextNode(part.text));
		}
		return row;
	}

	function render(original, build) {
		if (!original) return;
		const text = original.textContent || '';
		const previous = states.get(original);
		if (previous?.text === text && previous.presentation.parentElement === original.parentElement) return;
		clear(original);
		const presentation = build(text);
		if (!presentation) return;
		presentation.dataset.cinetraktStreamPresentation = 'true';
		// Keep Svelte's native text nodes and handlers for updates and option restoration.
		original.classList.add(ORIGINAL_CLASS);
		original.insertAdjacentElement('afterend', presentation);
		states.set(original, { presentation, text });
	}

	function apply(panel, enabled) {
		for (const original of states.keys()) {
			if (!enabled || !panel.contains(original)) clear(original);
		}
		for (const element of suppressedTitles.keys()) {
			if (!enabled || !panel.contains(element)) restoreTitle(element);
		}
		if (!enabled) return;
		const formatting = globalThis.CineTraktStreamFormatting;
		panel.querySelectorAll('a[class*="stream-container-"]').forEach((card) => {
			suppressTitles(card);
			const original = card.querySelector('[class*="addon-name-"]');
			const description = card.querySelector('[class*="description-container-"]');
			if (!original) return;
			if (!card.hasAttribute('download') && !formatting.getFileSizeRanges(original.textContent).length) {
				clear(original);
				clear(description);
				return;
			}
			render(original, (text) => {
				const lines = text.split(/\r\n|\r|\n/);
				const sourceLines = new Set(formatting.getSourceLineIndexes(text));
				const presentation = document.createElement('div');
				presentation.className = 'wos-stream-badge-details';
				lines.forEach((line, index) => {
					const ids = formatting.getBadgeIds(line);
					const row = ids.length ? createRow(line, ids) : createVideoRow(line);
					if (sourceLines.has(index)) row.classList.add('wos-stream-source-row');
					presentation.appendChild(row);
				});
				return presentation;
			});
			render(description, (text) => {
				const groups = formatting.getDescriptionGroups(text);
				const presentation = document.createElement('div');
				presentation.className = 'wos-stream-description-details';
				const heading = document.createElement('div');
				heading.className = 'wos-stream-heading-details';
				groups.header.forEach((line, index) => {
					const row = index === 0 ? createRow(line) : createEditionRow(line);
					row.classList.add(index === 0 ? 'wos-stream-title' : 'wos-stream-edition');
					heading.appendChild(row);
				});
				presentation.appendChild(heading);
				const detailLines = groups.details.filter((line) => line.trim());
				if (detailLines.length) {
					const details = document.createElement('div');
					details.className = 'wos-stream-technical-details';
					detailLines.forEach((line) => {
						details.appendChild(createAudioRow(line));
					});
					presentation.appendChild(details);
				}
				return presentation;
			});
		});
	}

	globalThis.CineTraktStreamBadges = Object.freeze({ apply, clearAll });
})();
