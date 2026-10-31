(() => {
	'use strict';
	const ROW = '.section-list-horizontal-scroll';
	let requested = false, enabled = false, gesture = null, blocked = null, resetTimer;
	const isDetailPage = () => /^\/(movies|shows)\/[^/]+\/?$/.test(window.location.pathname);
	// Measurements happen only on a user gesture, never while loading a fiche.
	function cards(row) {
		const result = [];
		function visit(node) {
			const rect = node.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) result.push(rect);
			else for (const child of node.children) visit(child);
		}
		for (const child of row.children) visit(child);
		return result;
	}
	function align(row) {
		const css = getComputedStyle(row), start = row.getBoundingClientRect().left + (parseFloat(css.paddingLeft) || 0);
		const max = row.scrollWidth - row.clientWidth;
		const stops = [0, max, ...cards(row).map(rect => row.scrollLeft + rect.left - start).filter(x => x >= 0 && x <= max + 1)];
		row.scrollLeft = stops.reduce((best, x) => Math.abs(x - row.scrollLeft) < Math.abs(best - row.scrollLeft) ? x : best, 0);
	}
	function finish() {
		if (!gesture) return;
		const { row, id, dragging } = gesture;
		gesture = null;
		if (dragging && enabled && !row.closest?.('.trakt-drawer, dialog, [role="dialog"]')) align(row);
		row.classList.remove('cinetrakt-row-dragging');
		if (row.hasPointerCapture?.(id)) row.releasePointerCapture(id);
		if (dragging) {
			blocked = row; clearTimeout(resetTimer);
			resetTimer = setTimeout(() => { blocked = null; }, 250);
		}
	}
	function down(e) {
		if (!enabled || !isDetailPage() || e.pointerType !== 'mouse' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
		const row = e.target.closest?.(ROW);
		if (!row || row.scrollWidth <= row.clientWidth + 1) return;
		const control = e.target.closest('button, input, select, textarea, [role="button"], [role="slider"], [contenteditable="true"]');
		if (control && !control.matches?.('.trakt-comment-preview')) return;
		if (e.clientY >= row.getBoundingClientRect().top + row.clientHeight) return;
		gesture = { row, id: e.pointerId, x: e.clientX, y: e.clientY, left: row.scrollLeft, dragging: false };
	}
	function move(e) {
		const g = gesture;
		if (!g || e.pointerId !== g.id) return;
		if (!(e.buttons & 1)) { finish(); return; }
		const dx = e.clientX - g.x, dy = e.clientY - g.y;
		if (!g.dragging) {
			if (Math.abs(dy) > 7 && Math.abs(dy) > Math.abs(dx)) { finish(); return; }
			if (Math.abs(dx) < 7) return;
			g.dragging = true; g.row.classList.add('cinetrakt-row-dragging'); g.row.setPointerCapture?.(g.id);
		}
		e.preventDefault(); g.row.scrollLeft = g.left - dx;
	}
	function click(e) {
		if (blocked && e.button === 0 && (e.target === blocked || blocked.contains(e.target))) {
			e.preventDefault(); e.stopImmediatePropagation(); blocked = null;
		}
	}
	function drag(e) { if (gesture) e.preventDefault(); }
	function update(values) {
		requested = values?.traktHorizontalScroll !== false;
		sync();
	}
	function sync() {
		enabled = requested && isDetailPage();
		document.documentElement.classList.toggle('cinetrakt-horizontal-scroll', enabled);
		if (!enabled) { finish(); clearTimeout(resetTimer); blocked = null; }
	}
	function cleanup() {
		finish(); clearTimeout(resetTimer); blocked = null;
		document.documentElement.classList.remove('cinetrakt-horizontal-scroll');
		for (const [name, fn] of events) document.removeEventListener(name, fn, true);
		window.removeEventListener('blur', finish); window.removeEventListener('popstate', sync);
		globalThis.navigation?.removeEventListener('currententrychange', sync); unsubscribe?.();
	}
	const events = [['pointerdown', down], ['pointermove', move], ['pointerup', finish], ['pointercancel', finish], ['click', click], ['dragstart', drag]];
	for (const [name, fn] of events) document.addEventListener(name, fn, { capture: true, passive: false });
	window.addEventListener('blur', finish);
	window.addEventListener('popstate', sync);
	globalThis.navigation?.addEventListener('currententrychange', sync);
	const unsubscribe = globalThis.CineTraktSettings?.onChange(update);
	globalThis.CineTraktSettings?.ready.then(update);
	window.addEventListener('pagehide', cleanup, { once: true });
	globalThis.CineTraktHorizontalScroll = Object.freeze({ sync });
})();
