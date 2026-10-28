const test = require('node:test');
const assert = require('node:assert/strict');
require('../stremio-formatting.js');
const { getFileSizeRanges, formatFileSizeText, getBadgeIds, getSourceLineIndexes, getTechnicalBadgeIds, getVideoBadgeParts, getAudioChannelParts, getEditionBadgeParts,
	getProviderPrefix, getDescriptionGroups } = globalThis.CineTraktStreamFormatting;

test('file sizes preserve offsets for addon typography and decimal units', () => {
	const text = '⠀⠀𝟭𝟯𝟰 ɢʙ\n866 ᴍʙ\n1.5 GiB\n2,4 Go\n1080p\n10bit\n7.1';
	assert.deepEqual(getFileSizeRanges(text).map(({ start, end }) => text.slice(start, end)),
		['𝟭𝟯𝟰 ɢʙ', '866 ᴍʙ', '1.5 GiB', '2,4 Go']);
});

test('file size presentation removes decorative glyphs without changing values or units', () => {
	assert.equal(formatFileSizeText('𝟰𝟭 ɢʙ'), '41 GB');
	assert.equal(formatFileSizeText('𝟴𝟮𝟲 ᴍʙ'), '826 MB');
	assert.equal(formatFileSizeText('1,5 GiB / 𝟮.𝟰 ɢʙ'), '1,5 GiB / 2.4 GB');
	assert.equal(formatFileSizeText('🇫🇷 𝙏𝙞𝙩𝙡𝙚 7.1'), '🇫🇷 𝙏𝙞𝙩𝙡𝙚 7.1');
});

test('stream heading retains the full Unicode title and edition without rewriting them', () => {
	const title = '𝙏𝙝𝙚 𝙇𝙤𝙧𝙙: The Fellowship of the Ring';
	assert.deepEqual(getDescriptionGroups(`${title}\r\n2001 Extended Edition\nAtmos 7.1`).header,
		[title, '2001 Extended Edition']);
});

test('badges recognize only their exact resolution or source including addon typography', () => {
	const cases = [
		['⠀⠀⠀𝟰𝗞', ['4k']], ['2160p', ['4k']], ['⠀⠀𝟭𝟬𝟴𝟬ₚ', ['1080p']],
		['　⠀𝟳𝟮𝟬ₚ', ['720p']], ['⠀⠀ʷ ᵉ ᵇ ⁻ ᵈ ˡ', ['webdl']],
		['⠀⠀ʷ ᵉ ᵇ ʳ ⁱ ᵖ', ['webrip']], ['ʀᴇᴍᴜx', ['remux']],
		['ʙʟᴜ-ʀᴀʏ', ['bluray']], ['Blu-ray Remux', ['bluray', 'remux']],
		['Remux BluRay', ['remux', 'bluray']],
	];
	for (const [line, expected] of cases) assert.deepEqual(getBadgeIds(line), expected, line);
});

test('source rows include unknown text and DVD even when resolution is absent', () => {
	for (const [text, indexes] of [
		['4K\nBluRay\n41 GB\nHDR\n🇫🇷', [1]],
		['1080p\nUnknown source\n826 MB\nDV', [1]],
		['⠀𝘿𝙑𝘿 ʳ ᵉ ᵐ ᵘ ˣ\n⠀⠀𝟱 ɢʙ\n🇫🇷', [0]],
		['DVD\n2 GB\n🇫🇷', [0]], ['\n480p\nDVD\n966 MB', [2]],
		['9 GB\nHDR\n🇫🇷', []], ['1080p\n826 MB\n🇫🇷', []],
	]) assert.deepEqual(getSourceLineIndexes(text), indexes, text);
});

test('unknown or ambiguous characteristics never become a different badge', () => {
	for (const line of ['144p', '1080i', '480p', '8K', '10.80p', '4-k', 'UHD', 'BDRip', 'BDRemux', 'HDR10+',
		'92 GB', '🇫🇷', 'WebDL WebRip', 'WEB-DL 10bit', 'Movie.2026.1080p.WEB-DL.mkv',
		'4K Movie', 'The Remux', 'constructor', '__proto__', '']) {
		assert.deepEqual(getBadgeIds(line), [], line);
	}
});

test('video logos distinguish HDR variants and preserve the original order', () => {
	const cases = [
		['ʜᴅʀ', ['hdr']], ['ʜᴅʀ¹⁰', ['hdr10']], ['ʜᴅʀ¹⁰⁺　ᴅᴠ', ['hdr10plus', 'dv']],
		['HDR10 Plus Dolby Vision', ['hdr10plus', 'dv']], ['DV', ['dv']],
		['𝟭𝟬ᵇⁱᵗ SDR', ['10bit', 'sdr']],
	];
	for (const [line, expected] of cases) assert.deepEqual(getTechnicalBadgeIds(line, 'video'), expected, line);
});

test('audio logos handle addon typography, codecs and exact channel layouts', () => {
	const cases = [
		['◗◖ᴀᴛᴍᴏꜱ　◗◖ᴅɪɢɪᴛᴀʟ+　𝟱.𝟭', ['atmos', 'digitalplus', 'channels-51']],
		['Dolby Digital 2.1', ['digital', 'channels-21']], ['E-AC-3 7.1', ['digitalplus', 'channels-71']],
		['DDP 5.1', ['digitalplus', 'channels-51']], ['DTS-HD MA 6.1', ['dtshdma', 'channels-61']],
		['Dolby TrueHD Atmos 7.1', ['truehd', 'atmos', 'channels-71']],
		['DTS:X', ['dtsx']], ['DTS-HD', ['dtshd']], ['DTS', ['dts']],
		['𝕕𝕥𝕤 ☰S　𝟱.𝟭', ['dtses', 'channels-51']], ['DTS-ES 6.1', ['dtses', 'channels-61']],
		['𝗔𝗔𝗖　𝟮.𝟬', ['aac', 'channels-20']], ['𝙤𝙥𝙪𝙨　𝟱.𝟭', ['opus', 'channels-51']],
		['FLAC MP3', ['flac', 'mp3']],
	];
	for (const [line, expected] of cases) assert.deepEqual(getTechnicalBadgeIds(line, 'audio'), expected, line);
});

test('unknown audio variants retain their qualifiers beside exact channel logos', () => {
	for (const [line, expected] of [
		['DTS-HD HR 𝟱.𝟭', ['channels-51']], ['AAC LC 𝟮.𝟬', ['channels-20']],
		['Unknown 7.1 5.1 2.0', ['channels-71', 'channels-51', 'channels-20']],
		['DTS-ES Matrix 6.1', ['channels-61']], ['5.10 7.1.4 filename.5.1.mkv', []],
	]) {
		const parts = getAudioChannelParts(line);
		assert.deepEqual(parts.filter((part) => part.id).map((part) => part.id), expected, line);
		assert.equal(parts.map((part) => part.text).join(''), line);
	}
});

test('video logos survive AI and unknown adjacent tags without changing their meaning', () => {
	const line = 'ʜᴅʀ¹⁰⁺　ᴅᴠ　ᴀɪ';
	assert.deepEqual(getVideoBadgeParts(line).filter((part) => part.id).map((part) => part.id), ['hdr10plus', 'dv', 'ai']);
	for (const source of ['HDR10+ unknown DV', 'Dolby Vision experimental 10 bit', line]) {
		const parts = getVideoBadgeParts(source);
		assert.equal(parts.map((part) => part.text).join(''), source);
	}
	assert.deepEqual(getVideoBadgeParts('HDR10+ unknown DV').filter((part) => part.id).map((part) => part.id), ['hdr10plus', 'dv']);
	for (const source of ['HDR100', 'HDR10+DV', 'AI-enhanced', '🇫🇷  🇬🇧ᵛᵒ']) {
		assert.equal(getVideoBadgeParts(source).some((part) => part.id), false, source);
	}
});

test('the nine provider markers use exactly the supplied mapping, only at the start', () => {
	const mapping = [['❖', 'emblem'], ['🌀', 'streamfusion'], ['🌸', 'uwufr'], ['🟢', 'torrentio'],
		['☄️', 'comet'], ['✨', 'sparkles'], ['🖥️', 'zilean'], ['🌠', 'meteor'], ['🧲', 'magnet']];
	const fs = require('node:fs');
	const path = require('node:path');
	for (const [emoji, id] of mapping) {
		const line = `  ${emoji} [ 𐞥ᵗᶻ ]　c411 - cache 🌐 🇫🇷`;
		const provider = getProviderPrefix(line);
		assert.equal(provider.id, id);
		assert.equal(provider.prefix + provider.rest, line);
		assert.equal(getProviderPrefix(`Provider ${emoji} [name]`), null);
		assert.ok(fs.existsSync(path.join(__dirname, `../assets/stream-providers/${id}.png`)));
	}
	for (const line of ['🇫🇷  🌐  🇬🇧ᵛᵒ', '⭐ IMDb 8.9', '🟢Movie', 'ordinary text', '']) assert.equal(getProviderPrefix(line), null);
	assert.equal(getProviderPrefix('☄ [name]').id, 'comet');
	assert.equal(getProviderPrefix('🖥 [name]').id, 'zilean');
	const manifest = require('../manifest.json');
	assert.deepEqual(manifest.web_accessible_resources.find((entry) => entry.resources.includes('assets/stream-providers/*.png')).matches, ['https://web.stremio.com/*']);
});

test('unsupported technical data and languages are never replaced by approximate logos', () => {
	for (const kind of ['audio', 'video']) {
		for (const line of ['HDR10+ unknown', 'HDR100', 'HDR10+DV', 'DTS-HD HR', '7.1.4', '5.10',
			'Digital movie', 'AAC LC 2.0', '🇫🇷  🇬🇧ᵛᵒ', '🟢 [ btm ] thepiratebay', '92 GB', '']) {
			assert.deepEqual(getTechnicalBadgeIds(line, kind), [], `${kind}: ${line}`);
		}
	}
});

test('description grouping keeps title and edition together before technical details', () => {
	assert.deepEqual(getDescriptionGroups('Title\r\n2026 IMAX\r\nAtmos 5.1\r\n🟢 [ btm ]'), {
		header: ['Title', '2026 IMAX'], details: ['Atmos 5.1', '🟢 [ btm ]'],
	});
	assert.deepEqual(getDescriptionGroups('Title\nAAC 2.0\nProvider'), {
		header: ['Title'], details: ['AAC 2.0', 'Provider'],
	});
	assert.deepEqual(getDescriptionGroups('Title\n🌀 dmm - cache'), {
		header: ['Title'], details: ['🌀 dmm - cache'],
	});
});

test('IMAX edition logos replace only the exact tag while preserving the year and other editions', () => {
	for (const source of ['2026 IMAX', '𝟮𝟬𝟮𝟲　ɪᴍᴀx　Extended Edition', 'IMAX']) {
		const parts = getEditionBadgeParts(source);
		assert.deepEqual(parts.filter((part) => part.id).map((part) => part.id), ['imax']);
		assert.equal(parts.map((part) => part.text).join(''), source);
	}
	for (const source of ['2026', '2026 IMAX-like', '2026 IMAXEnhanced', '2026 IMAX-Enhanced']) {
		assert.equal(getEditionBadgeParts(source).some((part) => part.id), false, source);
	}
});

test('every supported technical logo is local and exposed only to Stremio', () => {
	const fs = require('node:fs');
	const path = require('node:path');
	const ids = ['hdr', 'hdr10', 'hdr10plus', 'dv', 'sdr', '10bit', 'ai', 'digital', 'digitalplus',
		'atmos', 'truehd', 'dts', 'dtses', 'dtshd', 'dtshdma', 'dtsx', 'aac', 'opus', 'flac', 'mp3', 'imax',
		'channels-20', 'channels-21', 'channels-51', 'channels-61', 'channels-71'];
	for (const id of ids) {
		const svg = fs.readFileSync(path.join(__dirname, `../assets/stream-badges/${id}.svg`), 'utf8');
		assert.match(svg, /<svg\b/);
		assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i);
	}
	const manifest = require('../manifest.json');
	const entry = manifest.web_accessible_resources.find((item) => item.resources.includes('assets/stream-badges/*.svg'));
	assert.deepEqual(entry.matches, ['https://web.stremio.com/*']);
});

function streamFixture() {
	class Element {
		constructor(tag = 'div') {
			this.tagName = tag; this.children = []; this.attrs = new Map(); this.dataset = {};
			this.className = ''; this.value = ''; this.parentElement = null;
			this.classList = {
				add: (name) => { this.className = `${this.className} ${name}`.trim(); },
				remove: (name) => { this.className = this.className.split(' ').filter((item) => item !== name).join(' '); },
			};
		}
		set textContent(value) { this.value = value; this.children = []; }
		get textContent() { return this.value + this.children.map((child) => child.textContent).join(''); }
		setAttribute(name, value) { this.attrs.set(name, String(value)); }
		getAttribute(name) { return this.attrs.get(name) ?? null; }
		hasAttribute(name) { return this.attrs.has(name); }
		removeAttribute(name) { this.attrs.delete(name); }
		appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
		insertAdjacentElement(position, child) {
			assert.equal(position, 'afterend'); child.parentElement = this.parentElement;
			this.parentElement.children.splice(this.parentElement.children.indexOf(this) + 1, 0, child);
		}
		remove() {
			if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
			this.parentElement = null;
		}
		contains(child) { return child === this || this.children.some((item) => item.contains(child)); }
		addEventListener() {}
		querySelectorAll(selector) {
			const matches = (item) => selector === '[title]' ? item.hasAttribute('title')
				: selector.startsWith('.') ? item.className.split(' ').includes(selector.slice(1))
					: selector.includes('class*=') && item.className.includes(selector.match(/class\*="([^"]+)"/)[1])
						&& (!selector.startsWith('a') || item.tagName === 'a');
			const descendants = this.children.flatMap((item) => [item, ...item.querySelectorAll('*')]);
			return selector === '*' ? descendants : descendants.filter(matches);
		}
		querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
	}
	const panel = new Element();
	const card = panel.appendChild(new Element('a')); card.className = 'stream-container-test';
	card.setAttribute('download', ''); card.setAttribute('title', 'AIOStreams');
	const info = card.appendChild(new Element()); info.className = 'addon-name-test';
	info.textContent = '4K\n51 GB\nʜᴅʀ¹⁰⁺　ᴅᴠ　ᴀɪ\n🇫🇷 🌐 🇬🇧'; info.setAttribute('title', info.textContent);
	const description = card.appendChild(new Element()); description.className = 'description-container-test';
	description.textContent = 'Title\n2001 Extended Edition\nAtmos 7.1\n🟢 [ release ] tracker - cache';
	description.setAttribute('title', description.textContent);
	const context = require('node:vm').createContext({
		CineTraktStreamFormatting: globalThis.CineTraktStreamFormatting,
		document: { createElement: (tag) => new Element(tag), createTextNode: (text) => { const node = new Element('#text'); node.textContent = text; return node; } },
		chrome: { runtime: { getURL: (path) => `chrome-extension://test/${path}` } },
	});
	require('node:vm').runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../stremio-badges.js'), 'utf8'), context);
	return { panel, card, info, description, badges: context.CineTraktStreamBadges };
}

test('stream rendering preserves native content, suppresses all tooltips and restores it on disable', () => {
	const { panel, card, info, description, badges } = streamFixture();
	const originalText = [info.textContent, description.textContent];
	badges.apply(panel, true);
	assert.equal(panel.querySelectorAll('[title]').length, 0);
	assert.deepEqual(panel.querySelectorAll('.wos-stream-technical-badge').map((item) => item.dataset.badge),
		['hdr10plus', 'dv', 'ai', 'atmos', 'channels-71']);
	assert.equal(panel.querySelector('.wos-stream-provider-logo').dataset.provider, 'torrentio');
	assert.equal(panel.querySelector('.wos-stream-provider-row').textContent, '[ release ] tracker - cache');
	assert.ok(panel.querySelector('.wos-stream-badge-details').textContent.includes('🇫🇷 🌐 🇬🇧'));
	badges.apply(panel, true);
	assert.equal(panel.querySelectorAll('.wos-stream-description-details').length, 1);
	card.setAttribute('title', 'Updated addon');
	badges.apply(panel, true);
	assert.equal(card.hasAttribute('title'), false);
	badges.apply(panel, false);
	assert.equal(card.getAttribute('title'), 'Updated addon');
	assert.equal(info.getAttribute('title'), originalText[0]);
	assert.equal(description.getAttribute('title'), originalText[1]);
	assert.deepEqual([info.textContent, description.textContent], originalText);
	assert.equal(panel.querySelectorAll('.wos-stream-description-details').length, 0);
	assert.equal(info.className, 'addon-name-test');
});

test('updated streams rebuild their logos and cleanup restores tooltips', () => {
	const { panel, info, description, badges } = streamFixture();
	badges.apply(panel, true);
	info.textContent = '1080p\n2 GB\nSDR';
	description.textContent = 'Next title\n🌀 dmm - cache';
	badges.apply(panel, true);
	assert.equal(panel.querySelectorAll('.wos-stream-badge-details').length, 1);
	assert.equal(panel.querySelector('.wos-stream-badge').dataset.badge, '1080p');
	assert.equal(panel.querySelector('.wos-stream-provider-logo').dataset.provider, 'streamfusion');
	assert.equal(panel.querySelector('.wos-stream-heading-details').textContent, 'Next title');
	badges.clearAll();
	assert.equal(panel.querySelectorAll('[title]').length, 3);
	assert.equal(panel.querySelectorAll('.wos-stream-badge-details').length, 0);
});

test('audio presentation uses consistent channel badges and preserves unsupported codec and provider text', () => {
	const { panel, info, description, badges } = streamFixture();
	info.textContent = '4K\n𝟰𝟭 ɢʙ';
	description.textContent = 'Toy Story\n1995\n𝕕𝕥𝕤 ☰S　𝟱.𝟭\nAAC LC 𝟮.𝟬\n❖ [ 5.1 ] tracker';
	badges.apply(panel, true);
	assert.equal(panel.querySelector('.wos-stream-file-size').textContent, '41 GB');
	assert.deepEqual(panel.querySelectorAll('.wos-stream-technical-badge').map((item) => item.dataset.badge),
		['dtses', 'channels-51', 'channels-20']);
	assert.ok(panel.querySelector('.wos-stream-technical-details').textContent.includes('AAC LC'));
	assert.equal(panel.querySelector('.wos-stream-provider-row').textContent, '[ 5.1 ] tracker');
	badges.clearAll();
	assert.equal(info.textContent, '4K\n𝟰𝟭 ɢʙ');
});

test('source presentation marks both text and logo rows without coloring resolution, size or languages', () => {
	const { panel, info, badges } = streamFixture();
	for (const source of ['DVD', 'DVD Remux', 'Unknown source', 'BluRay']) {
		info.textContent = `1080p\n${source}\n2 GB\nHDR\n🇫🇷`;
		badges.apply(panel, true);
		const rows = panel.querySelectorAll('.wos-stream-source-row');
		assert.equal(rows.length, 1);
		if (source === 'BluRay') assert.equal(rows[0].querySelector('.wos-stream-badge').dataset.badge, 'bluray');
		else assert.equal(rows[0].textContent, source);
	}
	badges.clearAll();
});

test('IMAX logo is confined to the edition row and native stream text is restored', () => {
	const { panel, description, badges } = streamFixture();
	const text = 'IMAX movie title\n2026 IMAX Extended Edition\nAtmos 5.1\n❖ IMAX provider';
	description.textContent = text;
	badges.apply(panel, true);
	const edition = panel.querySelector('.wos-stream-edition');
	assert.equal(edition.querySelector('.wos-stream-badge').dataset.badge, 'imax');
	assert.equal(edition.textContent, '2026  Extended Edition');
	assert.equal(panel.querySelectorAll('.wos-stream-technical-badge').filter((badge) => badge.dataset.badge === 'imax').length, 1);
	assert.equal(panel.querySelector('.wos-stream-title').textContent, 'IMAX movie title');
	badges.clearAll();
	assert.equal(description.textContent, text);
});
