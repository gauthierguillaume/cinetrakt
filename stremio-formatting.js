(() => {
	'use strict';

	function getFileSizeRanges(text) {
		// Addons can use mathematical digits and small-cap units (e.g. 𝟭𝟯𝟰 ɢʙ).
		const pattern = /\p{Nd}+(?:[.,]\p{Nd}+)?[\t \u00a0\u2000-\u200a]*(?:[KMGT](?:i?B|o)|[ᴋᴍɢᴛ]ʙ)(?![\p{L}\p{N}])/giu;
		return Array.from(String(text || '').matchAll(pattern), (match) => ({
			start: match.index,
			end: match.index + match[0].length,
		}));
	}

	function formatFileSizeText(text) {
		const source = String(text || '');
		const ranges = getFileSizeRanges(source).reverse();
		let result = source;
		for (const { start, end } of ranges) {
			const size = source.slice(start, end).normalize('NFKD')
				.replace(/[ᴋᴍɢᴛʙ]/gu, (letter) => ({ 'ᴋ': 'K', 'ᴍ': 'M', 'ɢ': 'G', 'ᴛ': 'T', 'ʙ': 'B' }[letter]))
				.replace(/\s+/gu, ' ');
			result = result.slice(0, start) + size + result.slice(end);
		}
		return result;
	}

	function getBadgeIds(line) {
		// Match whole characteristic lines only, never titles or release filenames.
		const normalized = String(line || '').normalize('NFKD').toLowerCase()
			.replace(/[ʀᴇᴍᴜxʙʟᴀʏᴡᴅɪᴘᴋ]/g, (letter) => ({
				'ʀ': 'r', 'ᴇ': 'e', 'ᴍ': 'm', 'ᴜ': 'u', 'ʙ': 'b', 'ʟ': 'l',
				'ᴀ': 'a', 'ʏ': 'y', 'ᴡ': 'w', 'ᴅ': 'd', 'ɪ': 'i', 'ᴘ': 'p', 'ᴋ': 'k',
			}[letter] || letter))
			.replace(/[\s\u2800]+/gu, '');
		const resolution = { '4k': '4k', '2160p': '4k', '1080p': '1080p', '720p': '720p' };
		if (Object.hasOwn(resolution, normalized)) return [resolution[normalized]];
		const source = normalized.replace(/[._‐‑–−-]+/gu, '');
		const sources = { remux: 'remux', bluray: 'bluray', webdl: 'webdl', webrip: 'webrip' };
		if (Object.hasOwn(sources, source)) return [sources[source]];
		if (source === 'blurayremux') return ['bluray', 'remux'];
		if (source === 'remuxbluray') return ['remux', 'bluray'];
		return [];
	}

	function normalizeTechnicalText(text) {
		const letters = { 'ʜ': 'h', 'ᴅ': 'd', 'ʀ': 'r', 'ᴠ': 'v', 'ᴀ': 'a', 'ᴛ': 't',
			'ᴍ': 'm', 'ᴏ': 'o', 'ꜱ': 's', 'ʟ': 'l', 'ɪ': 'i', 'ᴄ': 'c', 'ᴇ': 'e',
			'ʙ': 'b', 'ᴜ': 'u', 'ᴘ': 'p', 'ꜰ': 'f', 'ɴ': 'n', 'ɢ': 'g' };
		return String(text || '').normalize('NFKD').toLowerCase()
			.replace(/[ʜᴅʀᴠᴀᴛᴍᴏꜱʟɪᴄᴇʙᴜᴘꜰɴɢ]/gu, (letter) => letters[letter])
			.replace(/[‐‑–−]/gu, '-').replace(/\u2800/gu, ' ');
	}

	function getSourceLineIndexes(text) {
		const lines = String(text || '').split(/\r\n|\r|\n/);
		const sizeIndex = lines.findIndex((line) => getFileSizeRanges(line).length);
		const indexes = [];
		// The source block precedes file size. It may be the first line when no
		// resolution is supplied; do not rely on a fixed row number or known logos.
		for (let index = 0; index < sizeIndex; index++) {
			const normalized = normalizeTechnicalText(lines[index]).replace(/\s+/gu, '');
			if (!normalized || /^(?:\d{3,4}[pi]|\d+k|[fus]?hd|uhd)$/u.test(normalized)) continue;
			indexes.push(index);
		}
		return indexes;
	}

	const videoTags = [
		['hdr10plus', /^hdr[\s-]*10\s*(?:\+|plus)/], ['hdr10', /^hdr[\s-]*10/],
		['hdr', /^hdr/], ['dv', /^(?:dolby[\s-]*vision|dovi|dv)/],
		['sdr', /^sdr/], ['10bit', /^10[\s-]*bit/], ['ai', /^ai/],
	];
	const audioTags = [
		['atmos', /^(?:dolby[\s-]*)?atmos/], ['truehd', /^(?:dolby[\s-]*)?true[\s-]*hd/],
		['dtshdma', /^dts[\s-]*hd[\s-]*(?:ma|master[\s-]*audio)/],
		['dtsx', /^dts\s*:\s*x/], ['dtses', /^dts[\s-]*(?:es|☰s)/],
		['dtshd', /^dts[\s-]*hd/], ['dts', /^dts/],
		['digitalplus', /^(?:(?:dolby[\s-]*)?digital\s*(?:\+|plus)|dd\s*(?:\+|plus|p)|e[\s-]*ac[\s-]*3)/],
		['digital', /^(?:(?:dolby[\s-]*)?digital|dd|ac[\s-]*3)/],
		['aac', /^aac/], ['opus', /^opus/], ['flac', /^flac/], ['mp3', /^mp3/],
		...['2.0', '2.1', '5.1', '6.1', '7.1'].map((channels) => [
			`channels-${channels.replace('.', '')}`, new RegExp(`^${channels.replace('.', '\\.')}`),
		]),
	];

	function getTechnicalBadgeIds(line, kind) {
		// Replace a technical line only if every token is understood. Unknown variants
		// stay readable as text, rather than being mislabeled as a similar format.
		let remaining = normalizeTechnicalText(line).replace(/^[\s◗◖]+/u, '');
		const tags = kind === 'video' ? videoTags : kind === 'audio' ? audioTags : [];
		const ids = [];
		while (remaining) {
			const tag = tags.find(([, pattern]) => {
				const match = remaining.match(pattern);
				return match && /^(?:$|[\s◗◖])/u.test(remaining.slice(match[0].length));
			});
			if (!tag) return [];
			ids.push(tag[0]);
			remaining = remaining.slice(remaining.match(tag[1])[0].length).replace(/^[\s◗◖]+/u, '');
		}
		return ids;
	}

	function getVideoBadgeParts(line) {
		// Keep unknown tags verbatim without withholding the known logos beside them.
		const tokens = String(line || '').split(/([\s\u2800]+)/u);
		const parts = [];
		for (let index = 0; index < tokens.length;) {
			let matched = false;
			for (const count of [5, 3, 1]) {
				const text = tokens.slice(index, index + count).join('');
				const ids = getTechnicalBadgeIds(text, 'video');
				if (ids.length !== 1) continue;
				parts.push({ id: ids[0], text });
				index += count;
				matched = true;
				break;
			}
			if (!matched) {
				const text = tokens[index++];
				if (parts.length && !parts.at(-1).id) parts.at(-1).text += text;
				else parts.push({ text });
			}
		}
		return parts;
	}

	function getAudioChannelParts(line) {
		// An unsupported codec must not prevent an exact, standalone channel logo.
		// Preserve its full name and qualifiers instead of guessing a codec badge.
		return String(line || '').split(/([\s\u2800]+)/u).map((text) => {
			const ids = getTechnicalBadgeIds(text, 'audio');
			return ids.length === 1 && ids[0].startsWith('channels-') ? { id: ids[0], text } : { text };
		});
	}

	function getEditionBadgeParts(line) {
		const parts = [];
		for (const text of String(line || '').split(/([\s\u2800]+)/u)) {
			if (normalizeTechnicalText(text) === 'imax') parts.push({ id: 'imax', text });
			else if (parts.length && !parts.at(-1).id) parts.at(-1).text += text;
			else parts.push({ text });
		}
		return parts;
	}

	const providerIcons = new Map([
		['❖', 'emblem'], ['🌀', 'streamfusion'], ['🌸', 'uwufr'], ['🟢', 'torrentio'],
		['☄', 'comet'], ['✨', 'sparkles'], ['🖥', 'zilean'], ['🌠', 'meteor'], ['🧲', 'magnet'],
	]);

	function getProviderPrefix(line) {
		// Only replace the leading provider marker, never flags or emojis in its text.
		const match = String(line || '').match(/^[\s\u2800]*(❖|🌀|🌸|🟢|☄|✨|🖥|🌠|🧲)\uFE0F?(?=$|[\s\u2800\[])/u);
		if (!match) return null;
		return { id: providerIcons.get(match[1]), prefix: match[0], rest: String(line).slice(match[0].length) };
	}

	function getDescriptionGroups(text) {
		const lines = String(text || '').split(/\r\n|\r|\n/);
		const headerCount = getTechnicalBadgeIds(lines[1], 'audio').length || getProviderPrefix(lines[1]) ? 1 : 2;
		return { header: lines.slice(0, headerCount), details: lines.slice(headerCount) };
	}

	globalThis.CineTraktStreamFormatting = Object.freeze({
		getFileSizeRanges, formatFileSizeText, getBadgeIds, getSourceLineIndexes,
		getTechnicalBadgeIds, getVideoBadgeParts, getAudioChannelParts, getEditionBadgeParts,
		getProviderPrefix, getDescriptionGroups,
	});
})();
