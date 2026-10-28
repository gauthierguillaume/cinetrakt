(() => {
	'use strict';
	const MAX_AGE = 12 * 60 * 60 * 1000;
	const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
	function createShuffleHistory(keys, random = Math.random) {
		const choices = [...new Set(keys)]; const allowed = new Set(choices);
		const history = []; const used = new Set(); let cursor = -1;
		function select(key) {
			if (!allowed.has(key)) return null;
			if (history[cursor] !== key) {
				history.splice(cursor + 1); history.push(key); cursor = history.length - 1; used.add(key);
			}
			return key;
		}
		return {
			select,
			get canPrevious() { return cursor > 0; },
			get canNext() { return cursor + 1 < history.length || choices.length > 1; },
			previous() { return cursor > 0 ? history[--cursor] : null; },
			next() {
				if (cursor + 1 < history.length) return history[++cursor];
				const current = history[cursor];
				let remaining = choices.filter(key => key !== current && !used.has(key));
				if (!remaining.length && choices.length > 1) {
					used.clear(); remaining = choices.filter(key => key !== current);
				}
				return remaining.length ? select(remaining[Math.floor(random() * remaining.length)]) : null;
			},
		};
	}
	function targetForRoute(route) {
		const match = /^\/(movies|shows)\/([^/?#]+)\/?$/.exec(route);
		return match ? { query: `query:${match[1] === 'movies' ? 'movie' : 'show'}Soundtrack`, dependency: `dependency:${match[2]}` } : null;
	}
	function catalogFromEntry(entry, route, now = Date.now()) {
		const target = targetForRoute(route);
		if (!target || !Array.isArray(entry?.queryKey) || !entry.queryKey.includes(target.query)
			|| !entry.queryKey.includes(target.dependency) || entry.state?.status !== 'success'
			|| !Number.isFinite(entry.state.dataUpdatedAt) || now - entry.state.dataUpdatedAt > MAX_AGE
			|| !Array.isArray(entry.state.data)) return [];
		const seen = new Set();
		return entry.state.data.flatMap((track, index) => {
			if (!SPOTIFY_ID.test(track?.spotifyId) || typeof track.title !== 'string' || !track.title.trim()
				|| seen.has(track.spotifyId)) return [];
			seen.add(track.spotifyId);
			return [{ key: `spotify:${track.spotifyId}`, spotifyId: track.spotifyId,
				title: track.title.trim().slice(0, 300), artist: typeof track.performer === 'string' ? track.performer.trim().slice(0, 300) : '',
				index: index + 1 }];
		});
	}
	// Read only the current film/show's already-authorized native soundtrack query.
	// No tokens, unrelated query values, cache writes, or extra API requests.
	function readCatalog(route, idb = globalThis.indexedDB) {
		const target = targetForRoute(route);
		if (!target || !idb) return Promise.resolve([]);
		return new Promise(resolve => {
			let db; let transaction; let finished = false;
			const finish = value => {
				if (finished) return;
				finished = true; clearTimeout(timeout); db?.close(); resolve(value);
			};
			const timeout = setTimeout(() => { try { transaction?.abort(); } catch {} finish([]); }, 1500);
			try {
				const opened = idb.open('trakt-query');
				opened.onupgradeneeded = () => { opened.transaction.abort(); finish([]); };
				opened.onerror = opened.onblocked = () => finish([]);
				opened.onsuccess = () => {
					db = opened.result;
					if (finished) { db.close(); return; }
					if (!db.objectStoreNames.contains('query-cache')) { finish([]); return; }
					transaction = db.transaction('query-cache', 'readonly');
					const store = transaction.objectStore('query-cache'); const candidates = [];
					const keys = store.getAllKeys();
					keys.onsuccess = () => {
						for (const key of keys.result.filter(key => typeof key === 'string'
							&& key.includes(JSON.stringify(target.query)) && key.includes(JSON.stringify(target.dependency))).slice(0, 16)) {
							const request = store.get(key);
							request.onsuccess = () => {
								const tracks = catalogFromEntry(request.result, route);
								if (tracks.length) candidates.push({ tracks, at: request.result.state.dataUpdatedAt });
							};
						}
					};
					transaction.oncomplete = () => finish(candidates.sort((a, b) => b.at - a.at)[0]?.tracks || []);
					transaction.onerror = transaction.onabort = () => finish([]);
				};
			} catch { finish([]); }
		});
	}
	function createPlayer(section, catalog, onSelect) {
		const doc = section.ownerDocument;
		const root = doc.createElement('div'); root.className = 'cinetrakt-soundtrack-player';
		const nativeStage = section.querySelector('.trakt-soundtrack-panel .panel-media');
		const nativeCaption = section.querySelector('.trakt-soundtrack-panel .panel-caption');
		const captionWasHidden = nativeCaption?.hidden;
		const caption = nativeCaption ? doc.createElement('p') : null;
		if (caption) {
			caption.className = 'cinetrakt-soundtrack-caption panel-caption tag secondary ellipsis';
			caption.style.cssText = 'margin:0;flex:none;'; caption.hidden = true;
			nativeCaption.parentElement.appendChild(caption);
		}
		// Keep the iframe in the summary, never in the drawer that Trakt destroys.
		root.style.cssText = nativeStage ? 'position:absolute;inset:0;z-index:1;border-radius:inherit;overflow:hidden;'
			: 'position:fixed;left:-10000px;top:0;width:320px;height:152px;pointer-events:none;';
		if (!nativeStage) root.setAttribute('aria-hidden', 'true');
		const rows = doc.createElement('div'); rows.setAttribute('aria-hidden', 'true');
		rows.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;pointer-events:none;'; root.appendChild(rows);
		let iframe = null; let selectedKey = ''; const nativeRows = new Map();
		const navigation = createShuffleHistory(catalog.map(track => track.key));
		const tracks = catalog.map(entry => {
			const row = doc.createElement('div'); row.className = 'trakt-soundtrack-row';
			row.dataset.cinetraktTrackKey = entry.key;
			for (const [className, text] of [['row-position', String(entry.index)], ['row-title', entry.title], ['row-performer', entry.artist]]) {
				const span = doc.createElement('span'); span.className = className; span.textContent = text; row.appendChild(span);
			}
			const control = doc.createElement('button'); control.type = 'button'; control.tabIndex = -1; control.className = 'row-action';
			control.setAttribute('aria-label', `Play ${entry.title}`); row.appendChild(control); rows.appendChild(row);
			const track = { ...entry, row, control };
			control.addEventListener('click', () => onSelect(track)); return track;
		});
		(nativeStage || section).appendChild(root);
		const attribute = (node, name, value) => {
			if (value === null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
			else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
		};
		function matchRow(row) {
			if (root.contains(row) || row.querySelector('.row-unmatched')) return null;
			const title = row.querySelector('.row-title')?.textContent?.trim();
			const artist = row.querySelector('.row-performer')?.textContent?.trim() || '';
			const matches = tracks.filter(track => track.title === title && track.artist === artist);
			if (matches.length === 1) return matches[0];
			const index = Number(row.querySelector('.row-position')?.textContent);
			return matches.find(track => track.index === index) || null;
		}
		function update(state, key = selectedKey) {
			selectedKey = key;
			const playing = state === 'playing' || state === 'buffering';
			const selectedTrack = tracks.find(track => track.key === selectedKey);
			if (caption && iframe && selectedTrack) {
				const text = [selectedTrack.title, selectedTrack.artist].filter(Boolean).join(' · ');
				if (caption.textContent !== text) caption.textContent = text;
				if (caption.hidden) caption.hidden = false;
				if (!nativeCaption.hidden) nativeCaption.hidden = true;
			}
			for (const track of tracks) {
				const selected = track.key === selectedKey;
				track.row.classList.toggle('is-playing', selected);
				attribute(track.control, 'aria-label', `${playing && selected ? 'Pause' : 'Play'} ${track.title}`);
			}
			for (const row of doc.querySelectorAll('.trakt-soundtrack-row')) {
				const track = matchRow(row); const button = row.querySelector('button.row-action');
				if (!track || !button) continue;
				if (!nativeRows.has(row)) nativeRows.set(row, { button, label: button.getAttribute('aria-label'), selected: row.classList.contains('is-playing') });
				const selected = track.key === selectedKey;
				row.classList.toggle('is-playing', selected);
				attribute(button, 'aria-label', `${selected && playing ? 'Pause' : 'Play'} ${track.title}`);
				attribute(button, 'data-cinetrakt-soundtrack-playing', selected && playing ? 'true' : null);
			}
			for (const [row] of nativeRows) if (!row.isConnected) nativeRows.delete(row);
		}
		return {
			tracks, root, get iframe() { return iframe; }, matchRow, update,
			get canPrevious() { return navigation.canPrevious; },
			get canNext() { return navigation.canNext; },
			previous() { const key = navigation.previous(); return tracks.find(track => track.key === key) || null; },
			next() { const key = navigation.next(); return tracks.find(track => track.key === key) || null; },
			select(track) {
				navigation.select(track.key);
				selectedKey = track.key;
				const src = `https://open.spotify.com/embed/track/${track.spotifyId}?utm_source=cinetrakt`;
				if (!iframe) {
					iframe = doc.createElement('iframe'); iframe.title = 'Spotify soundtrack'; iframe.tabIndex = nativeStage ? 0 : -1;
					iframe.width = '100%'; iframe.height = '100%'; iframe.loading = 'eager';
					iframe.style.cssText = 'display:block;width:100%;height:100%;border:0;border-radius:inherit;';
					iframe.setAttribute('allow', 'autoplay; encrypted-media');
					// Configure the destination before insertion, so the first live
					// document is the embed rather than an inherited about:blank.
					iframe.setAttribute('src', src); root.appendChild(iframe);
				}
				if (iframe.getAttribute('src') !== src) iframe.setAttribute('src', src);
			},
			cleanup() {
				for (const [row, saved] of nativeRows) {
					attribute(saved.button, 'aria-label', saved.label);
					attribute(saved.button, 'data-cinetrakt-soundtrack-playing', null);
					row.classList.toggle('is-playing', saved.selected);
				}
				if (caption) { caption.remove(); nativeCaption.hidden = captionWasHidden; }
				nativeRows.clear(); root.remove(); iframe = null;
			},
		};
	}
	const api = Object.freeze({ catalogFromEntry, readCatalog, createPlayer, createShuffleHistory });
	globalThis.CineTraktSoundtrackLibrary = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
