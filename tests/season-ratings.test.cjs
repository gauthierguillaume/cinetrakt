const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const utils = require('../season-rating-utils.js');

test('season ratings use the official show endpoint and exclude specials, future and unscored seasons', () => {
	assert.equal(utils.getSeasonRatingsUrl('/shows/Supernatural?season=8'), 'https://api.trakt.tv/shows/supernatural/seasons?extended=full,images');
	for (const route of ['/movies/dune-2021', '/shows/test/seasons/1', 'https://evil.test/shows/test']) assert.equal(utils.getSeasonRatingsUrl(route), '');
	const season = (number, rating, first_aired = '2010-01-01', episode_count = 10) => ({ number, rating, first_aired, episode_count });
	assert.deepEqual(utils.parseSeasonRatings([season(4, 8.6), season(1, 8.01), season(0, 9), season(2, null),
		season(3, 9, '2040-01-01'), season(5, 8, null), season(6, 7, 'invalid'), season(7, 8, '2010-01-01', 0),
		season(8, '8'), season(9, 11), season(4, 1)], Date.parse('2026-01-01')),
		[{ season: 1, percent: 80 }, { season: 4, percent: 86 }]);
	assert.equal(utils.parseSeasonRatings({}), null);
	assert.deepEqual(utils.parseSeasonRatings([]), []);
});

test('season artwork is keyed by the real season number and uses small official Trakt posters only', () => {
	const image = 'media.trakt.tv/images/seasons/000/004/807/posters/original/498fd10c21.jpg.webp';
	assert.deepEqual(utils.parseSeasonPosters([
		{ number: 9, images: { poster: [image] } }, { number: 1, images: { poster: [] } },
		{ number: 12, images: { poster: ['https://evil.test/images/poster.jpg', image.replace('/807/', '/808/')] } },
		{ number: -1, images: { poster: [image] } }, { number: '2', images: { poster: [image] } },
		{ number: 9, images: { poster: [image.replace('/807/', '/999/')] } },
	]), { 9: `https://${image.replace('/original/', '/thumb/')}`, 12: `https://${image.replace('/807/', '/808/').replace('/original/', '/thumb/')}` });
	for (const url of ['javascript:alert(1)', 'http://' + image, 'https://media.trakt.tv.evil.test/' + image,
		'https://media.trakt.tv/images/shows/000/004/807/posters/original/a.jpg', 'https://user:pass@' + image,
		'https://' + image + '?redirect=evil', 'https://' + image + '#hash']) assert.equal(utils.normalizeSeasonPosterUrl(url), '');
	assert.deepEqual(utils.parseSeasonPosters(null), {});
});

test('compact charts preserve every season and exact percentages while keeping dense labels legible', () => {
	const data = Array.from({ length: 15 }, (_, i) => ({ season: i + 1, percent: i === 3 ? 86 : i === 6 ? 74 : 80 }));
	const chart = utils.buildSeasonChart(data);
	assert.equal(chart.points.length, 15);
	assert.deepEqual(chart.points.map(p => p.percent), data.map(p => p.percent));
	assert.equal(chart.peak.season, 4);
	assert.equal(chart.low.season, 7);
	assert.deepEqual(chart.ticks.map(p => p.season), data.map(p => p.season));
	assert.ok(chart.points.every(p => p.x >= 5 && p.x <= utils.CHART_WIDTH - 5 && p.y >= 6 && p.y <= 57));
	assert.equal((chart.line.match(/C/g) || []).length, 14);
	assert.match(chart.area, /L215 57L5 57Z$/);
});

test('flat and single-season charts remain finite and hit-testing includes first and last seasons', () => {
	for (const count of [1, 2, 5]) for (const percent of [0, 60, 100]) {
		const chart = utils.buildSeasonChart(Array.from({ length: count }, (_, i) => ({ season: i + 1, percent })));
		assert.doesNotMatch(chart.line + chart.area, /NaN|Infinity/);
		assert.equal(utils.nearestSeasonIndex(chart.points, -100), 0);
		assert.equal(utils.nearestSeasonIndex(chart.points, 1000), count - 1);
		assert.equal(chart.ticks.length, count);
	}
	assert.equal(utils.nearestSeasonIndex([], 30), -1);
	assert.equal(utils.buildSeasonChart(null).points.length, 0);
});

test('season card supports pointer and keyboard percentages and opens the current IMDb episode ratings', () => {
	let markupWrites = 0; const listeners = {}; const opened = []; const slots = new Map();
	function node() {
		return { textContent: '', hidden: false, attributes: {}, style: {}, dataset: {},
			setAttribute(key, value) { this.attributes[key] = value; if (key === 'hidden') this.hidden = true; },
			getBoundingClientRect: () => ({ left: 100, width: 192 }),
		};
	}
	const button = { ...node(), addEventListener(type, callback) { listeners[type] = callback; },
		querySelector(selector) { if (!slots.has(selector)) slots.set(selector, node()); return slots.get(selector); },
		set innerHTML(value) { this.markup = value; markupWrites++; },
	};
	const context = vm.createContext({ CineTraktSeasonRatings: utils,
		document: { getElementById: () => true, createElement: () => button } });
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../trakt-season-chart.js'), 'utf8'), context);
	const chart = context.CineTraktSeasonChart;
	chart.createButton('tt0460681', id => opened.push(id));
	const data = [{ season: 1, percent: 80 }, { season: 2, percent: 86 }, { season: 3, percent: 74 }];
	chart.updateButton(button, data);
	const writes = markupWrites;
	chart.updateButton(button, data);
	assert.equal(markupWrites, writes, 'unchanged data must not reset hover state or rebuild the SVG');
	assert.doesNotMatch(button.markup, /Quality Over Time/);
	listeners.pointermove({ clientX: 196 });
	assert.equal(button.querySelector('.cinetrakt-season-tooltip').textContent, 'S2 · 86%');
	assert.equal(button.querySelector('.cinetrakt-season-active').attributes.cx, 110);
	listeners.pointerleave();
	assert.equal(button.querySelector('.cinetrakt-season-tooltip').hidden, true);
	const key = value => listeners.keydown({ key: value, preventDefault() {}, stopPropagation() {} });
	key('End'); assert.equal(button.querySelector('.cinetrakt-season-tooltip').textContent, 'S3 · 74%');
	key('Home'); assert.equal(button.querySelector('.cinetrakt-season-tooltip').textContent, 'S1 · 80%');
	key('ArrowRight'); assert.equal(button.querySelector('.cinetrakt-season-tooltip').textContent, 'S2 · 86%');
	button.dataset.imdbId = 'tt10986410';
	listeners.click({ preventDefault() {}, stopPropagation() {} });
	assert.deepEqual(opened, ['tt10986410']);
	assert.equal(listeners.contextmenu, undefined, 'right click is left to the browser and never opens another ratings view');
	chart.updateButton(button, []);
	assert.match(button.markup, /Épisodes IMDb/);
	assert.doesNotMatch(button.markup, /<svg/);
});
