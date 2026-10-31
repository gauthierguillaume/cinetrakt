const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('loading and settings updates perform no card scans, layout reads or observer registration', () => {
	const f=fixture();
	assert.deepEqual(f.reads,{boxes:0,queries:0}); assert.equal(f.observers.length,0);
	f.changed({traktHorizontalScroll:false}); f.changed({traktHorizontalScroll:true});
	assert.deepEqual(f.reads,{boxes:0,queries:0}); assert.equal(f.observers.length,0);
});

test('fiche drawers allow dragging without applying the custom fiche alignment', () => {
	const f=fixture(); f.row.closest=()=>({});
	f.send('pointerdown'); f.send('pointermove',{clientX:20});
	assert.equal(f.row.scrollLeft,80); f.send('pointerup');
	assert.equal(f.row.scrollLeft,80, 'native drawer snapping decides its final position');
	assert.equal(f.send('click').prevented,true);
});
function fixture(pathname='/shows/test-show') {
	const listeners = new Map(), windowListeners = new Map(), navigationListeners = new Map(), rootClasses = new Set(), classes = new Set(), observers = []; let changed;
	const location = { pathname };
	const observerClass = kind => class {
		constructor(callback) { this.callback = callback; this.kind = kind; this.active = true; observers.push(this); }
		observe() { this.active = true; } unobserve() {} disconnect() { this.active = false; }
	};
	const properties = {}; const reads = { boxes: 0, queries: 0 };
	const row = { scrollWidth: 1500, clientWidth: 500, clientHeight: 200, scrollLeft: 0, children: [], isConnected: true,
		matches: s => s === '.section-list-horizontal-scroll', closest: s => s === '.section-list-horizontal-scroll' ? row : null,
		style: { setProperty(k,v) { properties[k]=v; }, removeProperty(k) { delete properties[k]; } },
		getBoundingClientRect: () => { reads.boxes++; return { top: 0, left: 0 }; }, classList: { add: x => classes.add(x), remove: x => classes.delete(x) }, contains: t => t === target };
	const target = { closest: s => s === '.section-list-horizontal-scroll' ? row : null };
	const document = { documentElement: { classList: { toggle(k,v) { if(v) rootClasses.add(k); else rootClasses.delete(k); }, remove: k => rootClasses.delete(k) } }, querySelectorAll: () => { reads.queries++; return [row]; }, addEventListener: (n,f) => listeners.set(n,f), removeEventListener: n => listeners.delete(n) };
	vm.runInNewContext(fs.readFileSync(require.resolve('../trakt-horizontal-scroll.js'),'utf8'), { document, MutationObserver: observerClass('mutation'), ResizeObserver: observerClass('resize'), IntersectionObserver: observerClass('intersection'), getComputedStyle: () => ({paddingLeft:'10px',paddingRight:'10px',columnGap: properties['--cinetrakt-row-gap'] || '10px',flexWrap:'nowrap'}), window: { location, addEventListener: (n,f)=>windowListeners.set(n,f), removeEventListener: n=>windowListeners.delete(n) }, navigation:{addEventListener:(n,f)=>navigationListeners.set(n,f),removeEventListener:n=>navigationListeners.delete(n)}, setTimeout: () => 1, clearTimeout() {}, CineTraktSettings: { ready: { then() {} }, onChange: f => { changed=f; return () => {}; } } });
	changed({ traktHorizontalScroll: true });
	function send(name, options={}) { const e = { target, pointerType: 'mouse', button: 0, buttons: 1, pointerId: 1, clientX: 100, clientY: 50, preventDefault() { this.prevented=true; }, stopImmediatePropagation() { this.stopped=true; }, ...options }; listeners.get(name)(e); return e; }
	return { row, send, classes, changed, properties, observers, reads, rootClasses, location, windowListeners, navigationListeners,
		notify(kind) { observers.find(o => o.kind === kind).callback(kind === 'mutation' ? [{ target: row, addedNodes: [] }] : [{target: row, isIntersecting:true}]); } };
}

test('only film/show detail routes activate CSS and dragging, never home or other Trakt pages', () => {
	for(const path of ['/home','/users/me/progress','/profile/me','/search','/lists/official/example-collection','/shows/test-show/seasons/1','/movies/test-movie/related']) {
		const f=fixture(path); assert.equal(f.rootClasses.size,0,path);
		f.send('pointerdown'); f.send('pointermove',{clientX:20}); assert.equal(f.row.scrollLeft,0,path);
	}
	for(const path of ['/movies/test-movie-2026','/shows/test-show','/shows/test-show/']) assert.equal(fixture(path).rootClasses.has('cinetrakt-horizontal-scroll'),true);
});

test('SPA navigation and Back restore native pages and re-enable only eligible fiches', () => {
	const f=fixture(); assert.equal(f.rootClasses.size,1);
	f.location.pathname='/home'; f.navigationListeners.get('currententrychange')(); assert.equal(f.rootClasses.size,0);
	f.send('pointerdown'); f.send('pointermove',{clientX:20}); assert.equal(f.row.scrollLeft,0);
	f.location.pathname='/shows/test-show'; f.windowListeners.get('popstate')(); assert.equal(f.rootClasses.size,1);
	f.changed({traktHorizontalScroll:false}); f.location.pathname='/movies/test'; f.navigationListeners.get('currententrychange')(); assert.equal(f.rootClasses.size,0);
});
test('drag threshold preserves normal clicks, middle clicks and context-menu interactions', () => {
	const f=fixture(); f.send('pointerdown'); f.send('pointermove',{clientX:103}); f.send('pointerup'); assert.equal(f.send('click').prevented,undefined);
	for(const button of [1,2]) { f.send('pointerdown',{button}); f.send('pointermove',{clientX:20}); assert.equal(f.row.scrollLeft,0); }
});
test('horizontal dragging scrolls the row and suppresses only its concluding left click', () => {
	const f=fixture(); f.send('pointerdown'); assert.equal(f.send('pointermove',{clientX:30}).prevented,true); assert.equal(f.row.scrollLeft,70);
	f.send('pointerup'); assert.equal(f.send('click',{button:2}).prevented,undefined); assert.equal(f.send('click').stopped,true); assert.equal(f.send('click').prevented,undefined);
});
test('vertical gestures, interactive controls and disabling keep native behavior', () => {
	const f=fixture(); f.send('pointerdown'); f.send('pointermove',{clientY:90}); f.send('pointermove',{clientX:30}); assert.equal(f.row.scrollLeft,0);
	f.send('pointerdown',{target:{closest:s=>s==='.section-list-horizontal-scroll'?f.row:{}}}); f.send('pointermove',{clientX:30}); assert.equal(f.row.scrollLeft,0);
	f.changed({traktHorizontalScroll:false}); f.send('pointerdown'); f.send('pointermove',{clientX:20}); assert.equal(f.row.scrollLeft,0);
});

test('native review text buttons allow dragging while a simple click still opens the review', () => {
	const f = fixture();
	const preview = { matches: selector => selector === '.trakt-comment-preview' };
	const text = { closest: selector => selector === '.section-list-horizontal-scroll' ? f.row : preview };
	f.send('pointerdown', { target: text }); f.send('pointerup');
	assert.equal(f.send('click', { target: text }).prevented, undefined);
	f.send('pointerdown', { target: text });
	assert.equal(f.send('pointermove', { target: text, clientX: 30 }).prevented, true);
	assert.equal(f.row.scrollLeft, 70);
	f.send('pointerup'); assert.equal(f.send('click', { target: f.row }).stopped, true);
});

test('release aligns to a whole card within the content inset', () => {
	const f=fixture(); f.row.clientWidth=340; f.row.scrollWidth=1110;
	f.row.children=Array.from({length:10},(_,i)=>({getBoundingClientRect:()=>({left:10+i*110-f.row.scrollLeft,right:110+i*110-f.row.scrollLeft,width:100,height:150})}));
	f.send('pointerdown',{clientX:300}); f.send('pointermove',{clientX:85});
	assert.equal(f.row.scrollLeft,215); f.send('pointerup'); assert.equal(f.row.scrollLeft,220);
	// At the far end, keep the terminal stop so the last item remains reachable.
	f.send('pointerdown',{clientX:300}); f.send('pointermove',{clientX:-250}); f.send('pointerup');
	assert.equal(f.row.scrollLeft,770);
});

test('a terminal stop between card starts keeps the final season accessible after release', () => {
	const f=fixture(); f.row.clientWidth=350; f.row.scrollWidth=1110;
	f.row.children=Array.from({length:10},(_,i)=>({getBoundingClientRect:()=>({left:10+i*110-f.row.scrollLeft,right:110+i*110-f.row.scrollLeft,width:100,height:150})}));
	f.send('pointerdown',{clientX:900}); f.send('pointermove',{clientX:140});
	assert.equal(f.row.scrollLeft,760); f.send('pointerup');
	assert.equal(f.row.scrollLeft,760, 'do not jump back to the preceding card start at 660');
});

test('display-contents wrappers and variable width review cards use their actual geometry', () => {
	const f=fixture();
	const card={getBoundingClientRect:()=>({left:250-f.row.scrollLeft,right:450-f.row.scrollLeft,width:200,height:150})};
	f.row.children=[{getBoundingClientRect:()=>({width:0,height:0}),children:[card]}];
	f.send('pointerdown',{clientX:400}); f.send('pointermove',{clientX:180}); f.send('pointerup');
	assert.equal(f.row.scrollLeft,240);
});

