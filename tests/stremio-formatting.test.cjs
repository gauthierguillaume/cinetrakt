const test = require('node:test');
const assert = require('node:assert/strict');
require('../stremio-formatting.js');
const { getFileSizeRanges, getTitleRange } = globalThis.CineTraktStreamFormatting;

test('file sizes preserve offsets for addon typography and decimal units', () => {
	const text = '⠀⠀𝟭𝟯𝟰 ɢʙ\n866 ᴍʙ\n1.5 GiB\n2,4 Go\n1080p\n10bit\n7.1';
	assert.deepEqual(getFileSizeRanges(text).map(({ start, end }) => text.slice(start, end)),
		['𝟭𝟯𝟰 ɢʙ', '866 ᴍʙ', '1.5 GiB', '2,4 Go']);
});

test('stream titles use the whole logical line including Unicode and punctuation', () => {
	const title = '𝙏𝙝𝙚 𝙇𝙤𝙧𝙙: The Fellowship of the Ring';
	const text = `${title}\r\n(2001) Extended Edition\nAtmos 7.1`;
	const { start, end } = getTitleRange(text);
	assert.equal(text.slice(start, end), title);
	assert.equal(getTitleRange('One line').end, 8);
	assert.equal(getTitleRange('').end, 0);
});
