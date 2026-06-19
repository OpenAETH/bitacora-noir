// projects.js — Bitácora Noir
// Project management, file handling, viewer, stats, boot logic.
// Expone funciones en window.* para compat con onclick="..."

import { apiFetch, getToken, setToken, clearToken, getApiBase, toast } from './core.js';

const $ = id => document.getElementById(id);

// ── STATE (on window for onclick compat with reassignment) ────────────────────
window.API_URL = '/api';
window.IDE_URL = '/ide';
window.projects = [];
window.activeProject = null;
window.allFiles = [];
window.docTypeFilter = 'all';
window.currentViewerFile = null;
window.cfg = { save: true, audio: true, hq: false, timestamp: true, dl: false, codec: 'auto' };

// ── CLOCK ────────────────────────────────────────────────────────────────────
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toTimeString().slice(0, 8);
}, 1000);

// ── SIDEBAR / TABS ───────────────────────────────────────────────────────────
// toggleSidebar, closeSidebar, switchTab, filterAndShow viven en ui.js

// ── OPEN CURRENT FILE IN IDE ─────────────────────────────────────────────────
function openCurrentInIDE() {
  if (!currentViewerFile) return;
  const { projId, f } = currentViewerFile;
  const editable = ['.py','.js','.ts','.jsx','.tsx','.html','.htm','.css','.scss',
    '.txt','.md','.json','.sh','.bash','.yaml','.yml','.xml','.log',
    '.csv','.go','.rs','.java','.c','.cpp','.rb','.php','.sql',
    '.toml','.ini','.cfg','.conf','.env','.gitignore'];
  if (!editable.includes((f.ext || '').toLowerCase())) {
    toast('Tipo de archivo no editable en IDE', 'info'); return;
  }
  window._openInIDE(projId, f);
}

// ── CHECK SERVER ──────────────────────────────────────────────────────────────
async function checkServer() {
  const info = document.getElementById('srvInfo');
  if (info) { info.textContent = 'Verificando...'; info.style.color = 'var(--td)'; }
  const d = await apiFetch('/health');
  if (d) {
    if (info) { info.textContent = `✓ ONLINE · ${d.projects_count} proyectos · v${d.version}`; info.style.color = 'var(--gr)'; }
    $('srvStatus').textContent = 'EN LÍNEA';
    $('srvStatus').style.color = 'var(--gr)';
  } else {
    if (info) { info.textContent = '✕ SIN CONEXIÓN'; info.style.color = 'var(--re)'; }
    $('srvStatus').textContent = 'OFFLINE';
    $('srvStatus').style.color = 'var(--re)';
  }
}

// ── PROJECTS ─────────────────────────────────────────────────────────────────
async function loadProjects() {
  const d = await apiFetch('/projects');
  if (d && d.projects) { window.projects = d.projects; }
  renderProjList();
  updateProjSelects();
  updateStats();
  loadRecentFiles();
}

async function createProject() {
  const name = $('np-name').value.trim();
  if (!name) { toast('El nombre es requerido', 'err'); return; }
  const body = {
    name,
    description: $('np-desc').value,
    category: $('np-cat').value,
    access_level: $('np-acc').value,
    tags: $('np-tags').value.split(',').map(t => t.trim()).filter(Boolean)
  };
  const d = await apiFetch('/projects', { method: 'POST', body: JSON.stringify(body) });
  if (d && d.project) {
    toast(`Proyecto "${name}" creado`, 'ok');
    closeModal();
    ['np-name','np-desc','np-tags'].forEach(id => $(id).value = '');
    await loadProjects();
    const fresh = window.projects.find(p => p.id === d.project.id) || d.project;
    selectProject(fresh);
    switchTab('proyectos', null);
  } else {
    toast('Error al crear proyecto', 'err');
  }
}

function selectProject(proj) {
  window.activeProject = proj;
  $('hdrProjName').textContent = proj.name;
  const rps = $('recProjSel');
  if (rps) rps.value = proj.id;
  renderProjList();
  renderProjDetail(proj);
  loadRecentFiles();
}

function clearActiveProject() {
  window.activeProject = null;
  $('hdrProjName').textContent = '— Sin proyecto —';
  const rps = $('recProjSel');
  if (rps) rps.value = '';
  renderProjList();
  loadRecentFiles();
}

// Cambio del selector "PROYECTO DESTINO" en el panel de grabación.
// Vacío → volver a "sin proyecto" (la grabación se descarga, no se sube).
// Con id → seleccionar ese proyecto como destino activo.
function onRecProjChange(pid) {
  if (!pid) { clearActiveProject(); return; }
  const proj = (window.projects || []).find(p => p.id === pid);
  if (proj) selectProject(proj);
}

function renderProjList() {
  const el = $('projList');
  $('nb-proj').textContent = window.projects.length;
  if (!window.projects.length) {
    el.innerHTML = '<div class="empty"><span class="empty-ico">⬡</span><div class="empty-txt">Sin proyectos creados</div></div>';
    return;
  }
  const colors = ['#00f5ff','#ff00a8','#ffd700','#00ff88','#bf8aff','#ff6622','#00c8ff'];
  el.innerHTML = window.projects.map((p, i) => `
    <div class="pi-item ${window.activeProject && window.activeProject.id === p.id ? 'active' : ''}"
      onclick="selectProject(window.projects.find(x=>x.id==='${p.id}'));renderProjList()">
      <div class="pi-dot" style="background:${colors[i % colors.length]};color:${colors[i % colors.length]}"></div>
      <div class="pi-info">
        <div class="pi-name">${escH(p.name)}</div>
        <div class="pi-meta">${p.category || 'GENERAL'} · ${fmtDate(p.created)}</div>
      </div>
      <span class="pi-badge">${p.file_count || 0}</span>
    </div>`).join('');
}

async function renderProjDetail(proj) {
  $('projDetail').innerHTML = `
    <div class="ph-card">
      <div class="ph-title">${escH(proj.name)}</div>
      <div class="ph-desc">${escH(proj.description || 'Sin descripción.')}</div>
      <div class="ph-mrow">
        <div class="pm-item"><div class="pm-lbl">CATEGORÍA</div><div class="pm-val">${proj.category || '—'}</div></div>
        <div class="pm-item"><div class="pm-lbl">ACCESO</div><div class="pm-val">${proj.access_level || '—'}</div></div>
        <div class="pm-item"><div class="pm-lbl">CREADO</div><div class="pm-val">${fmtDate(proj.created)}</div></div>
        <div class="pm-item"><div class="pm-lbl">ACTUALIZADO</div><div class="pm-val">${fmtDate(proj.updated)}</div></div>
        <div class="pm-item"><div class="pm-lbl">ARCHIVOS</div><div class="pm-val">${proj.file_count || 0}</div></div>
        <div class="pm-item"><div class="pm-lbl">TAMAÑO</div><div class="pm-val">${proj.total_size || '—'}</div></div>
      </div>
      ${proj.tags && proj.tags.length ? `<div style="display:flex;gap:4px;margin-top:10px;flex-wrap:wrap">${proj.tags.map(t => `<span class="tag">${escH(t)}</span>`).join('')}</div>` : ''}
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn btn-r btn-sm" onclick="deleteProject('${proj.id}')">✕ ELIMINAR</button>
      </div>
    </div>
    <div class="fb">
      <div class="fbtabs" id="fb-tabs-${proj.id}">
        <div class="fbt active" onclick="loadProjFilesTab('${proj.id}','all',this)">TODOS</div>
        <div class="fbt" onclick="loadProjFilesTab('${proj.id}','video',this)">VIDEO</div>
        <div class="fbt" onclick="loadProjFilesTab('${proj.id}','image',this)">IMÁGENES</div>
        <div class="fbt" onclick="loadProjFilesTab('${proj.id}','audio',this)">AUDIO</div>
        <div class="fbt" onclick="loadProjFilesTab('${proj.id}','document',this)">DOCS</div>
      </div>
      <div class="fb-body"><div class="file-list" id="fb-list-${proj.id}"></div></div>
    </div>`;
  await loadProjFilesTab(proj.id, 'all');
}

async function loadProjFilesTab(projId, type, tabEl = null) {
  if (tabEl) {
    tabEl.closest('.fbtabs').querySelectorAll('.fbt').forEach(t => t.classList.remove('active'));
    tabEl.classList.add('active');
  }
  const q = type === 'all' ? '' : `?type=${type}`;
  const d = await apiFetch(`/projects/${projId}/files${q}`);
  const list = $(`fb-list-${projId}`);
  if (!list) return;
  const files = (d && d.files) || [];
  if (!files.length) { list.innerHTML = '<div class="empty-txt" style="padding:16px;text-align:center">Sin archivos</div>'; return; }
  const _edExt = ['.py','.js','.ts','.html','.css','.txt','.md','.json','.sh','.yaml','.yml','.xml','.log','.csv'];
  list.innerHTML = files.map(f => `
    <div class="fitem" onclick="openViewer('${projId}',${JSON.stringify(f).replace(/"/g,'&quot;')})">
      <span class="fi-ico">${fileIcon(f.type, f.ext)}</span>
      <span class="fi-name">${escH(f.name)}</span>
      <span class="fi-size">${f.size_human}</span>
      <span class="fi-date">${fmtDate(f.created,'short')}</span>
      <button class="fi-dl" onclick="event.stopPropagation();downloadFile('${projId}','${f.path}')" title="Descargar">↓</button>
      ${_edExt.includes((f.ext||'').toLowerCase()) ? `<button class="fi-dl" style="color:var(--c)" onclick="event.stopPropagation();openFileInIDEByInfo('${projId}',${JSON.stringify(f).replace(/"/g,'&quot;')})" title="Abrir en IDE">⌨</button>` : ''}
      <button class="fi-dl" style="color:var(--re)" onclick="event.stopPropagation();deleteFileFromProject('${projId}','${f.path}')" title="Eliminar">✕</button>
    </div>`).join('');
}

async function deleteProject(pid) {
  if (!confirm('¿Eliminar este proyecto y todos sus archivos? Esta acción no se puede deshacer.')) return;
  const d = await apiFetch(`/projects/${pid}`, { method: 'DELETE' });
  if (d) {
    toast('Proyecto eliminado', 'ok');
    if (window.activeProject && window.activeProject.id === pid) clearActiveProject();
    await loadProjects();
    $('projDetail').innerHTML = '<div class="empty" style="margin:auto"><span class="empty-ico" style="font-size:48px">⬡</span><div class="empty-txt">Selecciona un proyecto</div></div>';
  }
}

async function deleteFileFromProject(projId, filepath) {
  if (!confirm(`¿Eliminar "${filepath}"?`)) return;
  const d = await apiFetch(`/projects/${projId}/files/${filepath}`, { method: 'DELETE' });
  if (d) {
    toast('Archivo eliminado', 'ok');
    await loadProjFilesTab(projId, 'all');
    await loadProjects();
  }
}

function downloadFile(projId, filepath) {
  const tk = getToken();
  const url = `${getApiBase()}/projects/${projId}/files/${filepath}`;
  fetch(url, { headers: tk ? { 'Authorization': `Bearer ${tk}` } : {} })
    .then(r => r.blob()).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filepath.split('/').pop();
      a.click();
    });
}

async function uploadFile(file, projId) {
  if (!projId) { toast('Selecciona un proyecto primero', 'err'); return; }
  const tk = getToken();
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await fetch(`${getApiBase()}/projects/${projId}/upload`, {
      method: 'POST', body: fd,
      headers: tk ? { 'Authorization': `Bearer ${tk}` } : {}
    });
    const d = await r.json();
    if (d.file) { toast(`"${file.name}" subido`, 'ok'); await loadProjects(); return d.file; }
  } catch (e) { toast(`Error: ${file.name}`, 'err'); }
}

function handleDrop(e) {
  e.preventDefault();
  $('upzone').classList.remove('drag');
  if (!window.activeProject) { toast('Selecciona un proyecto primero', 'err'); return; }
  [...e.dataTransfer.files].forEach(f => uploadFile(f, window.activeProject.id));
}

function handleFileInput(inp) {
  if (!window.activeProject) { toast('Selecciona un proyecto primero', 'err'); return; }
  [...inp.files].forEach(f => uploadFile(f, window.activeProject.id));
  inp.value = '';
}

// ── STATS / BADGES ────────────────────────────────────────────────────────────
async function updateStats() {
  let totalV = 0, totalI = 0, totalA = 0, totalD = 0, totalAll = 0;
  const results = await Promise.all(
    window.projects.map(async p => {
      const d = await apiFetch(`/projects/${p.id}/files`);
      return d ? (d.files || []) : [];
    })
  );
  for (const files of results) {
    totalV += files.filter(f => f.type === 'video').length;
    totalI += files.filter(f => f.type === 'image').length;
    totalA += files.filter(f => f.type === 'audio').length;
    totalD += files.filter(f => f.type === 'document').length;
    totalAll += files.length;
  }
  setEl('st-proj', window.projects.length); setEl('std-proj', `${window.projects.length} proyectos activos`);
  setEl('st-vid', totalV);          setEl('std-vid', totalV ? `${totalV} grabaciones` : '—');
  setEl('st-img', totalI);          setEl('std-img', totalI ? `${totalI} capturas` : '—');
  setEl('st-all', totalAll);        setEl('std-all', totalAll ? `${totalAll} archivos total` : '—');
  setEl('nb-vid', totalV); setEl('nb-img', totalI); setEl('nb-aud', totalA);
setEl('nb-doc', totalD); setEl('nb-all', totalAll); setEl('nb-docs', totalAll);
}

// ── RECENT FILES (project-scoped when project active) ───────────────────────
async function loadRecentFiles() {
  const grid = $('recentGrid');
  const badge = $('recentScopeBadge');
  const titleEl = $('recentTitle');
  let files = [];

  if (window.activeProject) {
    const d = await apiFetch(`/projects/${window.activeProject.id}/files`);
    if (d && d.files) files = d.files.map(f => ({ ...f, pname: window.activeProject.name, pid: window.activeProject.id }));
    badge.style.display = 'inline-flex';
    badge.innerHTML = `<span>📁 ${escH(window.activeProject.name)}</span><button class="clr-btn" onclick="clearActiveProject()" title="Ver todos">✕</button>`;
    if (titleEl) titleEl.textContent = 'ARCHIVOS DEL PROYECTO';
  } else {
    const fileGroups = await Promise.all(
      window.projects.slice(0, 8).map(async p => {
        const d = await apiFetch(`/projects/${p.id}/files`);
        return d && d.files ? d.files.map(f => ({ ...f, pname: p.name, pid: p.id })) : [];
      })
    );
    fileGroups.forEach(group => files.push(...group));
    badge.style.display = 'none';
    if (titleEl) titleEl.textContent = 'REGISTROS RECIENTES';
  }

  files.sort((a, b) => new Date(b.created) - new Date(a.created));
  if (!window.activeProject) files = files.slice(0, 12);

  if (!files.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="empty-ico">◈</span><div class="empty-txt">' +
      (window.activeProject ? 'Sin archivos en este proyecto. Sube alguno arriba.' : 'Crea un proyecto y sube archivos para comenzar') +
      '</div></div>';
    return;
  }
  grid.innerHTML = files.map(f => fileCard(f, f.pid, window.activeProject ? null : f.pname)).join('');
}

// ── DOCS PANEL ────────────────────────────────────────────────────────────────
async function loadDocs() {
  const tl = $('docTimeline');
  const projSel = $('docProjSel').value;
  tl.innerHTML = '<div class="empty"><span class="empty-ico" style="animation:spin 1s linear infinite;display:inline-block">◈</span><div class="empty-txt">Cargando...</div></div>';

let files = [];
  const projs = projSel ? window.projects.filter(p => p.id === projSel) : window.projects;
  const results = await Promise.all(
    projs.map(async p => {
      const d = await apiFetch(`/projects/${p.id}/files`);
      return d && d.files ? d.files.map(f => ({ ...f, pname: p.name, pid: p.id })) : [];
    })
  );
  results.forEach(group => files.push(...group));

  if (window.docTypeFilter === 'md') {
    files = files.filter(f => ['.md','.pdf','.json'].includes(f.ext));
  } else if (window.docTypeFilter !== 'all') {
    files = files.filter(f => f.type === window.docTypeFilter);
  }

  files.sort((a, b) => new Date(b.created) - new Date(a.created));

  if (!files.length) {
    tl.innerHTML = '<div class="empty"><span class="empty-ico">◎</span><div class="empty-txt">Sin archivos para mostrar</div></div>';
    return;
  }

  const groups = {};
  files.forEach(f => {
    const dk = new Date(f.created).toLocaleDateString('es', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    if (!groups[dk]) groups[dk] = [];
    groups[dk].push(f);
  });

  tl.innerHTML = Object.entries(groups).map(([date, fs]) => `
    <div class="tl-group">
      <div class="tl-hdr">
        <div class="tl-dot"></div>
        <div class="tl-date">${date.toUpperCase()}</div>
        <div class="tl-line"></div>
        <div class="tl-count">${fs.length} ARCHIVO(S)</div>
      </div>
      <div class="fgrid">${fs.map(f => fileCard(f, f.pid, f.pname)).join('')}</div>
    </div>`).join('');
}

function setDocType(type, el) {
  window.docTypeFilter = type;
  document.querySelectorAll('#docTypeTabs .fbt').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  loadDocs();
}

// ─── FILE CARDS ──────────────────────────────────────────────────────────────
function fileCard(f, projId, projName) {
  const ic = fileIcon(f.type, f.ext);
  const bc = badgeClass(f.type, f.ext);
  const bLabel = badgeLabel(f.type, f.ext);
  const isImg = f.type === 'image';
  const fileApiUrl = `${getApiBase()}/projects/${projId}/files/${f.path}`;
  return `
    <div class="fc" onclick="openViewerRaw('${projId}','${escH(JSON.stringify(f))}')">
      <div class="fc-thumb">
        ${isImg ? `<img src="${fileApiUrl}" onerror="this.style.display='none'" loading="lazy">` : ''}
        <span style="font-size:28px;opacity:.35;${isImg ? 'display:none' : ''}">${ic}</span>
        <div class="fc-overlay"></div>
        <div class="fc-badge ${bc}">${bLabel}</div>
      </div>
      <div class="fc-acts">
        <button class="ibt" onclick="event.stopPropagation();openViewerRaw('${projId}','${escH(JSON.stringify(f))}')" title="Ver">◈</button>
        <button class="ibt" onclick="event.stopPropagation();downloadFile('${projId}','${f.path}')" title="Descargar">↓</button>
      </div>
      <div class="fc-info">
        <div class="fc-name">${escH(f.name)}</div>
        <div class="fc-meta"><span>${f.size_human}</span><span>${fmtDate(f.created,'short')}</span></div>
        ${projName ? `<div class="fc-tags"><span class="tag">${escH(projName)}</span></div>` : ''}
      </div>
    </div>`;
}

// ─── FILE VIEWER ─────────────────────────────────────────────────────────────
function openViewerRaw(projId, fJson) {
  const f = JSON.parse(fJson);
  openViewer(projId, f);
}

function openViewer(projId, f) {
  window.currentViewerFile = { projId, f };
  const _edExt = ['.py','.js','.ts','.html','.css','.txt','.md','.json','.sh','.yaml','.yml','.xml','.log','.csv'];
  const ideBtn = $('viewerIdeBtn');
  if (ideBtn) ideBtn.style.display = _edExt.includes((f.ext || '').toLowerCase()) ? 'flex' : 'none';
  const tk = getToken();
  const fileApiUrl = `${getApiBase()}/projects/${projId}/files/${f.path}`;
  $('viewerTitle').textContent = f.name;
  $('viewerMeta').textContent = `${f.size_human} · ${fmtDate(f.created)}`;
  $('viewerBody').innerHTML = '';
  $('viewer').classList.add('open');

  const ext = (f.ext || '').toLowerCase();
  const body = $('viewerBody');
  const authHeaders = tk ? { 'Authorization': `Bearer ${tk}` } : {};

  if (f.type === 'image') {
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.blob()).then(blob => {
      body.innerHTML = `<div class="view-img"><img src="${URL.createObjectURL(blob)}" alt="${escH(f.name)}"></div>`;
    });
    return;
  }
  if (f.type === 'video') {
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.blob()).then(blob => {
      body.innerHTML = '<div class="view-video"></div>';
      const v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.src = URL.createObjectURL(blob);
      // Las grabaciones de MediaRecorder (WebM) no traen la duración en la
      // cabecera → duration === Infinity → el <video> habilita play pero no
      // arranca. Forzamos un seek al final para que el navegador reindexe el
      // archivo y recalcule la duración real, luego volvemos a 0.
      v.addEventListener('loadedmetadata', () => {
        if (v.duration === Infinity || isNaN(v.duration)) {
          const onSeek = () => {
            v.removeEventListener('timeupdate', onSeek);
            v.currentTime = 0;
          };
          v.addEventListener('timeupdate', onSeek);
          v.currentTime = 1e101;  // valor enorme → el navegador clampa al final real
        }
      }, { once: true });
      body.querySelector('.view-video').appendChild(v);
    });
    return;
  }
  if (f.type === 'audio') {
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.blob()).then(blob => {
      body.innerHTML = `<div class="view-audio">
        <span class="au-icon">🎙️</span>
        <div style="font-family:var(--font-hd);font-size:13px;color:var(--c);letter-spacing:.1em">${escH(f.name)}</div>
        <div class="au-player"><audio controls src="${URL.createObjectURL(blob)}"></audio></div>
      </div>`;
    });
    return;
  }
  if (ext === '.pdf') {
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.blob()).then(blob => {
      body.innerHTML = `<div class="view-pdf"><iframe src="${URL.createObjectURL(blob)}"></iframe></div>`;
    });
    return;
  }
  if (ext === '.md' || ext === '.markdown') {
    body.innerHTML = `<div class="view-md"><div class="md-content" id="mdContent">Cargando...</div></div>`;
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.text()).then(txt => {
      $('mdContent').innerHTML = marked.parse(txt);
    }).catch(() => { $('mdContent').textContent = 'Error al cargar.'; });
    return;
  }
  if (ext === '.json') {
    body.innerHTML = `<div class="view-json" id="jsonView">Cargando...</div>`;
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.text()).then(txt => {
      try {
        $('jsonView').innerHTML = syntaxHighlightJSON(JSON.stringify(JSON.parse(txt), null, 2));
      } catch (e) { $('jsonView').textContent = txt; }
    });
    return;
  }
  if (['.txt','.log','.csv','.xml','.html','.css','.js','.py','.sh','.yaml','.yml'].includes(ext)) {
    body.innerHTML = `<div class="view-text" id="txtView">Cargando...</div>`;
    fetch(fileApiUrl, { headers: authHeaders }).then(r => r.text()).then(txt => {
      $('txtView').textContent = txt;
    });
    return;
  }
  body.innerHTML = `<div class="view-none">
    <span class="ni-ico">${fileIcon(f.type, f.ext)}</span>
    <div class="ni-txt">${escH(f.name)}</div>
    <div class="ni-txt" style="opacity:.5;margin-top:4px">Sin visor para este formato</div>
    <button class="btn btn-p" onclick="downloadFile('${projId}','${f.path}')" style="margin-top:20px">↓ DESCARGAR ARCHIVO</button>
  </div>`;
}

function closeViewer() {
  $('viewer').classList.remove('open');
  $('viewerBody').innerHTML = '';
  window.currentViewerFile = null;
}

function downloadCurrent() {
  if (!window.currentViewerFile) return;
  downloadFile(window.currentViewerFile.projId, window.currentViewerFile.f.path);
}

function syntaxHighlightJSON(json) {
  return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
      let cls = 'json-num';
      if (/^"/.test(m)) { cls = /: $/.test(m) ? 'json-key' : 'json-str'; }
      else if (/true|false/.test(m)) cls = 'json-bool';
      else if (/null/.test(m)) cls = 'json-null';
      return `<span class="${cls}">${m}</span>`;
    });
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });

// ── CONFIG SYNC ──────────────────────────────────────────────────────────────
function syncConfig() {
  window.cfg.save = $('cfgSave')?.checked ?? window.cfg.save;
  window.cfg.audio = $('cfgAudio')?.checked ?? window.cfg.audio;
  window.cfg.hq = $('cfgHQ')?.checked ?? window.cfg.hq;
  window.cfg.timestamp = $('cfgTS')?.checked ?? window.cfg.timestamp;
  window.cfg.dl = $('cfgDL')?.checked ?? window.cfg.dl;
  window.cfg.codec = $('cfgCodec')?.value ?? window.cfg.codec;
  const map = [['cfgSave','optSave'],['cfgAudio','optAudio'],['cfgHQ','optHQ']];
  const caller = document.activeElement?.id || '';
  map.forEach(([cfgId, optId]) => {
    const cfgEl = $(cfgId), optEl = $(optId);
    if (!cfgEl || !optEl) return;
    if (caller.startsWith('cfg')) optEl.checked = cfgEl.checked;
    else if (caller.startsWith('opt')) cfgEl.checked = optEl.checked;
  });
}

// ─── PROJECT SELECTS ─────────────────────────────────────────────────────────
function updateProjSelects() {
  ['recProjSel','docProjSel'].forEach(id => {
    const el = $(id); if (!el) return;
    const cur = el.value;
    const defOpt = id === 'docProjSel'
      ? '<option value="">Todos los proyectos</option>'
      : '<option value="">— Sin proyecto (descargar) —</option>';
    el.innerHTML = defOpt + window.projects.map(p => `<option value="${p.id}">${escH(p.name)}</option>`).join('');
    if (cur) el.value = cur;
    if (window.activeProject) el.value = window.activeProject.id;
  });
}

// ─── AI PANEL ────────────────────────────────────────────────────────────────
function sendAI() {
  const inp = $('aiInp'), msgs = $('aiMsgs');
  const txt = inp.value.trim(); if (!txt) return;
  const um = document.createElement('div'); um.className = 'msg msg-us'; um.textContent = txt;
  msgs.appendChild(um); inp.value = ''; msgs.scrollTop = msgs.scrollHeight;
  setTimeout(() => {
    const am = document.createElement('div'); am.className = 'msg msg-ai';
    am.textContent = aiReply[Math.floor(Math.random() * aiReply.length)];
    msgs.appendChild(am); msgs.scrollTop = msgs.scrollHeight;
  }, 600);
}

const aiReply = [
  'He analizado los archivos del proyecto activo. ¿Necesitas un resumen ejecutivo?',
  'Detecté grabaciones sin etiquetar. ¿Quieres que las clasifique automáticamente?',
  'La transcripción de audio está disponible. Puedo procesarla si quieres.',
  'Encontré 3 documentos relacionados semánticamente en el proyecto.',
  'La captura fue guardada en R2. ¿Añado anotaciones automáticas con IA?',
  'El proyecto activo tiene alta actividad esta semana. ¿Genero un reporte?',
];

// ─── IDE ─────────────────────────────────────────────────────────────────────
function openFileInIDEByInfo(projId, fJson) {
  const f = typeof fJson === 'string' ? JSON.parse(fJson) : fJson;
  window._openInIDE(projId, f);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function escH(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setEl(id, v) { const e = $(id); if (e) e.textContent = v; }
function fmtDate(iso, mode = 'full') {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (mode === 'short') return d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fileIcon(type, ext) {
  const e = (ext || '').toLowerCase();
  if (type === 'video') return '🎬'; if (type === 'image') return '🖼️'; if (type === 'audio') return '🎙️';
  if (e === '.pdf') return '📕'; if (e === '.md' || e === '.markdown') return '📝'; if (e === '.json') return '{}';
  if (type === 'document') return '📄'; return '📦';
}
function badgeClass(type, ext) {
  const e = (ext || '').toLowerCase();
  if (type === 'video') return 'bv'; if (type === 'image') return 'bi'; if (type === 'audio') return 'ba';
  if (e === '.pdf' || e === '.md') return 'bd'; if (e === '.json') return 'bj'; return 'bt';
}
function badgeLabel(type, ext) {
  const e = (ext || '').toLowerCase();
  if (type === 'video') return 'VIDEO'; if (type === 'image') return 'IMG'; if (type === 'audio') return 'AUDIO';
  if (e === '.pdf') return 'PDF'; if (e === '.md') return 'MD'; if (e === '.json') return 'JSON';
  if (type === 'document') return 'DOC'; return ext || 'FILE';
}

// ─── BOOT ────────────────────────────────────────────────────────────────────
async function initApp() {
  const cfgApiEl = $('cfgApi');
  if (cfgApiEl) window.API_URL = cfgApiEl.value || '/api';
  await checkServer();
  await loadProjects();
  if (typeof window.applyWcStyle === 'function') window.applyWcStyle();
}

// Check existing token on load
(async function boot() {
  const tk = getToken();
  if (tk) {
    try {
      const r = await fetch(getApiBase() + '/auth/verify', {
        headers: { 'Authorization': `Bearer ${tk}` }
      });
      if (r.ok) {
        $('loginScreen').classList.add('hidden');
        await initApp();
        return;
      }
    } catch (_) {}
    clearToken();
  }
  const pwEl = $('loginPw');
  if (pwEl) pwEl.focus();
})();

// ── Expose globals (legacy onclick= compat) ──────────────────────────────────
Object.assign(window, {
  loadProjects, createProject, selectProject, clearActiveProject, onRecProjChange,
  renderProjList, renderProjDetail, loadProjFilesTab,
  deleteProject, deleteFileFromProject, downloadFile, uploadFile,
  handleDrop, handleFileInput, updateStats, loadRecentFiles,
  loadDocs, setDocType, fileCard, openViewerRaw, openViewer, closeViewer, downloadCurrent,
  openCurrentInIDE, openFileInIDEByInfo, updateProjSelects, syncConfig, sendAI,
  escH, setEl, fmtDate, fmtSize, fileIcon, badgeClass, badgeLabel, initApp, checkServer
});

window.BN = window.BN || {};
window.BN.projects = {
  loadProjects, createProject, selectProject, clearActiveProject,
  renderProjList, renderProjDetail, loadProjFilesTab,
  deleteProject, deleteFileFromProject, downloadFile, uploadFile,
  loadRecentFiles, loadDocs, setDocType, openViewer, closeViewer,
  updateStats, initApp, checkServer
};