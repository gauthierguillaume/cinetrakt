(() => {
	'use strict';

	// Keep the native app and its event handlers alive in a same-origin document.
	// Cloning a Svelte card would lose its menus and reactive user indicators.
	const FRAME_STYLE_ID = 'cinetrakt-native-collection-style';
	const FRAME_STYLE = `
		html, body { background: transparent !important; min-height: 0 !important; height: auto !important; overflow: hidden !important; }
		html::before, html::after { content: none !important; }
		body { margin: 0 !important; padding: 0 !important; }
		.cinetrakt-collection-frame-hidden.cinetrakt-collection-frame-hidden { display: none !important; }
		.cinetrakt-collection-frame-path {
			margin: 0 !important; padding: 0 !important; min-height: 0 !important;
			width: 100% !important; max-width: none !important; background: transparent !important;
		}
		main.cinetrakt-collection-frame-path { display: block !important; }
		.cinetrakt-native-collection-grid,
		.cinetrakt-native-collection-grid .section-list,
		.cinetrakt-native-collection-grid .trakt-crossfade,
		.cinetrakt-native-collection-grid .crossfade-content {
			height: auto !important; min-height: 0 !important; max-height: none !important;
			overflow: visible !important; contain: none !important;
		}
		.cinetrakt-native-collection-grid .crossfade-content { position: relative !important; inset: auto !important; }
		.cinetrakt-native-collection-grid .trakt-list-inset-title { margin-inline: var(--ni-4, 4px) !important; }
		.cinetrakt-native-collection-grid .section-list-horizontal-scroll {
			display: flex !important; flex-wrap: wrap !important; align-items: flex-start !important;
			column-gap: var(--list-gap) !important; row-gap: var(--gap-l, 24px) !important;
			box-sizing: border-box !important; width: 100% !important; height: auto !important; min-height: 0 !important;
			margin: 0 !important; padding: var(--ni-4, 4px) !important; overflow: visible !important;
			mask-image: none !important; animation: none !important; scroll-snap-type: none !important;
		}

	`;

	function mount({ host, href, title, moviePath, countNode, onCount }) {
		const path = globalThis.CineTraktCollectionUtils.collectionPath(href);
		if (!path || !/^\/movies\/[a-z0-9][a-z0-9-]*\/?$/i.test(moviePath || '')) return () => {};
		const frame = document.createElement('iframe');
		frame.className = 'cinetrakt-native-collection-frame';
		frame.title = title;
		frame.setAttribute('aria-label', `Films : ${title}`);
		const cacheName = `cinetrakt-collection-view-${crypto.randomUUID()}`;
		frame.dataset.cinetraktNativeCollection = path;
		frame.dataset.cinetraktCollectionMovie = moviePath;
		frame.dataset.cinetraktCollectionCache = cacheName;
		frame.dataset.cinetraktCollectionRenderer = 'related-wrap-viewport-4';
		frame.dataset.cinetraktCollectionApiKey = globalThis.CineTraktTraktImdbResolver.TRAKT_API_CLIENT_ID;
		frame.src = new URL(moviePath, window.location.origin).href;
		frame.setAttribute('loading', 'eager');
		const fallback = document.createElement('a');
		fallback.className = 'cinetrakt-collection-fallback';
		fallback.href = path;
		fallback.textContent = 'Chargement des films…';
		host.append(frame, fallback);
		const sizingProbe = document.createElement('div');
		sizingProbe.className = 'cinetrakt-collection-sizing-probe';
		Object.assign(sizingProbe.style, { position: 'absolute', visibility: 'hidden', height: 'var(--height-portrait-card-sm, 226px)', width: 'var(--width-portrait-card, 132px)', pointerEvents: 'none' });
		host.appendChild(sizingProbe);
		let disposed = false, doc = null, observer = null, resizeObserver = null, parentObserver = null, timer = null, scheduled = false;
		let grid = null, count = 0, cardHeight = 260;
		const isCurrent = () => !disposed && host.isConnected;

		function syncDrawerViewport() {
			if (!isCurrent() || !doc) return false;
			const drawers = [...doc.querySelectorAll('.trakt-drawer, dialog[open], [role="dialog"][aria-modal="true"]')];
			const open = drawers.length > 0;
			frame.classList.toggle('cinetrakt-collection-modal', open);
			frame.dataset.cinetraktCollectionViewport = open ? 'page' : 'collection';
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
			frame.style.clipPath = open || menuOpen || !frame.classList.contains('cinetrakt-collection-frame-ready')
				? 'none' : `inset(0 0 ${Math.max(0, height - cardHeight)}px 0)`;
			return open;
		}

		function followDrawerViewport() {
			if (frame.classList.contains('cinetrakt-collection-modal')) syncDrawerViewport();
		}

		function measure() {
			if (!isCurrent() || !grid?.isConnected) return;
			if (syncDrawerViewport()) return;
			const list = grid.querySelector('.trakt-list-item-container');
			if (!list) return;
			const items = list.querySelectorAll('trakt-default-media-item');
			if (items.length !== count) { count = items.length; onCount?.(count); }
			const expected = (frame.dataset.cinetraktCollectionIds || '').split(',').filter(Boolean);
			if (!count || count !== expected.length || list.querySelector('.trakt-summary-card')) return;
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
			frame.classList.add('cinetrakt-collection-frame-ready');
			fallback.hidden = true;
			window.clearTimeout(timer);
		}

		function schedule() {
			if (scheduled || !isCurrent()) return;
			scheduled = true;
			window.requestAnimationFrame(() => { scheduled = false; prepare(); });
		}

		function prepare() {
			if (!isCurrent() || !doc) return;
			const { width, height } = sizingProbe.getBoundingClientRect();
			if (width > 0) doc.documentElement.style.setProperty('--width-portrait-card', `${width}px`);
			if (height > 0) doc.documentElement.style.setProperty('--height-portrait-card-sm', `${height}px`);
			const nextGrid = doc.querySelector(`a[href="${moviePath}/related"]`)?.closest('section.section-list-container')
				|| grid
				// The native section exists before its lazy title and cards. Move its
				// layout into view so Trakt itself can mount it without a page scroll.
				|| doc.querySelector('svelte-css-wrapper[style*="--height-override-list"][style*="--height-poster-list-sm"] section.section-list-container');
			if (!nextGrid) return;
			// Hide only siblings on the route to the list, not body-level menu portals.
			for (let node = nextGrid; node && node !== doc.body; node = node.parentElement) {
				node.classList.add('cinetrakt-collection-frame-path');
				if (node.parentElement && node.parentElement !== doc.body) {
					for (const sibling of node.parentElement.children) {
						if (sibling !== node && !['SCRIPT', 'STYLE', 'LINK', 'DIALOG'].includes(sibling.tagName)
							&& !sibling.matches('[role="dialog"], .trakt-drawer, .trakt-popup-menu-container')
							&& !sibling.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
							sibling.classList.add('cinetrakt-collection-frame-hidden');
							// Trakt's important rules live in cascade layers; an inline
							// important declaration also hides its display:contents guards.
							sibling.style.setProperty('display', 'none', 'important');
						}
					}
				}
			}
			nextGrid.classList.add('cinetrakt-native-collection-grid');
			const titleLink = nextGrid.querySelector('.trakt-list-title[data-drilldown] > a');
			if (titleLink) {
				const label = titleLink.querySelector('.title');
				if (label && label.textContent !== title) label.textContent = title;
				if (titleLink.getAttribute('href') !== path) titleLink.setAttribute('href', path);
				if (countNode && !titleLink.parentElement.querySelector('.count-item')) titleLink.parentElement.appendChild(doc.importNode(countNode, true));
			}
			if (grid !== nextGrid) {
				resizeObserver?.disconnect(); grid = nextGrid;
				resizeObserver = new ResizeObserver(schedule); resizeObserver.observe(grid);
			}
			measure();
		}

		function navigate(event) {
			const link = event.target?.closest?.('a[href]');
			const target = globalThis.CineTraktCollectionUtils.collectionNavigation(link?.getAttribute('href'), event);
			if (!target || event.defaultPrevented) return;
			event.preventDefault(); event.stopPropagation();
			// Let the main Trakt router handle the normal click and retain SPA state.
			const proxy = document.createElement('a'); proxy.href = target;
			proxy.hidden = true; (host.closest?.('main') || document.body).appendChild(proxy); proxy.click(); proxy.remove();
		}

		function closeOutsideMenu(event) {
			if (event.target === frame) return;
			if (!isCurrent() || !doc) return;
			// Outside clicks reach the main document through the clipped frame.
			// Use Trakt's own dismissal action without intercepting that click.
			if (frame.classList.contains('cinetrakt-collection-modal')) {
				[...doc.querySelectorAll('#trakt-portal-underlay')].at(-1)?.click();
			}
			if (!doc.querySelector('.trakt-popup-menu-container')) return;
			doc.querySelector('.trakt-popup-menu-button[aria-expanded="true"], .trakt-popup-menu-button[data-popup-state="opened"]')?.click();
		}

		function loaded() {
			if (!isCurrent()) return;
			try {
				const nextDoc = frame.contentDocument;
				if (!nextDoc || new URL(nextDoc.URL).pathname.replace(/\/$/, '') !== moviePath) return;
				observer?.disconnect(); doc?.removeEventListener('click', navigate, true);
				doc = nextDoc;
				doc.documentElement.style.setProperty('--layout-distance-side', '0px');
				if (!doc.getElementById(FRAME_STYLE_ID)) {
					const style = doc.createElement('style'); style.id = FRAME_STYLE_ID;
					// Important declarations in the first layer override native important
					// rules too (notably the fixed canvas painted by html::before).
					style.textContent = `@layer cinetraktCollection { ${FRAME_STYLE} }`;
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
			fallback.textContent = 'Afficher les films de la collection'; fallback.hidden = false;
		}
		frame.addEventListener('load', loaded);
		document.addEventListener('pointerdown', closeOutsideMenu, true);
		window.addEventListener('scroll', followDrawerViewport, { passive: true });
		window.addEventListener('resize', followDrawerViewport, { passive: true });
		parentObserver = new ResizeObserver(schedule); parentObserver.observe(sizingProbe);
		timer = window.setTimeout(unavailable, 15000);
		return () => {
			disposed = true; window.clearTimeout(timer); observer?.disconnect(); resizeObserver?.disconnect(); parentObserver?.disconnect();
			doc?.removeEventListener('click', navigate, true); frame.removeEventListener('load', loaded);
			document.removeEventListener('pointerdown', closeOutsideMenu, true);
			window.removeEventListener('scroll', followDrawerViewport);
			window.removeEventListener('resize', followDrawerViewport);
			frame.remove(); fallback.remove(); sizingProbe.remove();
			// This database belongs only to the removed embedded view, never Trakt's cache.
			try { indexedDB.deleteDatabase(cacheName); } catch { /* Storage can be disabled. */ }
		};
	}

	globalThis.CineTraktCollectionSection = Object.freeze({ mount });
})();
