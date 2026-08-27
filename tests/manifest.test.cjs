const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('Trakt integration uses only the current web app and official API origins', () => {
	assert.ok(manifest.host_permissions.includes('https://app.trakt.tv/*'));
	assert.ok(manifest.host_permissions.includes('https://api.trakt.tv/*'));
	assert.equal(manifest.host_permissions.includes('https://trakt.tv/*'), false);
});

function assertLocalFileExists(file) {
	assert.equal(fs.existsSync(path.join(root, file)), true, `${file} does not exist`);
}

test('every manifest script, stylesheet, worker, and icon exists', () => {
	assertLocalFileExists(manifest.background.service_worker);
	Object.values(manifest.icons).forEach(assertLocalFileExists);
	Object.values(manifest.action.default_icon).forEach(assertLocalFileExists);
	assertLocalFileExists(manifest.action.default_popup);

	manifest.content_scripts.forEach((entry) => {
		(entry.js || []).forEach(assertLocalFileExists);
		(entry.css || []).forEach(assertLocalFileExists);
		assert.equal(new Set(entry.js || []).size, (entry.js || []).length, 'duplicate content script');
	});
});

test('extension HTML pages only reference local files that exist', () => {
	for (const htmlFile of ['popup.html', 'newtab.html']) {
		const html = fs.readFileSync(path.join(root, htmlFile), 'utf8');
		const references = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g), (match) => match[1])
			.filter((reference) => !/^(?:https?:|#)/.test(reference));
		references.forEach(assertLocalFileExists);
	}
});
