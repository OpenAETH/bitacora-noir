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
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
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
    // En mobile pedimos mayor resolución y facingMode user (selfie por default).
    const constraints = isTouchDevice
      ? { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
      : { video: { width: 320, height: 240 }, audio: false };
    webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
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
  const tracks = [];
  if (screenStream) screenStream.getTracks().forEach(t => tracks.push(t));
  if (webcamStream) webcamStream.getVideoTracks().forEach(t => tracks.push(t));
  if (micStream && cfg().audio) micStream.getAudioTracks().forEach(t => tracks.push(t));
  const combined = new MediaStream(tracks);

  let mimeType = 'video/webm';
  const c = cfg().codec;
  if (c === 'vp9' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
  else if (c === 'h264' && MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';
  else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mimeType = 'video/webm;codecs=vp9';
  else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';  // iOS Safari

  try {
    mediaRecorder = new MediaRecorder(combined, { mimeType });
  } catch (e) {
    toast('Codec no soportado: ' + mimeType, 'err');
    return;
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
  if (typeof window.addRecItem === 'function') window.addRecItem(label, blob.size, url);
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
function addRecItem(name, size, url) {
   const list = $('recList');
   const empty = list?.querySelector('.empty-txt'); if (empty) empty.remove();
   const d = document.createElement('div'); d.className = 'ritem';
   const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
   d.innerHTML = `<span class="ri-ico">🎬</span>
     <div class="ri-info"><div class="ri-name">${esc(name)}.webm</div>
     <div class="ri-meta">${(size/1024/1024).toFixed(2)} MB · ${new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</div></div>
     <div class="ri-acts"><a href="${url}" download="${esc(name)}.webm" class="ibt" title="Descargar">↓</a></div>`;
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
