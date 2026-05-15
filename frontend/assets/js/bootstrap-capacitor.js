// bootstrap-capacitor.js — runs BEFORE platform.js and the rest of the modules.
// Classic script (not ESM) so it executes synchronously and the patches are in
// place before any module touches window.open or fires fetch().
//
// When loaded outside a Capacitor APK (regular browser, PWA), the IIFE is a
// no-op: window.Capacitor is undefined, so we exit early.
(function () {
  var Cap = window.Capacitor;
  var isCap = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  if (!isCap) return;

  // Hosted-webview mode: the WebView's location.origin is something like
  // https://localhost (androidScheme), so relative '/api/...' paths would hit
  // the WebView itself. Force an absolute base pointing to the deployed backend.
  window.API_URL = 'https://aetheryon-bitacora.onrender.com/api';

  // Inside a WebView, window.open(url, '_blank') hands the URL to the system
  // browser and the user loses the session. Keep navigation inside the WebView.
  var _open = window.open;
  window.open = function (url, target) {
    if (target === '_blank' || target === undefined || target === '') {
      if (url) window.location.href = url;
      return null;
    }
    return _open.apply(window, arguments);
  };
})();
