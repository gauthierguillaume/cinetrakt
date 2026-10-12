const test = require('node:test');
const assert = require('node:assert/strict');
require('../trakt-collection-utils.js');
const { isOfficialMovieCollection, findUniqueOfficialMovieCollection } = globalThis.CineTraktCollectionUtils;

const official = (slug, title) => ({
	href: `/lists/official/${slug}?mode=media`, title, variant: 'official', owner: '@Trakt',
});

test('Fellowship selects its collection after the more popular editorial list', () => {
	const editorial = official('1001-movies-you-must-see-before-you-die', '1001 Movies You Must See Before You Die');
	const collection = official('the-lord-of-the-rings-collection', 'The Lord of the Rings Collection');
	const afi = official('afi-s-100-years-100-movies-10th-anniversary-edition', "AFI's 100 Years... 100 Movies (10th Anniversary Edition)");
	assert.equal(findUniqueOfficialMovieCollection([editorial, collection, afi]), collection);
	assert.equal(findUniqueOfficialMovieCollection([afi, editorial, collection]), collection);
	assert.equal(findUniqueOfficialMovieCollection([editorial, afi]), null);
});

test('collections require an official Trakt identity and a collection title and path', () => {
	const collection = official('spider-man-mcu-collection', 'Spider-Man (MCU) Collection');
	assert.equal(isOfficialMovieCollection(collection), true);
	assert.equal(isOfficialMovieCollection({ ...collection, href: 'https://app.trakt.tv/lists/official/spider-man-mcu-collection/' }), true);
	for (const override of [
		{ href: '/lists/users/trakt/lists/spider-man-mcu-collection' },
		{ href: 'https://other.example/lists/official/spider-man-mcu-collection' },
		{ href: '/lists/official/spider-man-mcu-collection/items' },
		{ href: '/lists/official/some-popular-list' },
		{ title: 'Collection of 1001 Movies' }, { owner: '@OtherTrakt' },
		{ variant: 'personal' }, { owner: '' }, { href: null },
	]) assert.equal(isOfficialMovieCollection({ ...collection, ...override }), false, JSON.stringify(override));
});

test('missing or ambiguous collections never fall back to another list', () => {
	assert.equal(findUniqueOfficialMovieCollection([]), null);
	const first = official('the-lord-of-the-rings-collection', 'The Lord of the Rings Collection');
	const second = official('another-collection', 'Another Collection');
	assert.equal(findUniqueOfficialMovieCollection([first, second]), null);
	assert.equal(findUniqueOfficialMovieCollection([first, { ...first, href: `${first.href}&page=2` }]), first);
});

test('collection selection is loaded before the Trakt customization script', () => {
	const manifest = require('../manifest.json');
	const scripts = manifest.content_scripts.find((entry) => entry.matches.includes('https://app.trakt.tv/*') && entry.run_at === 'document_idle').js;
	assert.ok(scripts.indexOf('trakt-collection-utils.js') >= 0);
	assert.ok(scripts.indexOf('trakt-collection-utils.js') < scripts.indexOf('trakt-customizations.js'));
});
