// ui.js — Bitácora Noir
// Sidebar mobile, tabs, modales, toggles varios. Coexiste con HTML legacy:
// expone funciones en window.* (los onclick="..." siguen funcionando) y bajo
// window.BN.ui.* para callers modernos.

import { isMobileViewport, isTouchDevice } from './platform.js';

const $ = id => document.getElementById(id);
const toast = (...a) => (window.BN?.core?.toast || window.toast)?.(...a);

// ── Sidebar (mobile drawer) ─────────────────────────────────────────────────
function toggleSidebar() {
  $('sidebar')?.classList.toggle('open');
  $('sidebarOverlay')?.classList.toggle('open');
}
function closeSidebar() {
  $('sidebar')?.classList.remove('open');
  $('sidebarOverlay')?.classList.remove('open');
}

// En mobile: cerrar el sidebar al cliquear cualquier item de nav
function wireSidebarAutoClose() {
  document.querySelectorAll('aside .ni, aside .nav-item').forEach(el => {
    el.addEventListener('click', () => {
      if (matchMedia('(max-width: 640px)').matches) closeSidebar();
    });
  });
}

// ── Tabs ────────────────────────────────────────────────────────────────────
function switchTab(name, navEl) {
  document.querySelectorAll('.tb').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const tb = $('tab-' + name);
  const pn = $('panel-' + name);
  if (tb) tb.classList.add('active');
  if (pn) pn.classList.add('active');
  if (navEl) navEl.classList.add('active');
  // Hooks legacy
  if (name === 'docs' && typeof window.loadDocs === 'function') window.loadDocs();
  if (name === 'proyectos' && typeof window.renderProjList === 'function') window.renderProjList();
  // Auto-cerrar drawer en mobile cuando se cambia de tab
  if (matchMedia('(max-width: 640px)').matches) closeSidebar();
}

function filterAndShow(type, el) {
  window.docTypeFilter = type;
  switchTab('docs', el);
  document.querySelectorAll('#docTypeTabs .fbt').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === type.slice(0, 3));
  });
}

// ── Modales ─────────────────────────────────────────────────────────────────
function openNewProj() { $('modalProj')?.classList.add('open'); }
function closeModal()  { $('modalProj')?.classList.remove('open'); }

function wireModalBackdrop() {
  const modal = $('modalProj');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target.id === 'modalProj') closeModal();
    });
  }
  // ESC cierra modales abiertos y el sidebar en mobile
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    closeSidebar();
  });
}

// ── Login: toggle password visibility ───────────────────────────────────────
function togglePwVis() {
  const inp = $('loginPw');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── AI panel ────────────────────────────────────────────────────────────────
let aiOpen = false;
function toggleAI() {
  aiOpen = !aiOpen;
  $('aiChat')?.classList.toggle('open', aiOpen);
}

// ── Abrir IDE: mobile usa misma pestaña ─────────────────────────────────────
function openInIDE(projId, f) {
  const token = (window.BN?.core?.getToken || window.getToken)?.() || '';
  const params = new URLSearchParams({
    proj: projId,
    file: f.path,
    name: f.name,
    ext:  f.ext || '',
    ...(token ? { token } : {})
  });
  const ideUrl = (window.IDE_URL || '/ide') + '/?' + params.toString();
  // En mobile/PWA: misma pestaña, así historial.back() trae al usuario de vuelta.
  // En desktop: nueva pestaña, como siempre.
  if (isMobileViewport || matchMedia('(max-width: 640px)').matches) {
    location.href = ideUrl;
  } else {
    window.open(ideUrl, '_blank');
  }
}

// ── Init wiring ─────────────────────────────────────────────────────────────
function init() {
  wireSidebarAutoClose();
  wireModalBackdrop();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

// ── Expose globals (legacy onclick=) ────────────────────────────────────────
Object.assign(window, {
  toggleSidebar, closeSidebar,
  switchTab, filterAndShow,
  openNewProj, closeModal,
  togglePwVis, toggleAI,
  // _openInIDE conservado por compatibilidad; el legacy lo llama con (projId, f)
  _openInIDE: openInIDE
});

window.BN = window.BN || {};
window.BN.ui = {
  toggleSidebar, closeSidebar,
  switchTab, filterAndShow,
  openNewProj, closeModal,
  togglePwVis, toggleAI,
  openInIDE
};
