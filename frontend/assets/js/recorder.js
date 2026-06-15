// recorder.js — Bitácora Noir
// Captura de pantalla / webcam / micrófono + MediaRecorder + screenshot.
// Coexiste con el HTML legacy: expone funciones en window.* para que los
// onclick="..." existentes sigan funcionando.
//
// En mobile (sin getDisplayMedia o pointer:coarse) el botón #btnScr queda
// oculto por platform.js, pero por las dudas toggleScreen() cae a getUserMedia
// (cámara trasera) como fallback razonable.

import { canScreenRecord, canUserMedia, isTouchDevice } from './platform.js';

// ── State ───────────────────────────────────────────────────────────────────
let screenStream = null;
let webcamStream = null;
let micStream = null;
let mediaRecorder = null;
let recChunks = [];
let recInterval = null;
let recSeconds = 0;

let audioCtx = null;         // AudioContext del mixer de audio (sistema + mic)
let pipWindow = null;        // ventana Document PiP donde flota la webcam

// Webcam position presets (PiP)
const WC_STYLES = {
  top: 'top:10px;left:50%;transform:translateX(-50%);width:200px;height:112px',
  tl:  'top:10px;left:10px;width:160px;height:120px',
  tr:  'top:10px;right:10px;width:160px;height:120px',
  bl:  'bottom:10px;left:10px;width:160px;height:120px',
  br:  'bottom:10px;right:10px;width:160px;height:120px',
  ct:  'inset:0;width:100%;height:100%;transform:none;border-radius:0',
  cb:  'bottom:10px;left:50%;transform:translateX(-50%);width:200px;height:112px',
  vl:  'top:10px;left:10px;width:100px;height:178px',
  vr:  'top:10px;right:10px;width:100px;height:178px',
};
let wcPos = 'br';

// ── Helpers (delegate to legacy globals) ────────────────────────────────────
const toast = (...args) => (window.BN?.core?.toast || window.toast)?.(...args);
const $ = id => document.getElementById(id);
const cfg = () => window.cfg || { save: true, audio: true, hq: false, timestamp: true, dl: false, codec: 'auto' };
const apiBase = () => $('cfgApi')?.value || window.API_URL || '/api';
const token = () => (window.BN?.core?.getToken || window.getToken)?.();
const escH = s => (window.escH ? window.escH(s) : String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])));
const fmtSize = b => (window.fmtSize ? window.fmtSize(b) : `${(b/1024/1024).toFixed(2)} MB`);

// ── Webcam style ────────────────────────────────────────────────────────────
function applyWcStyle() {
  const v = $('wcamVid');
  if (!v) return;
  const s = WC_STYLES[wcPos] || WC_STYLES['br'];
  const isFS = wcPos === 'ct';
  v.style.cssText = s + `;position:absolute;z-index:${isFS ? 5 : 10};border:${isFS ? 'none' : '2px solid var(--c)'};box-shadow:${isFS ? 'none' : '0 0 16px rgba(0,245,255,.28)'};object-fit:cover;background:#000;transition:all .25s;display:none`;
  if (webcamStream) v.style.display = 'block';
}

function setWcPos(_btn, pos) {
  wcPos = pos;
  document.querySelectorAll('.pos-btn').forEach(b => b.classList.toggle('active', b.dataset.pos === pos));
  applyWcStyle();
}

// ── Screen capture ──────────────────────────────────────────────────────────
async function toggleScreen() {
  const btn = $('btnScr'), vid = $('scrPrev'), poff = $('prevOff');
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
    btn?.classList.remove('on');
    if (vid) vid.style.display = 'none';
    if (poff) poff.style.display = '';
    $('prevBox')?.classList.remove('active');
    return;
  }
  if (!canScreenRecord) {
    toast('Captura de pantalla no disponible en este dispositivo', 'err');
    return;
  }
  try {
    // NO fijamos width/height: pedir un 'ideal' hace que Chrome downscalee la
    // captura en origen (peor nitidez). Dejamos que capture a resolución nativa
    // de la pantalla/pestaña y, si hace falta, el canvas reescala con calidad
    // alta. Sólo pedimos cadencia de frames alta.
    const hd = cfg().hq;
    // Hints de superficie: empujamos a que el usuario comparta el MONITOR COMPLETO,
    // para que la grabación capture todo el dispositivo aunque cambie de pestaña/app.
    // Son sólo sugerencias (el usuario siempre elige) → verificamos el resultado abajo.
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: hd ? 60 : 30, max: 60 }, displaySurface: 'monitor' },
      audio: { suppressLocalAudioPlayback: false },
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'include',
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
    });
    if (vid) { vid.srcObject = screenStream; vid.style.display = 'block'; }
    if (poff) poff.style.display = 'none';
    btn?.classList.add('on');
    $('prevBox')?.classList.add('active');
    screenStream.getVideoTracks()[0].onended = () => toggleScreen();
    // Si el usuario eligió una sola pestaña/ventana, NO se capturan las otras pestañas:
    // avisamos (no es error — se permite, pero conviene "Toda la pantalla").
    const surface = screenStream.getVideoTracks()[0].getSettings?.().displaySurface;
    if (surface === 'browser' || surface === 'window') {
      toast('Compartiste una sola pestaña/ventana — para grabar todo el dispositivo elegí "Toda la pantalla"', 'info');
    } else {
      toast('Captura de pantalla activa', 'info');
    }
  } catch (e) {
    toast('Permiso denegado: pantalla', 'err');
  }
}

// ── Webcam ──────────────────────────────────────────────────────────────────
async function toggleWebcam() {
  const btn = $('btnWcm'), vid = $('wcamVid');
  if (webcamStream) {
    exitWebcamPip();
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
    btn?.classList.remove('on');
    if (vid) vid.style.display = 'none';
    return;
  }
  if (!canUserMedia) {
    toast('Cámara no disponible en este navegador', 'err');
    return;
  }
  try {
    // Resolución según calidad: HQ → 1080p, liviano → 720p. Antes el desktop
    // pedía 320×240 (QVGA) → webcam borrosa. Pedimos 'ideal' para que el
    // navegador degrade solo si el hardware no llega.
    const hd = cfg().hq;
    const vCon = {
      width:  { ideal: hd ? 1920 : 1280 },
      height: { ideal: hd ? 1080 : 720 },
      frameRate: { ideal: 30 },
    };
    if (isTouchDevice) vCon.facingMode = 'user';  // selfie por default en mobile
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: vCon, audio: false });
    if (vid) { vid.srcObject = webcamStream; applyWcStyle(); vid.style.display = 'block'; }
    btn?.classList.add('on');
    toast('Webcam activada', 'info');
    // Flotar la webcam sobre toda la pantalla (Document PiP) para que la grabación
    // de pantalla la capture aunque cambies de pestaña. Best-effort: el click del
    // botón es el gesto de usuario que la API exige.
    enterWebcamPip();
  } catch (e) {
    toast('Permiso denegado: webcam', 'err');
  }
}

// ── Webcam flotante (Picture-in-Picture sobre TODA la pantalla) ─────────────
// Saca la webcam de la pestaña y la pone en una ventana always-on-top del SO.
// Así la grabación de pantalla completa la captura aunque la pestaña esté oculta.
// Usa Document PiP (Chrome/Edge 116+, conserva borde cyan); si no está, cae al
// PiP de video nativo (más universal, sin estilo).
async function enterWebcamPip() {
  if (!webcamStream) return;
  // Dimensiones según preset: vertical (vl/vr) → retrato, resto → apaisado.
  const portrait = wcPos === 'vl' || wcPos === 'vr';
  const w = portrait ? 180 : 320;
  const h = portrait ? 320 : 180;

  // 1) Document PiP — flota HTML, mantenemos el look cyborg.
  if (window.documentPictureInPicture?.requestWindow) {
    try {
      pipWindow = await window.documentPictureInPicture.requestWindow({ width: w, height: h });
      const doc = pipWindow.document;
      doc.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
      const v = doc.createElement('video');
      v.autoplay = true; v.muted = true; v.playsInline = true;
      v.srcObject = webcamStream;
      v.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border:2px solid #00f5ff;box-sizing:border-box;background:#000';
      doc.body.append(v);
      pipWindow.addEventListener('pagehide', () => { pipWindow = null; });
      toast('Webcam flotando sobre la pantalla', 'ok');
      return;
    } catch (e) {
      pipWindow = null;  // sigue al fallback
    }
  }

  // 2) Fallback: PiP de video nativo sobre el <video id="wcamVid">.
  const vid = $('wcamVid');
  if (vid?.requestPictureInPicture) {
    try {
      await vid.requestPictureInPicture();
      toast('Webcam flotando sobre la pantalla', 'ok');
      return;
    } catch (e) {/* el usuario puede flotarla manualmente */}
  }
  toast('Tu navegador no flota la webcam automáticamente — usá el botón PiP del video', 'info');
}

function exitWebcamPip() {
  if (pipWindow) { try { pipWindow.close(); } catch (_) {} pipWindow = null; }
  try {
    if (document.pictureInPictureElement) document.exitPictureInPicture();
  } catch (_) {}
}

// ── Microphone ──────────────────────────────────────────────────────────────
async function toggleMic() {
  const btn = $('btnMic');
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
    btn?.classList.remove('on');
    return;
  }
  if (!canUserMedia) {
    toast('Micrófono no disponible en este navegador', 'err');
    return;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    btn?.classList.add('on');
    toast('Micrófono activado', 'info');
  } catch (e) {
    toast('Permiso denegado: micrófono', 'err');
  }
}

// ── System audio toggle (UI only) ───────────────────────────────────────────
function toggleSysAudio() {
  $('btnSys')?.classList.toggle('on');
  toast('Audio del sistema: se captura junto con pantalla', 'info');
}

// ── Video a grabar: TRACK CRUDO de pantalla ─────────────────────────────────
// Decisión de arquitectura: NO componemos en canvas. El compositor de canvas se
// CONGELABA al cambiar de pestaña, porque tanto el render del <video> que lo
// alimenta como el pintado del canvas se suspenden en un documento en segundo
// plano. En cambio, el track de getDisplayMedia lo captura el navegador a nivel
// del SISTEMA OPERATIVO: sigue corriendo aunque la pestaña de Bitácora esté oculta.
//
// La webcam aparece en la grabación porque flota FÍSICAMENTE sobre la pantalla
// como ventana Picture-in-Picture (ver enterWebcamPip), no como un <div> dentro
// de la pestaña. Así la captura de pantalla completa la toma naturalmente.
//
// Devuelve el video track a grabar. Pantalla si existe; si no, webcam directa.
function buildVideoTrack() {
  const src = screenStream || webcamStream;
  return src ? (src.getVideoTracks()[0] || null) : null;
}

// Devuelve el audio track a grabar. null = sin audio.
// 1 fuente → track directo. 2 fuentes (sistema+mic) → mezcla vía AudioContext.
function buildAudioTrack() {
  const sysTrack = (cfg().audio && screenStream) ? screenStream.getAudioTracks()[0] : null;
  const micTrack = (cfg().audio && micStream) ? micStream.getAudioTracks()[0] : null;
  const present = [sysTrack, micTrack].filter(Boolean);
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  // dos fuentes → mezclar
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  [screenStream, micStream].forEach(s => {
    if (s && s.getAudioTracks().length) {
      audioCtx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest);
    }
  });
  return dest.stream.getAudioTracks()[0] || null;
}

// Libera los recursos del mixer de audio. (Ya no hay canvas/worker: la grabación
// usa el track de pantalla crudo y la webcam flota como PiP.)
function stopCompositor() {
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
}

// ── Recording ───────────────────────────────────────────────────────────────
async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
    return;
  }
  const sources = [screenStream, webcamStream, micStream].filter(Boolean);
  if (!sources.length) {
    toast('Activa pantalla, webcam o micrófono primero', 'err');
    return;
  }
  // Video: track de pantalla crudo (no se congela en background); la webcam flota
  // como PiP sobre la pantalla. Audio: mezcla sistema+mic o directo.
  const vTrack = buildVideoTrack();
  const aTrack = buildAudioTrack();
  const combined = new MediaStream([vTrack, aTrack].filter(Boolean));

  let mimeType = 'video/webm';
  const c = cfg().codec;
  if (c === 'vp9' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
  else if (c === 'h264' && MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
  else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
  else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';  // iOS Safari

  const opts = { mimeType };
  if (vTrack) opts.videoBitsPerSecond = cfg().hq ? 10_000_000 : 2_500_000;  // HQ ≈ HD 1080p
  if (aTrack) opts.audioBitsPerSecond = cfg().hq ? 256_000 : 128_000;
  try {
    mediaRecorder = new MediaRecorder(combined, opts);
  } catch (e) {
    // Algunos webviews rechazan bitrate explícito: reintentar sólo con mimeType.
    try {
      mediaRecorder = new MediaRecorder(combined, { mimeType });
    } catch (e2) {
      stopCompositor();
      toast('Codec no soportado: ' + mimeType, 'err');
      return;
    }
  }
  recChunks = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = finalizeRecording;
  mediaRecorder.start(1000);

  recSeconds = 0;
  $('recBadge')?.classList.add('show');
  $('prevBox')?.classList.add('recording');
  const btn = $('recBtn');
  if (btn) { btn.className = 'rec-mb stop'; btn.innerHTML = '⏹ DETENER GRABACIÓN'; }
  const hbtn = $('hdrRecBtn');
  if (hbtn) { hbtn.classList.add('rec-active'); hbtn.textContent = '⏹ REC...'; }
  recInterval = setInterval(() => {
    recSeconds++;
    const h = String(Math.floor(recSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((recSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(recSeconds % 60).padStart(2, '0');
    const t = $('recTimer');
    if (t) t.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
  clearInterval(recInterval);
  $('recBadge')?.classList.remove('show');
  $('prevBox')?.classList.remove('recording');
  const btn = $('recBtn');
  if (btn) { btn.className = 'rec-mb start'; btn.innerHTML = '⏺ INICIAR GRABACIÓN'; }
  const hbtn = $('hdrRecBtn');
  if (hbtn) { hbtn.classList.remove('rec-active'); hbtn.textContent = '⏺ GRABAR'; }
}

async function finalizeRecording() {
  const mime = (mediaRecorder && mediaRecorder.mimeType) || 'video/webm';
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(recChunks, { type: mime });
  let label = $('recLabel')?.value.trim() || 'grabacion';
  if (cfg().timestamp) label += '_' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const projId = $('recProjSel')?.value;
  const url = URL.createObjectURL(blob);
  stopCompositor();
  if (typeof window.addRecItem === 'function') window.addRecItem(label, blob.size, url, ext);
  toast('Grabación finalizada: ' + fmtSize(blob.size), 'ok');

  if (projId && cfg().save) {
    const reader = new FileReader();
    reader.onload = async () => {
      const tk = token();
      try {
        const r = await fetch(`${apiBase()}/projects/${projId}/recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
          body: JSON.stringify({ dataUrl: reader.result, label })
        });
        const d = await r.json();
        if (d && d.file) {
          toast('Grabación guardada en R2', 'ok');
          if (typeof window.loadProjects === 'function') await window.loadProjects();
        } else if (cfg().dl) {
          autoDownload(url, `${label}.${ext}`);
        }
      } catch (_) {
        if (cfg().dl) autoDownload(url, `${label}.${ext}`);
      }
    };
    reader.readAsDataURL(blob);
  } else if (cfg().dl) {
    autoDownload(url, `${label}.${ext}`);
  } else {
    autoDownload(url, `${label}.${ext}`);
  }
}

function autoDownload(url, name) {
   const a = document.createElement('a');
   a.href = url; a.download = name; a.click();
}

// ─── RECORDING ITEM (UI append) ──────────────────────────────────────────────
function addRecItem(name, size, url, ext = 'webm') {
   const list = $('recList');
   const empty = list?.querySelector('.empty-txt'); if (empty) empty.remove();
   const d = document.createElement('div'); d.className = 'ritem';
   const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
   const fname = `${esc(name)}.${ext}`;
   d.innerHTML = `<span class="ri-ico">🎬</span>
     <div class="ri-info"><div class="ri-name">${fname}</div>
     <div class="ri-meta">${(size/1024/1024).toFixed(2)} MB · ${new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</div></div>
     <div class="ri-acts"><a href="${url}" download="${fname}" class="ibt" title="Descargar">↓</a></div>`;
   list?.prepend(d);
}

// ── Screenshot ──────────────────────────────────────────────────────────────
async function takeScreenshot() {
  const vid = $('scrPrev');
  if (!screenStream || !vid?.videoWidth) {
    toast('Activa la captura de pantalla primero', 'err');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = vid.videoWidth;
  canvas.height = vid.videoHeight;
  canvas.getContext('2d').drawImage(vid, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  let label = $('recLabel')?.value.trim() || 'captura';
  if (cfg().timestamp) label += '_' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const projId = $('recProjSel')?.value;

  const fl = document.createElement('div');
  fl.style.cssText = 'position:absolute;inset:0;background:white;z-index:50;pointer-events:none;opacity:.85;transition:opacity .3s';
  $('prevBox')?.appendChild(fl);
  setTimeout(() => { fl.style.opacity = '0'; setTimeout(() => fl.remove(), 300); }, 80);

  if (projId && cfg().save) {
    const tk = token();
    try {
      const r = await fetch(`${apiBase()}/projects/${projId}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
        body: JSON.stringify({ dataUrl, label })
      });
      const d = await r.json();
      if (d && d.file) {
        toast('Captura guardada en R2', 'ok');
        if (typeof window.loadProjects === 'function') await window.loadProjects();
        return;
      }
    } catch (_) {}
  }
  autoDownload(dataUrl, `${label}.png`);
  toast('Captura descargada', 'ok');
}

// ── Cleanup on page leave (importante en mobile) ────────────────────────────
function cleanup() {
  exitWebcamPip();
  [screenStream, webcamStream, micStream].forEach(s => {
    if (s) s.getTracks().forEach(t => t.stop());
  });
  screenStream = webcamStream = micStream = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  stopCompositor();
  clearInterval(recInterval);
}
window.addEventListener('pagehide', cleanup);
window.addEventListener('beforeunload', cleanup);

// ── Expose globals (legacy onclick=) + módulo namespace ─────────────────────
Object.assign(window, {
  applyWcStyle, setWcPos,
  toggleScreen, toggleWebcam, toggleMic, toggleSysAudio,
  toggleRecording, stopRecording, finalizeRecording, takeScreenshot,
  addRecItem,
  autoDownload
});

window.BN = window.BN || {};
window.BN.recorder = {
  toggleScreen, toggleWebcam, toggleMic, toggleSysAudio,
  toggleRecording, stopRecording, takeScreenshot,
  applyWcStyle, setWcPos, addRecItem,
  enterWebcamPip, exitWebcamPip,
  getStreams: () => ({ screen: screenStream, webcam: webcamStream, mic: micStream })
};
