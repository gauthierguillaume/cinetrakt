(() => {
	'use strict';

	function getRouteKey(locationLike = globalThis.location) {
		if (!locationLike) return '';
		return `${locationLike.pathname || ''}${locationLike.search || ''}${locationLike.hash || ''}`;
	}

	function hasOwnedMarker(element, ownedMarker) {
		if (!element || element.nodeType !== 1) return false;
		if (ownedMarker.test(element.id || '')) return true;
		return Array.from(element.classList || []).some((className) => ownedMarker.test(className));
	}

	function isOwnedMutation(mutation, ownedMarker) {
		if (!mutation || !(ownedMarker instanceof RegExp)) return false;
		if (hasOwnedMarker(mutation.target, ownedMarker)) return true;

		const changedNodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
		return changedNodes.length > 0 && changedNodes.every((node) => {
			if (node.nodeType === 3) return hasOwnedMarker(node.parentElement, ownedMarker);
			return hasOwnedMarker(node, ownedMarker);
		});
	}

	function createRuntime({
		environment = globalThis,
		mutationDelay = 200,
		ownedMarker,
		name = 'page',
		observeBody = false,
		subscribeToSettings = false,
	} = {}) {
		if (!(ownedMarker instanceof RegExp)) throw new TypeError('ownedMarker must be a RegExp');

		let update = null;
		let observer = null;
		let timer = null;
		let running = false;
		let rerunRequested = false;
		let started = false;
		let lastProcessedRouteKey = '';
		const pendingReasons = new Set();
		const cleanupCallbacks = [];

		function listen(target, type, listener, options) {
			if (!target?.addEventListener) return;
			target.addEventListener(type, listener, options);
			cleanupCallbacks.push(() => target.removeEventListener(type, listener, options));
		}

		async function flush() {
			timer = null;
			if (!update) return;
			if (running) {
				rerunRequested = true;
				return;
			}

			running = true;
			const routeKey = getRouteKey(environment.location);
			const context = {
				routeKey,
				routeChanged: routeKey !== lastProcessedRouteKey,
				reasons: Array.from(pendingReasons),
			};
			pendingReasons.clear();

			try {
				await update(context);
				lastProcessedRouteKey = routeKey;
			} catch (error) {
				console.error(`CineTrakt: ${name} feature update failed`, error);
			} finally {
				running = false;
				if (rerunRequested) {
					rerunRequested = false;
					schedule('queued-update', 0);
				}
			}
		}

		function schedule(reason = 'dom-update', delay = mutationDelay) {
			pendingReasons.add(reason);
			if (running) {
				rerunRequested = true;
				return;
			}

			environment.clearTimeout(timer);
			timer = environment.setTimeout(flush, Math.max(0, delay));
		}

		function handleMutations(mutations) {
			const routeChanged = getRouteKey(environment.location) !== lastProcessedRouteKey;
			if (routeChanged || mutations.some((mutation) => !isOwnedMutation(mutation, ownedMarker))) {
				schedule(routeChanged ? 'route-dom-update' : 'dom-update', routeChanged ? 0 : mutationDelay);
			}
		}

		function stop() {
			if (!started) return;
			started = false;
			observer?.disconnect();
			observer = null;
			environment.clearTimeout(timer);
			timer = null;
			cleanupCallbacks.splice(0).forEach((cleanup) => cleanup());
			pendingReasons.clear();
			update = null;
		}

		function start(updateCallback) {
			if (started || typeof updateCallback !== 'function') return;
			started = true;
			update = updateCallback;

			observer = new environment.MutationObserver(handleMutations);
			const target = observeBody
				? (environment.document.body || environment.document.documentElement)
				: environment.document.documentElement;
			observer.observe(target, { childList: true, subtree: true });

			const scheduleRouteUpdate = () => schedule('route-change', 0);
			listen(environment, 'popstate', scheduleRouteUpdate);
			listen(environment, 'hashchange', scheduleRouteUpdate);
			listen(environment.navigation, 'currententrychange', scheduleRouteUpdate);
			listen(environment.document, 'visibilitychange', () => {
				if (environment.document.visibilityState === 'visible') schedule('visibility', 0);
			});
			listen(environment, 'pagehide', stop, { once: true });

			if (subscribeToSettings) {
				const unsubscribe = environment.CineTraktSettings?.onChange?.(() => schedule('settings-change', 0));
				if (typeof unsubscribe === 'function') cleanupCallbacks.push(unsubscribe);
			}

			schedule('initial', 0);
		}

		return Object.freeze({ start, stop, schedule });
	}

	const api = Object.freeze({ createRuntime, getRouteKey, isOwnedMutation });
	globalThis.CineTraktDomRuntime = api;

	if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
