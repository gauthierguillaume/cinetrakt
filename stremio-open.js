(() => {
	'use strict';
	const protocol = globalThis.CineTraktExtensionProtocol
		|| (typeof require === 'function' ? require('./extension-protocol.js') : null);
	const { MESSAGE_TYPES } = protocol;

	// Desktop may wake on the first protocol call without consuming its media route.
	const NATIVE_RETRY_DELAYS = Object.freeze([1200, 2400]);

	function getCurrentScreenBounds(environment = globalThis) {
		const screenLike = environment.screen || {};
		const windowLike = environment.window || environment;
		return {
			availLeft: Number.isFinite(screenLike.availLeft) ? screenLike.availLeft : 0,
			availTop: Number.isFinite(screenLike.availTop) ? screenLike.availTop : 0,
			availWidth: screenLike.availWidth || windowLike.outerWidth || 1920,
			availHeight: screenLike.availHeight || windowLike.outerHeight || 1080,
		};
	}

	function canUseExtensionRuntime(environment = globalThis) {
		try {
			const runtime = environment.chrome?.runtime;
			return Boolean(runtime?.id && typeof runtime.sendMessage === 'function');
		} catch (error) {
			return false;
		}
	}

	function createStremioOpener(environment = globalThis) {
		function sendRuntimeMessage(message, callback) {
			if (!canUseExtensionRuntime(environment)) return false;

			try {
				const runtime = environment.chrome.runtime;
				runtime.sendMessage(message, (response) => {
					let runtimeError = null;
					try {
						runtimeError = runtime.lastError || null;
					} catch (error) {
						runtimeError = error;
					}
					if (typeof callback === 'function') callback(response, runtimeError);
				});
				return true;
			} catch (error) {
				return false;
			}
		}

		function openNative(stremioUrl) {
			if (!stremioUrl || !environment.document?.body) return false;

			function triggerNativeProtocol() {
				const tempLink = environment.document.createElement('a');
				tempLink.href = stremioUrl;
				tempLink.target = '_self';
				tempLink.className = 'watch-on-stremio-temp-link';
				tempLink.dataset.watchOnStremioTempLink = 'true';
				tempLink.style.display = 'none';

				environment.document.body.appendChild(tempLink);
				tempLink.click();
				environment.document.body.removeChild(tempLink);
			}

			triggerNativeProtocol();
			NATIVE_RETRY_DELAYS.forEach((delay) => environment.setTimeout(triggerNativeProtocol, delay));
			return true;
		}

		function openWeb(stremioUrl) {
			const popupUrl = environment.CineTraktStremioUrls?.getStremioPopupUrl(stremioUrl);
			if (!popupUrl) return false;

			return sendRuntimeMessage({
				type: MESSAGE_TYPES.OPEN_STREMIO_WEB,
				url: popupUrl,
				screenBounds: getCurrentScreenBounds(environment),
			});
		}

		function openFromMouseEvent(stremioUrl, event) {
			if (!stremioUrl) return false;

			if (event) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
			}

			if (event && (event.type === 'contextmenu' || event.button === 2)) {
				return openNative(stremioUrl);
			}

			return openWeb(stremioUrl);
		}

		return Object.freeze({
			sendRuntimeMessage,
			openNative,
			openWeb,
			openFromMouseEvent,
			getCurrentScreenBounds: () => getCurrentScreenBounds(environment),
		});
	}

	const api = Object.freeze({
		NATIVE_RETRY_DELAYS,
		getCurrentScreenBounds,
		canUseExtensionRuntime,
		createStremioOpener,
	});

	globalThis.CineTraktStremioOpen = createStremioOpener(globalThis);

	if (typeof module !== 'undefined' && module.exports) {
		module.exports = api;
	}
})();
