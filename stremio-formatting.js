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

	globalThis.CineTraktStreamFormatting = Object.freeze({ getFileSizeRanges, getTitleRange });
})();
