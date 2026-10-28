(() => {
	'use strict';
	const charts = new WeakMap();
	const { CHART_WIDTH, buildSeasonChart, nearestSeasonIndex } = globalThis.CineTraktSeasonRatings;

	function ensureStyles() {
		if (document.getElementById('cinetrakt-season-chart-styles')) return;
		const style = document.createElement('style');
		style.id = 'cinetrakt-season-chart-styles';
		style.textContent = `
			.cinetrakt-season-card {
				appearance: none; box-sizing: border-box; position: relative;
				display: flex; flex: 0 0 236px; flex-direction: column; align-items: center; justify-content: center;
				width: 236px; height: 110px; padding: 8px; margin: 0; border: 0;
				border-radius: var(--border-radius-m, 12px); background: var(--color-card-background, #100e13);
				color: var(--viz-1, var(--cinetrakt-accent-text, #a699ff)); font: inherit; cursor: pointer;
			}
			.cinetrakt-season-card:focus-visible { outline: 2px solid var(--cinetrakt-accent-focus); outline-offset: 3px; }
			.cinetrakt-season-card .cinetrakt-season-meta {
				display: block; width: 100%; margin-bottom: 5px; text-align: center;
				color: var(--color-text-secondary, #a09ba6); font-size: 10px; line-height: 14px; white-space: nowrap;
			}
			.cinetrakt-season-card svg { display: block; width: ${CHART_WIDTH}px; height: 74px; overflow: visible; }
			.cinetrakt-season-card .cinetrakt-season-line { stroke: currentColor; stroke-width: 1.6; fill: none; }
			.cinetrakt-season-card .cinetrakt-season-dot { fill: currentColor; stroke: var(--color-card-background, #100e13); stroke-width: 1.2; }
			.cinetrakt-season-card .cinetrakt-season-tick { fill: var(--color-text-secondary, #a09ba6); font-size: 8.5px; }
			.cinetrakt-season-card .cinetrakt-season-guide { stroke: currentColor; stroke-width: .6; stroke-dasharray: 2 2; opacity: .6; }
			.cinetrakt-season-tooltip {
				position: absolute; z-index: 5; top: 0; transform: translate(-50%, -110%); pointer-events: none;
				padding: 6px 8px; border-radius: var(--border-radius-xs, 4px); white-space: nowrap;
				background: var(--color-tooltip-background, #26222e); color: var(--color-tooltip-text, #fff);
				font-size: 12px; line-height: 1; box-shadow: var(--shadow-menu, 0 3px 12px #0008);
			}
			.cinetrakt-season-tooltip[hidden] { display: none; }
			.cinetrakt-season-empty { color: var(--color-text-secondary, #a09ba6); font-size: 12px; }
			.cinetrakt-season-readout { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
		`;
		document.head.appendChild(style);
	}

	function showPoint(button, index) {
		const state = charts.get(button);
		const point = state?.chart.points[index];
		if (!point) return;
		state.active = index;
		const label = `S${point.season} · ${point.percent}%`;
		const tooltip = button.querySelector('.cinetrakt-season-tooltip');
		tooltip.textContent = label; tooltip.hidden = false;
		tooltip.style.left = `${Math.max(10, Math.min(90, point.x / CHART_WIDTH * 100))}%`;
		button.querySelector('.cinetrakt-season-readout').textContent = label;
		const dot = button.querySelector('.cinetrakt-season-active');
		dot.setAttribute('cx', point.x); dot.setAttribute('cy', point.y); dot.setAttribute('visibility', 'visible');
		const guide = button.querySelector('.cinetrakt-season-guide');
		guide.setAttribute('x1', point.x); guide.setAttribute('x2', point.x); guide.setAttribute('visibility', 'visible');
	}

	function hidePoint(button) {
		button.querySelector('.cinetrakt-season-tooltip')?.setAttribute('hidden', '');
		button.querySelector('.cinetrakt-season-active')?.setAttribute('visibility', 'hidden');
		button.querySelector('.cinetrakt-season-guide')?.setAttribute('visibility', 'hidden');
	}

	function createButton(imdbId, openRatings) {
		ensureStyles();
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'wos-imdb-ratings-popup-button cinetrakt-season-card';
		button.dataset.imdbId = imdbId;
		button.addEventListener('click', event => {
			event.preventDefault(); event.stopPropagation(); hidePoint(button);
			openRatings(button.dataset.imdbId || '');
		});
		button.addEventListener('pointermove', event => {
			const state = charts.get(button); const svg = button.querySelector('svg');
			if (!state?.chart.points.length || !svg) return;
			const rect = svg.getBoundingClientRect();
			if (rect.width) showPoint(button, nearestSeasonIndex(state.chart.points, (event.clientX - rect.left) * CHART_WIDTH / rect.width));
		});
		button.addEventListener('pointerleave', () => hidePoint(button));
		button.addEventListener('blur', () => hidePoint(button));
		button.addEventListener('focus', () => showPoint(button, 0));
		button.addEventListener('keydown', event => {
			const state = charts.get(button); if (!state?.chart.points.length) return;
			const last = state.chart.points.length - 1;
			let index;
			if (event.key === 'ArrowRight') index = Math.min(last, (state.active ?? -1) + 1);
			else if (event.key === 'ArrowLeft') index = Math.max(0, (state.active ?? 1) - 1);
			else if (event.key === 'Home') index = 0;
			else if (event.key === 'End') index = last;
			else return;
			event.preventDefault(); event.stopPropagation(); showPoint(button, index);
		});
		updateButton(button, null);
		return button;
	}

	function updateButton(button, seasons) {
		const signature = JSON.stringify(seasons);
		if (charts.get(button)?.signature === signature) return;
		const chart = buildSeasonChart(seasons);
		charts.set(button, { signature, chart, active: null });
		if (!chart.points.length) {
			button.innerHTML = `<span class="cinetrakt-season-empty">${seasons == null ? 'Saisons…' : 'Épisodes IMDb'}</span>`;
			button.setAttribute('aria-label', 'Open IMDb episode ratings');
			return;
		}
		const { peak, low } = chart;
		button.setAttribute('aria-label', `Open IMDb episode ratings · ${chart.points.length} saisons · Max S${peak.season} ${peak.percent}% · Min S${low.season} ${low.percent}%`);
		button.innerHTML = `<span class="cinetrakt-season-meta">Peak S${peak.season} · ${peak.percent}% · Low S${low.season} · ${low.percent}%</span>
			<svg viewBox="0 0 ${CHART_WIDTH} 74" aria-hidden="true" focusable="false">
				<defs><linearGradient id="cinetrakt-season-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".5"/><stop offset="1" stop-color="currentColor" stop-opacity=".15"/></linearGradient></defs>
				<path d="${chart.area}" fill="url(#cinetrakt-season-area)"/>
				<path class="cinetrakt-season-line" d="${chart.line}"/>
				${chart.points.map(p => `<circle class="cinetrakt-season-dot" data-season="${p.season}" cx="${p.x}" cy="${p.y}" r="2"/>`).join('')}
				${chart.ticks.map(p => `<text class="cinetrakt-season-tick" x="${p.x}" y="71" text-anchor="middle">S${p.season}</text>`).join('')}
				<line class="cinetrakt-season-guide" y1="6" y2="57" visibility="hidden"/>
				<circle class="cinetrakt-season-active cinetrakt-season-dot" r="3" visibility="hidden"/>
			</svg><span class="cinetrakt-season-tooltip" hidden aria-hidden="true"></span><span class="cinetrakt-season-readout" aria-live="polite"></span>`;
	}

	globalThis.CineTraktSeasonChart = Object.freeze({ createButton, updateButton });
})();
