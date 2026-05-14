// platform.js — feature detection for Bitácora Noir
// Loaded as ES module from aetheryon_frontend.html and ide12.html.
// Exposes detection flags and applies CSS classes / hides desktop-only controls.

export const isTouchDevice = matchMedia('(pointer: coarse)').matches;
export const isMobileViewport = matchMedia('(max-width: 640px)').matches;
export const isTabletViewport = matchMedia('(min-width: 641px) and (max-width: 900px)').matches;
export const canScreenRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) && !isTouchDevice;
export const canUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
export const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
export const isStandalonePWA = matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function applyPlatformClasses() {
  const cls = document.documentElement.classList;
  if (isTouchDevice) cls.add('is-touch');
  if (isMobileViewport) cls.add('is-mobile');
  if (isTabletViewport) cls.add('is-tablet');
  if (isCapacitor) cls.add('is-capacitor');
  if (isStandalonePWA) cls.add('is-pwa');
  if (!canScreenRecord) cls.add('no-screen-rec');
}

function hideScreenRecordControls() {
  if (canScreenRecord) return;
  document.querySelectorAll('[data-requires="screen-capture"]').forEach(el => {
    el.style.display = 'none';
  });
}

function watchViewport() {
  const mq = matchMedia('(max-width: 640px)');
  const handler = e => document.documentElement.classList.toggle('is-mobile', e.matches);
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);
}

function init() {
  applyPlatformClasses();
  hideScreenRecordControls();
  watchViewport();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

window.BN = window.BN || {};
window.BN.platform = {
  isTouchDevice, isMobileViewport, isTabletViewport,
  canScreenRecord, canUserMedia, isCapacitor, isStandalonePWA
};
