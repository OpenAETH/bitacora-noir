// ide-app.js — glue del IDE (ide12.html) específico de mobile/Capacitor.
// Se carga después de platform.js + core.js.

function bnBackToApp() {
  // Si veníamos navegados desde la app (history disponible), back; si no, fallback a /.
  if (window.history.length > 1 && document.referrer && new URL(document.referrer, location.href).origin === location.origin) {
    window.history.back();
  } else {
    location.href = '/';
  }
}

window.bnBackToApp = bnBackToApp;
window.BN = window.BN || {};
window.BN.ide = { back: bnBackToApp };
