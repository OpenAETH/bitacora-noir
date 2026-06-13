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

// Compositor (sólo se arma cuando hay 2+ fuentes; ver buildVideoTrack/buildAudioTrack)
let canvasStream = null;     // MediaStream que produce el <canvas> compositor
let rafId = null;            // id del requestAnimationFrame del loop de dibujo
let audioCtx = null;         // AudioContext del mixer de audio
let compCanvas = null;       // <canvas> offscreen compositor

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
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: hd ? 60 : 30, max: 60 } },
      audio: true,
    });
    if (vid) { vid.srcObject = screenStream; vid.style.display = 'block'; }
    if (poff) poff.style.display = 'none';
    btn?.classList.add('on');
    $('prevBox')?.classList.add('active');
    screenStream.getVideoTracks()[0].onended = () => toggleScreen();
    toast('Captura de pantalla activa', 'info');
  } catch (e) {
    toast('Permiso denegado: pantalla', 'err');
  }
}

// ── Webcam ──────────────────────────────────────────────────────────────────
async function toggleWebcam() {
  const btn = $('btnWcm'), vid = $('wcamVid');
  if (webcamStream) {
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
  } catch (e) {
    toast('Permiso denegado: webcam', 'err');
  }
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

// ── Compositor (canvas video + audio mixer) ─────────────────────────────────
// Traduce el preset de posición (wcPos) a un rect proporcional sobre el canvas.
// Devuelve {x,y,w,h} en píxeles del canvas (W×H).
function pipRect(W, H) {
  const m = Math.round(W * 0.015) + 6;        // margen ~1.5% del ancho
  const land = { w: Math.round(W * 0.22), h: 0 };
  land.h = Math.round(land.w * 9 / 16);        // PiP apaisado 16:9
  const port = { w: Math.round(W * 0.12), h: 0 };
  port.h = Math.round(port.w * 16 / 9);        // PiP vertical 9:16
  const cx = Math.round((W - land.w) / 2);
  switch (wcPos) {
    case 'ct': return { x: 0, y: 0, w: W, h: H };                       // full
    case 'top': return { x: cx, y: m, w: land.w, h: land.h };
    case 'cb': return { x: cx, y: H - land.h - m, w: land.w, h: land.h };
    case 'tl': return { x: m, y: m, w: land.w, h: land.h };
    case 'tr': return { x: W - land.w - m, y: m, w: land.w, h: land.h };
    case 'bl': return { x: m, y: H - land.h - m, w: land.w, h: land.h };
    case 'vl': return { x: m, y: m, w: port.w, h: port.h };
    case 'vr': return { x: W - port.w - m, y: m, w: port.w, h: port.h };
    case 'br':
    default:  return { x: W - land.w - m, y: H - land.h - m, w: land.w, h: land.h };
  }
}

// Dibuja `vid` dentro de (dx,dy,dw,dh) con recorte tipo object-fit:cover.
function drawCover(ctx, vid, dx, dy, dw, dh) {
  const vw = vid.videoWidth, vh = vid.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale, sh = dh / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.drawImage(vid, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Devuelve el video track a grabar. null = sin video (solo audio).
// 1 fuente → track directo (sin canvas). 2 fuentes (pantalla+webcam) → canvas PiP.
function buildVideoTrack() {
  const hasScreen = !!screenStream, hasWebcam = !!webcamStream;
  if (!hasScreen && !hasWebcam) return null;
  if (hasScreen !== hasWebcam) {
    // exactamente una fuente de video
    const s = hasScreen ? screenStream : webcamStream;
    return s.getVideoTracks()[0] || null;
  }
  // dos fuentes → compositar pantalla (fondo) + webcam (PiP)
  const scr = $('scrPrev'), wcam = $('wcamVid');
  let W = scr?.videoWidth || 1280, H = scr?.videoHeight || 720;
  // Techo del canvas: HQ → 1920px, liviano → 1280px (mantiene aspecto).
  // Compositar a más de 1080p por canvas es muy pesado en CPU sin ganancia real.
  const capW = cfg().hq ? 1920 : 1280;
  if (W > capW) { H = Math.round(H * capW / W); W = capW; }
  compCanvas = document.createElement('canvas');
  compCanvas.width = W; compCanvas.height = H;
  const ctx = compCanvas.getContext('2d', { alpha: false });
  // CLAVE contra el "difuminado": por defecto el canvas escala con calidad 'low'.
  // Al dibujar la pantalla nativa → canvas (downscale) y la webcam → PiP, eso
  // lava los bordes. Forzamos interpolación de alta calidad.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const draw = () => {
    if (scr?.videoWidth) ctx.drawImage(scr, 0, 0, W, H);
    else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    if (wcam?.videoWidth) {
      const r = pipRect(W, H);
      drawCover(ctx, wcam, r.x, r.y, r.w, r.h);
      if (wcPos !== 'ct') {
        ctx.strokeStyle = '#00f5ff';
        ctx.lineWidth = Math.max(2, Math.round(W / 640));
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    rafId = requestAnimationFrame(draw);
  };
  draw();
  canvasStream = compCanvas.captureStream(cfg().hq ? 60 : 24);
  // ── DIAGNÓSTICO TEMPORAL: medir fidelidad real de la cadena ──
  const sset = scr && screenStream ? screenStream.getVideoTracks()[0]?.getSettings() : null;
  const wset = wcam && webcamStream ? webcamStream.getVideoTracks()[0]?.getSettings() : null;
  const cset = canvasStream.getVideoTracks()[0]?.getSettings();
  console.log('[REC diag] HQ=%s | pantalla track=%o (videoEl=%dx%d) | webcam track=%o | canvas=%dx%d | captureStream=%o',
    cfg().hq,
    sset ? `${sset.width}x${sset.height}@${sset.frameRate}` : 'n/a',
    scr?.videoWidth || 0, scr?.videoHeight || 0,
    wset ? `${wset.width}x${wset.height}@${wset.frameRate}` : 'n/a',
    W, H,
    cset ? `${cset.width}x${cset.height}@${cset.frameRate}` : 'n/a');
  // ── fin diagnóstico ──
  return canvasStream.getVideoTracks()[0] || null;
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

// Detiene el compositor y libera sus recursos (canvas loop + AudioContext).
function stopCompositor() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (canvasStream) { canvasStream.getTracks().forEach(t => t.stop()); canvasStream = null; }
  if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
  compCanvas = null;
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
  // Componer las fuentes: video (pantalla+webcam PiP o directo) + audio (mezcla o directo)
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
  getStreams: () => ({ screen: screenStream, webcam: webcamStream, mic: micStream })
};
