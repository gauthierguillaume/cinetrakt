(() => {
	'use strict';

	function isOfficialMovieCollection({ href, title, variant, owner }) {
		if (variant !== 'official' || !/^@?Trakt$/i.test(String(owner || '').trim())) return false;
		let url;
		try { url = new URL(href, 'https://app.trakt.tv'); } catch { return false; }
		if (url.origin !== 'https://app.trakt.tv' && url.origin !== 'https://trakt.tv') return false;
		// Official editorial lists share the same card variant and owner. Require the
		// collection identity in both its canonical list path and its displayed title.
		// Trakt may append the numeric list ID to an otherwise identical collection slug.
		return /^\/lists\/official\/[a-z0-9]+(?:-[a-z0-9]+)*-collection(?:-\d+)?\/?$/i.test(url.pathname)
			&& /\bCollection\s*$/i.test(String(title || '').trim());
	}

	function findUniqueOfficialMovieCollection(candidates) {
		const matches = candidates.filter(isOfficialMovieCollection);
		const paths = new Set(matches.map((candidate) => new URL(candidate.href, 'https://app.trakt.tv').pathname.replace(/\/$/, '')));
		// Never substitute an editorial list or guess between different collections.
		return paths.size === 1 ? matches[0] : null;
	}

	globalThis.CineTraktCollectionUtils = Object.freeze({ isOfficialMovieCollection, findUniqueOfficialMovieCollection });
})();
