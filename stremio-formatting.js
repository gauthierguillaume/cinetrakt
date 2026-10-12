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

	function getTitleRange(text) {
		const source = String(text || '');
		const end = source.search(/[\r\n]/);
		return { start: 0, end: end === -1 ? source.length : end };
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

	const videoTags = [
		['hdr10plus', /^hdr[\s-]*10\s*(?:\+|plus)/], ['hdr10', /^hdr[\s-]*10/],
		['hdr', /^hdr/], ['dv', /^(?:dolby[\s-]*vision|dovi|dv)/],
		['sdr', /^sdr/], ['10bit', /^10[\s-]*bit/], ['ai', /^ai/],
	];
	const audioTags = [
		['atmos', /^(?:dolby[\s-]*)?atmos/], ['truehd', /^(?:dolby[\s-]*)?true[\s-]*hd/],
		['dtshdma', /^dts[\s-]*hd[\s-]*(?:ma|master[\s-]*audio)/],
		['dtsx', /^dts\s*:\s*x/], ['dtshd', /^dts[\s-]*hd/], ['dts', /^dts/],
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
		getFileSizeRanges, getTitleRange, getBadgeIds, getTechnicalBadgeIds, getVideoBadgeParts,
		getProviderPrefix, getDescriptionGroups,
	});
})();
