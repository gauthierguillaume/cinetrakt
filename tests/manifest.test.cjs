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

test('popup reserves a stable size before settings render instead of shrinking with its initial viewport', () => {
	const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
	for (const selector of ['html', 'body']) {
		const rule = css.match(new RegExp(`(?:^|\\n)${selector}\\s*\\{([^}]+)\\}`))?.[1] || '';
		assert.match(rule, /(?:^|[;\s])width:\s*800px\s*;/);
		assert.match(rule, /(?:^|[;\s])height:\s*600px\s*;/);
		assert.doesNotMatch(rule, /\b(?:vw|vh)\b|(?:min|max)-(?:width|height):/);
	}
});

test('popup keeps descriptions in bounded tooltips and allows access if content grows', () => {
	const css = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
	const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
	const script = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
	const descriptionRule = css.match(/\.feature-tooltip\s*\{([\s\S]*?)\}/)?.[1] || '';
	const mainRule = css.match(/main\s*\{([\s\S]*?)\}/)?.[1] || '';

	assert.match(descriptionRule, /white-space:\s*normal/);
	assert.match(descriptionRule, /position:\s*fixed/);
	assert.match(descriptionRule, /max-width:\s*min\(/);
	assert.doesNotMatch(descriptionRule, /text-overflow:\s*ellipsis/);
	assert.doesNotMatch(descriptionRule, /overflow:\s*hidden/);
	assert.match(mainRule, /overflow-y:\s*auto/);
	assert.match(script, /description\.hidden = true/);
	assert.match(script, /setAttribute\('aria-describedby', description\.id\)/);
	assert.match(script, /setAttribute\('role', 'tooltip'\)/);
	assert.doesNotMatch(script, /copy\.append\(title, description\)/);
	assert.match(css, /\.feature-subgroups\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
	assert.match(css, /\.feature-subgroup-column\s*\{[\s\S]*?flex-direction:\s*column/);
	assert.match(css, /\.feature-subgroup h3\s*\{/);
	assert.match(html, /<header class="app-header">[\s\S]*?<div class="app-brand">[\s\S]*?<div class="master-row">[\s\S]*?<div class="footer-actions">/);
	assert.doesNotMatch(html, /<main>\s*<div class="master-row">/);
	assert.doesNotMatch(html, /<footer>/);
});
