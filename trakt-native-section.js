(() => {
	'use strict';

	// Keep the native app and its event handlers alive in a same-origin document.
	// Cloning a Svelte card would lose its menus and reactive user indicators.
	const FRAME_STYLE_ID = 'cinetrakt-native-section-style';
	const FRAME_STYLE = `
		html, body { background: transparent !important; min-height: 0 !important; height: auto !important; overflow: hidden !important; }
		html::before, html::after { content: none !important; }
		body { margin: 0 !important; padding: 0 !important; }
		.cinetrakt-native-section-hidden.cinetrakt-native-section-hidden { display: none !important; }
		.cinetrakt-native-section-path {
			margin: 0 !important; padding: 0 !important; min-height: 0 !important;
			width: 100% !important; max-width: none !important; background: transparent !important;
		}
		main.cinetrakt-native-section-path { display: block !important; }
		.cinetrakt-native-section-warmup { position: fixed !important; top: 0 !important; left: 0 !important; width: 100% !important; }
		.cinetrakt-native-section-warmup-path { content-visibility: visible !important; }
		.cinetrakt-native-collection-grid,
		.cinetrakt-native-collection-grid .section-list,
		.cinetrakt-native-collection-grid .trakt-crossfade,
		.cinetrakt-native-collection-grid .crossfade-content {
			height: auto !important; min-height: 0 !important; max-height: none !important;
			overflow: visible !important; contain: none !important;
		}
		.cinetrakt-native-collection-grid .crossfade-content { position: relative !important; inset: auto !important; }
		.cinetrakt-native-collection-grid .crossfade-content {
			opacity: 1 !important; animation: none !important; transition: none !important;
		}
		.cinetrakt-native-collection-grid .cinetrakt-native-section-has-data > .crossfade-content:not(.cinetrakt-native-section-active-content) { display: none !important; }
		.cinetrakt-native-collection-grid .trakt-list-inset-title { margin-inline: var(--ni-4, 4px) !important; }
		.cinetrakt-native-collection-grid .section-list-horizontal-scroll {
			display: flex !important; flex-wrap: wrap !important; align-items: flex-start !important;
			column-gap: var(--list-gap) !important; row-gap: var(--gap-l, 24px) !important;
			box-sizing: border-box !important; width: 100% !important; height: auto !important; min-height: 0 !important;
			margin: 0 !important; padding: var(--ni-4, 4px) !important; overflow: visible !important;
			mask-image: none !important; animation: none !important; scroll-snap-type: none !important;
		}
		.cinetrakt-native-seasons-grid .section-list-horizontal-scroll {
			overflow-x: auto !important;
			padding: 4px !important; margin: 0 !important; box-sizing: border-box !important;
		}

	`;

	function seasonNavigation(href, event, route) {
		if (!href || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return '';
		try {
			const url = new URL(href, 'https://app.trakt.tv');
			return url.origin === 'https://app.trakt.tv' && url.pathname === route
				? url.pathname + url.search + url.hash : '';
		} catch { return ''; }
	}

	function injectStyles() {
		if (document.getElementById('cinetrakt-native-section-host-style')) return;
		const style = document.createElement('style'); style.id = 'cinetrakt-native-section-host-style';
		style.textContent = `
			.cinetrakt-native-section-body { position: relative; min-height: 260px; }
			.cinetrakt-native-section-frame {
				display: block; position: absolute; top: 0; left: 0; z-index: 2;
				width: 100%; height: 260px; border: 0; background: transparent; color-scheme: dark; visibility: hidden;
			}
			.cinetrakt-native-section-ready { visibility: visible; }
			.cinetrakt-native-section-modal {
				position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 10000 !important;
			}
			.cinetrakt-native-section-fallback { color: var(--color-text-secondary); }
		`;
		document.head.appendChild(style);
	}

	function mount({ host, href, title, route, countNode, itemCount = 0, onCount, onReady, onUnavailable, portal = false, kind = 'collection', season = null }) {
		const isCollection = kind === 'collection';
		const path = isCollection ? globalThis.CineTraktCollectionUtils.collectionPath(href) : `${route}?view=seasons`;
		if (!path || !(isCollection ? /^\/movies\/[a-z0-9][a-z0-9-]*\/?$/i : /^\/shows\/[a-z0-9][a-z0-9-]*\/?$/i).test(route || '')) return () => {};
		injectStyles();
		const frame = document.createElement('iframe');
		frame.className = 'cinetrakt-native-section-frame';
		frame.title = title;
		frame.setAttribute('aria-label', title);
		const cacheName = isCollection ? `cinetrakt-collection-view-${crypto.randomUUID()}` : null;
		if (isCollection) {
			frame.dataset.cinetraktNativeCollection = path;
			frame.dataset.cinetraktCollectionMovie = route;
			frame.dataset.cinetraktCollectionCache = cacheName;
			frame.dataset.cinetraktCollectionApiKey = globalThis.CineTraktTraktImdbResolver.TRAKT_API_CLIENT_ID;
		} else frame.dataset.cinetraktNativeSeasons = route;
		frame.dataset.cinetraktSectionKind = kind;
		frame.dataset.cinetraktSectionRenderer = 'stable-collection-3';
		const src = new URL(route, window.location.origin);
		let desiredSeason = /^\d{1,3}$/.test(String(season)) ? String(season) : null;
		if (!isCollection && desiredSeason !== null) src.searchParams.set('season', desiredSeason);
		frame.src = src.href;
		frame.setAttribute('loading', 'eager');
		const fallback = document.createElement('a');
		fallback.className = 'cinetrakt-native-section-fallback';
		fallback.href = path;
		fallback.textContent = '';
		fallback.hidden = true;
		const framePortal = portal ? document.createElement('div') : null;
		if (framePortal) {
			framePortal.className = 'cinetrakt-native-section-portal';
			Object.assign(framePortal.style, { position: 'fixed', left: '0', top: '0', width: `${window.innerWidth}px`, height: '260px', opacity: '0', pointerEvents: 'none', zIndex: '2' });
			// Keep native animation/lazy-mount callbacks running during preload.
			// The portal's opacity, not iframe visibility, conceals its contents.
			frame.style.visibility = 'visible'; frame.style.pointerEvents = 'none'; framePortal.setAttribute('aria-hidden', 'true');
			framePortal.appendChild(frame); document.body.appendChild(framePortal); host.appendChild(fallback);
		} else host.append(frame, fallback);
		const sizingProbe = document.createElement('div');
		sizingProbe.className = 'cinetrakt-native-section-sizing-probe';
		Object.assign(sizingProbe.style, { position: 'absolute', visibility: 'hidden', height: 'var(--height-portrait-card-sm, 226px)', width: 'var(--width-portrait-card, 132px)', pointerEvents: 'none' });
		host.appendChild(sizingProbe);
		const gapProbe = isCollection ? document.createElement('div') : null;
		const headerProbe = isCollection ? document.createElement('div') : null;
		if (gapProbe && headerProbe) {
			gapProbe.className = 'cinetrakt-native-section-gap-probe';
			headerProbe.className = 'cinetrakt-native-section-header-probe';
			Object.assign(gapProbe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: 'var(--list-gap, 12px)', height: 'var(--gap-l, 24px)' });
			Object.assign(headerProbe.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: 'calc(var(--ni-4, 4px) * 2)', height: 'calc(var(--ni-40, 40px) + var(--list-header-gap, 6px) + var(--ni-4, 4px) * 2 + 8px)' });
			host.append(gapProbe, headerProbe);
		}
		let disposed = false, doc = null, observer = null, resizeObserver = null, parentObserver = null, timer = null, scheduled = false;
		let grid = null, count = 0, cardHeight = 260;
		const hiddenNodes = new Map(), pathNodes = new Set(), warmupNodes = new Set();
		function clearWarmup() {
			for (const node of warmupNodes) { node.classList.remove('cinetrakt-native-section-warmup'); node.classList.remove('cinetrakt-native-section-warmup-path'); }
			warmupNodes.clear();
		}
		function resetIsolation() {
			clearWarmup();
			for (const [node, previous] of hiddenNodes) {
				node.classList.remove('cinetrakt-native-section-hidden');
				if (previous.value) node.style.setProperty('display', previous.value, previous.priority);
				else node.style.removeProperty('display');
			}
			for (const node of pathNodes) node.classList.remove('cinetrakt-native-section-path');
			hiddenNodes.clear(); pathNodes.clear();
		}
		let syncingSelection = false, ready = false, pendingSeason = null;
		let observedSummary = null;
		function observeSummary() {
			const summary = host.closest?.('main')?.querySelector('.trakt-summary-container') || null;
			if (summary === observedSummary) return;
			if (observedSummary) parentObserver?.unobserve(observedSummary);
			observedSummary = summary;
			if (summary) parentObserver?.observe(summary);
		}
		const isCurrent = () => !disposed && host.isConnected;

		function collectionMetrics() {
			if (!gapProbe || !headerProbe) return null;
			const card = sizingProbe.getBoundingClientRect(), gap = gapProbe.getBoundingClientRect(), header = headerProbe.getBoundingClientRect();
			return { width: host.getBoundingClientRect().width, cardWidth: card.width, cardHeight: card.height,
				columnGap: gap.width, rowGap: gap.height, headerHeight: header.height, padding: header.width / 2 };
		}

		function reserveCollection() {
			if (!isCollection || ready || !isCurrent()) return;
			const count = (frame.dataset.cinetraktCollectionIds || '').split(',').filter(Boolean).length || itemCount;
			const layout = globalThis.CineTraktCollectionUtils.collectionLayout({ count, ...collectionMetrics() });
			if (!layout) return;
			cardHeight = layout.height; host.style.height = `${cardHeight}px`; host.style.minHeight = '0';
			frame.style.height = `${Math.max(cardHeight, Math.min(window.innerHeight, 800))}px`;
		}

		function positionPortal() {
			if (!framePortal || !isCurrent()) return;
			const bounds = host.getBoundingClientRect();
			const placed = !host.hidden && bounds.width > 0;
			const prepared = frame.classList.contains('cinetrakt-native-section-ready');
			const visible = placed && prepared;
			// A restored page scroll can put a document-positioned preload far
			// outside the viewport, suspending the native app's animation frames.
			// Keep startup in the viewport; only the ready row joins page scrolling.
			Object.assign(framePortal.style, { position: visible ? 'absolute' : 'fixed',
				left: `${visible ? bounds.left + (window.scrollX || 0) : 0}px`, top: `${visible ? bounds.top + (window.scrollY || 0) : 0}px`,
				width: `${placed ? bounds.width : window.innerWidth}px`, height: `${cardHeight}px`, opacity: visible ? '1' : '0' });
			frame.style.pointerEvents = visible ? 'auto' : 'none';
			framePortal.setAttribute('aria-hidden', String(!visible));
		}

		function syncDrawerViewport() {
			if (!isCurrent() || !doc) return false;
			const drawers = [...doc.querySelectorAll('.trakt-drawer, dialog[open], [role="dialog"][aria-modal="true"]')];
			const open = drawers.length > 0;
			if (framePortal) framePortal.style.zIndex = open ? '10000' : '2';
			frame.classList.toggle('cinetrakt-native-section-modal', open);
			frame.dataset.cinetraktSectionViewport = open ? 'page' : 'collection';
			if (open && grid) {
				// Keep the live cards at their original position while the native
				// drawer uses the full viewport. Only those two areas belong to the
				// frame: the rest of the main page stays visible and hit-testable.
				const bounds = host.getBoundingClientRect();
				for (const [name, value] of Object.entries({ position: 'fixed', left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px` })) {
					grid.style.setProperty(name, value, 'important');
				}
				const rectangle = (left, top, width, height) => {
					const [x, y, right, bottom] = [left, top, left + width, top + height].map(value => Math.round(value * 100) / 100);
					return `M${x} ${y}H${right}V${bottom}H${x}Z`;
				};
				const areas = [rectangle(bounds.left, bounds.top, bounds.width, cardHeight)];
				for (const drawer of drawers) {
					const { width, height } = drawer.getBoundingClientRect();
					// Ignore the slide-in translation: reserve the drawer's final area
					// throughout its native opening/closing animation.
					areas.push(rectangle(window.innerWidth - width, window.innerHeight - height, width, height));
				}
				frame.style.clipPath = `path("${areas.join(' ')}")`;
				return true;
			}
			if (grid) for (const name of ['position', 'left', 'top', 'width']) grid.style.removeProperty(name);
			const height = Math.max(cardHeight, Math.min(window.innerHeight, 800));
			const menuOpen = Boolean(doc.querySelector('.trakt-popup-menu-container, .trakt-popup-menu-button[aria-expanded="true"]'));
			// The lazy native list must retain its initial intersection area until
			// measure() has reserved the taller frame. Clipping that 260px frame
			// against the future 800px height would prevent its cards from mounting.
			frame.style.clipPath = open || menuOpen || !frame.classList.contains('cinetrakt-native-section-ready')
				? 'none' : `inset(0 0 ${Math.max(0, height - cardHeight)}px 0)`;
			return open;
		}

		function followDrawerViewport() {
			// Ordinary scrolling is handled by the browser compositor. Only an
			// open viewport drawer needs coordinates updated during scrolling.
			if (frame.classList.contains('cinetrakt-native-section-modal')) syncDrawerViewport();
		}

		function measure() {
			if (!isCurrent() || !grid?.isConnected) return;
			if (syncDrawerViewport()) return;
			const expected = (frame.dataset.cinetraktCollectionIds || '').split(',').filter(Boolean);
			// During Trakt's crossfade, the outgoing skeleton can precede the real
			// data in the DOM. Measure only the populated layer, never both layers.
			const list = isCollection ? [...grid.querySelectorAll('.trakt-list-item-container')].find(candidate => {
				return candidate.querySelectorAll('trakt-default-media-item').length === expected.length && expected.length > 0 && !candidate.querySelector('.trakt-summary-card');
			}) : grid.querySelector('.trakt-list-item-container');
			if (!list) return;
			const items = list.querySelectorAll(isCollection ? 'trakt-default-media-item' : '.trakt-season-item');
			if (items.length !== count) { count = items.length; onCount?.(count); }
			if (!count || (isCollection && (count !== expected.length || list.querySelector('.trakt-summary-card')))) return;
			if (isCollection) {
				const active = list.closest?.('.crossfade-content');
				active?.classList.add('cinetrakt-native-section-active-content');
				active?.parentElement?.classList.add('cinetrakt-native-section-has-data');
			}
			cardHeight = Math.ceil(list.getBoundingClientRect().bottom + 8);
			const menuOpen = Boolean(doc.querySelector('.trakt-popup-menu-container, .trakt-popup-menu-button[aria-expanded="true"]'));
			// Resizing the frame when a menu opens immediately closes Trakt's menu
			// (its native clickOutside also listens to resize). Reserve the space once
			// and clip the unused area until an interactive portal needs it.
			const height = Math.max(cardHeight, Math.min(window.innerHeight, 800));
			const nextHeight = `${height}px`;
			if (frame.style.height !== nextHeight) frame.style.height = nextHeight;
			frame.style.clipPath = menuOpen ? 'none' : `inset(0 0 ${Math.max(0, height - cardHeight)}px 0)`;
			host.style.height = `${cardHeight}px`;
			host.style.minHeight = '0';
			frame.classList.add('cinetrakt-native-section-ready');
			positionPortal();
			fallback.hidden = true;
			window.clearTimeout(timer);
			if (!ready) { ready = true; onReady?.(); }
		}

		function schedule() {
			if (scheduled || !isCurrent()) return;
			scheduled = true;
			window.requestAnimationFrame(() => { scheduled = false; prepare(); });
		}

		function prepare() {
			if (!isCurrent() || !doc) return;
			observeSummary();
			// Trakt may replace its lazy placeholder while the query resolves.
			// Do not keep an isolated path to a detached section: its replacement
			// would remain hidden and never mount the native season cards.
			if (grid && !grid.isConnected) { resetIsolation(); grid = null; resizeObserver?.disconnect(); }
			reserveCollection();
			positionPortal();
			const { width, height } = sizingProbe.getBoundingClientRect();
			if (width > 0) doc.documentElement.style.setProperty('--width-portrait-card', `${width}px`);
			if (height > 0) doc.documentElement.style.setProperty('--height-portrait-card-sm', `${height}px`);
			const nextGrid = (isCollection
				? doc.querySelector(`a[href="${route}/related"]`)?.closest('section.section-list-container')
				: doc.querySelector('.trakt-season-item')?.closest('section.section-list-container'))
				|| grid
				// The native section exists before its lazy title and cards. Move its
				// layout into view so Trakt itself can mount it without a page scroll.
				|| doc.querySelector(isCollection
					? 'svelte-css-wrapper[style*="--height-override-list"][style*="--height-poster-list-sm"] section.section-list-container'
					: 'svelte-css-wrapper[style*="--height-list: var(--height-poster-list"] section.section-list-container');
			if (!nextGrid?.isConnected) return;
			if (grid && grid !== nextGrid) resetIsolation();
			if (!isCollection && !nextGrid.querySelectorAll('.trakt-season-item').length) {
				// Make the lazy season slot intersect the viewport, without hiding
				// other app branches before Trakt has mounted the actual cards.
				grid = nextGrid; nextGrid.classList.add('cinetrakt-native-section-warmup');
				for (let node = nextGrid; node && node !== doc.body; node = node.parentElement) {
					node.classList.add('cinetrakt-native-section-warmup-path'); warmupNodes.add(node);
				}
				return;
			}
			clearWarmup();
			if (isCollection) {
				const metrics = collectionMetrics();
				for (const list of nextGrid.querySelectorAll('.trakt-list-item-container')) {
					list.style.setProperty('column-gap', `${metrics.columnGap}px`, 'important');
					list.style.setProperty('row-gap', `${metrics.rowGap}px`, 'important');
				}
			}
			// Hide only siblings on the route to the list, not body-level menu portals.
			for (let node = nextGrid; node && node !== doc.body; node = node.parentElement) {
				pathNodes.add(node);
				node.classList.add('cinetrakt-native-section-path');
				if (node.parentElement && node.parentElement !== doc.body) {
					for (const sibling of node.parentElement.children) {
						if (sibling !== node && !['SCRIPT', 'STYLE', 'LINK', 'DIALOG'].includes(sibling.tagName)
							&& !sibling.matches('[role="dialog"], .trakt-drawer, .trakt-popup-menu-container')
							&& !sibling.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
							sibling.classList.add('cinetrakt-native-section-hidden');
							if (!hiddenNodes.has(sibling)) hiddenNodes.set(sibling, {
								value: sibling.style.getPropertyValue?.('display') || '', priority: sibling.style.getPropertyPriority?.('display') || '',
							});
							// Trakt's important rules live in cascade layers; an inline
							// important declaration also hides its display:contents guards.
							sibling.style.setProperty('display', 'none', 'important');
						}
					}
				}
			}
			nextGrid.classList.add(isCollection ? 'cinetrakt-native-collection-grid' : 'cinetrakt-native-seasons-grid');
			const titleLink = nextGrid.querySelector('.trakt-list-title[data-drilldown] > a');
			if (isCollection && titleLink) {
				const label = titleLink.querySelector('.title');
				if (label && label.textContent !== title) label.textContent = title;
				if (titleLink.getAttribute('href') !== path) titleLink.setAttribute('href', path);
				if (countNode && !titleLink.parentElement.querySelector('.count-item')) titleLink.parentElement.appendChild(doc.importNode(countNode, true));
			}
			if (grid !== nextGrid || !resizeObserver) {
				resizeObserver?.disconnect(); grid = nextGrid;
				resizeObserver = new ResizeObserver(schedule); resizeObserver.observe(grid);
			}
			if (!isCollection) {
				// Only the parent route should add an entry to browser history.
				// Otherwise Back first undoes the iframe's season navigation and
				// the parent's current season immediately selects it again.
				for (const link of nextGrid.querySelectorAll('.trakt-season-item a[href]')) link.setAttribute('data-sveltekit-replacestate', '');
			}
			measure();
			if (!isCollection && desiredSeason !== null) {
				if (new URL(doc.URL).searchParams.get('season') === desiredSeason) pendingSeason = null;
				else if (pendingSeason !== desiredSeason) {
					// A season outside the visible carousel may not have a mounted
					// anchor yet. Route through the native app without reloading it.
					pendingSeason = desiredSeason;
					const link = doc.createElement('a'); link.href = `${route}?season=${desiredSeason}`; link.hidden = true;
					link.setAttribute('data-sveltekit-replacestate', ''); link.setAttribute('data-sveltekit-noscroll', '');
					(nextGrid.closest?.('main') || doc.body).appendChild(link);
					syncingSelection = true;
					try { link.click(); } finally { syncingSelection = false; link.remove(); }
				}
			}
		}

		function navigate(event) {
			const link = event.target?.closest?.('a[href]');
			if (!isCollection && link) link.setAttribute('data-sveltekit-replacestate', '');
			if (syncingSelection) return;
			const target = isCollection ? globalThis.CineTraktCollectionUtils.collectionNavigation(link?.getAttribute('href'), event)
				: seasonNavigation(link?.getAttribute('href'), event, route);
			if (!target || event.defaultPrevented) return;
			// Plain season picks update both native routers, keeping the live row
			// and its selection instead of reloading a second page on every click.
			if (isCollection || new URL(target, window.location.origin).searchParams.has('view')) {
				event.preventDefault(); event.stopPropagation();
			}
			// Let the main Trakt router handle the normal click and retain SPA state.
			const proxy = document.createElement('a'); proxy.href = target;
			if (!isCollection) proxy.setAttribute('data-sveltekit-noscroll', '');
			proxy.hidden = true; (host.closest?.('main') || document.body).appendChild(proxy); proxy.click(); proxy.remove();
		}

		function closeOutsideMenu(event) {
			if (event.target === frame) return;
			if (!isCurrent() || !doc) return;
			// Outside clicks reach the main document through the clipped frame.
			// Use Trakt's own dismissal action without intercepting that click.
			if (frame.classList.contains('cinetrakt-native-section-modal')) {
				[...doc.querySelectorAll('#trakt-portal-underlay')].at(-1)?.click();
			}
			if (!doc.querySelector('.trakt-popup-menu-container')) return;
			doc.querySelector('.trakt-popup-menu-button[aria-expanded="true"], .trakt-popup-menu-button[data-popup-state="opened"]')?.click();
		}

		function loaded() {
			if (!isCurrent()) return;
			try {
				const nextDoc = frame.contentDocument;
				if (!nextDoc || new URL(nextDoc.URL).pathname.replace(/\/$/, '') !== route) return;
				if (nextDoc === doc || !nextDoc.head) return;
				observer?.disconnect(); doc?.removeEventListener('click', navigate, true);
				doc = nextDoc;
				doc.documentElement.style.setProperty('--layout-distance-side', '0px');
				if (!doc.getElementById(FRAME_STYLE_ID)) {
					const style = doc.createElement('style'); style.id = FRAME_STYLE_ID;
					// Important declarations in the first layer override native important
					// rules too (notably the fixed canvas painted by html::before).
					style.textContent = `@layer cinetraktNativeSection { ${FRAME_STYLE} }`;
					doc.head.prepend(style);
				}
				doc.addEventListener('click', navigate, true);
				observer = new MutationObserver(() => {
					// Opening a drawer must not wait for an animation frame: native
					// overlays can mount while the parent renderer is throttled.
					syncDrawerViewport();
					schedule();
				});
				observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded', 'href', 'open'] });
				prepare();
			} catch { unavailable(); }
		}

		function unavailable() {
			if (!isCurrent()) return;
			window.clearInterval?.(earlyLoad);
			if (isCollection) { fallback.textContent = 'Afficher les films de la collection'; fallback.hidden = false; }
			else onUnavailable?.();
		}
		frame.addEventListener('load', loaded);
		// Do not wait for every image/video/widget in the embedded page to
		// finish loading before preparing the already available native row.
		const earlyLoad = typeof window.setInterval === 'function' ? window.setInterval(() => {
			const candidate = frame.contentDocument;
			// Wait for the detail component, but not its lazy season cards: those
			// need prepare() to bring their placeholder into the visible viewport.
			if ((candidate?.readyState === 'interactive' || candidate?.readyState === 'complete')
				&& candidate.querySelector('.trakt-summary-container')) loaded();
			if (doc || disposed) window.clearInterval(earlyLoad);
		}, 100) : null;
		document.addEventListener('pointerdown', closeOutsideMenu, true);
		window.addEventListener('scroll', followDrawerViewport, { passive: true });
		window.addEventListener('resize', schedule, { passive: true });
		parentObserver = new ResizeObserver(schedule); parentObserver.observe(sizingProbe);
		parentObserver.observe(document.body);
		if (gapProbe) parentObserver.observe(gapProbe);
		reserveCollection(); positionPortal();
		timer = window.setTimeout(unavailable, 15000);
		const dispose = () => {
			disposed = true; window.clearTimeout(timer); window.clearInterval?.(earlyLoad); observer?.disconnect(); resizeObserver?.disconnect(); parentObserver?.disconnect();
			resetIsolation();
			doc?.removeEventListener('click', navigate, true); frame.removeEventListener('load', loaded);
			document.removeEventListener('pointerdown', closeOutsideMenu, true);
			window.removeEventListener('scroll', followDrawerViewport);
			window.removeEventListener('resize', schedule);
			frame.remove(); framePortal?.remove(); fallback.remove(); sizingProbe.remove(); gapProbe?.remove(); headerProbe?.remove();
			// This database belongs only to the removed embedded view, never Trakt's cache.
			try { if (cacheName) indexedDB.deleteDatabase(cacheName); } catch { /* Storage can be disabled. */ }
		};
		dispose.setSeason = value => {
			const next = /^\d{1,3}$/.test(String(value)) ? String(value) : null;
			if (next === desiredSeason) return;
			desiredSeason = next;
			if (doc) schedule();
		};
		dispose.refresh = () => { observeSummary(); positionPortal(); schedule(); };
		return dispose;
	}

	const api = Object.freeze({ mount, seasonNavigation });
	globalThis.CineTraktNativeSection = api;
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
