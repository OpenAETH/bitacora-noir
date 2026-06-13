// auth.js — login/logout de Bitácora Noir.
// Delega el storage del token a core.js (que ya hace fallback localStorage→sessionStorage).
// Expone funciones en window.* para compat con onclick="doLogin()" / onclick="doLogout()".

import { getToken, setToken, clearToken, apiFetch, getApiBase } from './core.js';

const $ = id => document.getElementById(id);

// ── Login ───────────────────────────────────────────────────────────────────
async function doLogin() {
  const pwEl = $('loginPw');
  const errEl = $('loginErr');
  const btn = $('loginBtn');
  const pw = pwEl?.value || '';
  if (!pw) { if (errEl) errEl.textContent = 'Ingresa la clave de acceso'; return; }
  if (btn) { btn.innerHTML = '<span class="login-spinner"></span>VERIFICANDO...'; btn.disabled = true; }
  if (errEl) errEl.textContent = '';
  try {
    const r = await fetch(getApiBase() + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (r.ok) {
      const d = await r.json();
      setToken(d.token);
      $('loginScreen')?.classList.add('hidden');
      if (typeof window.initApp === 'function') await window.initApp();
    } else {
      if (errEl) errEl.textContent = '✕ CLAVE INCORRECTA — Acceso denegado';
      if (pwEl) { pwEl.value = ''; pwEl.focus(); }
    }
  } catch (_) {
    if (errEl) errEl.textContent = '✕ Error de conexión con el servidor';
  }
  if (btn) { btn.innerHTML = '⊳ INGRESAR AL SISTEMA'; btn.disabled = false; }
}

// ── Logout ──────────────────────────────────────────────────────────────────
function doLogout() {
  if (!confirm('¿Cerrar sesión?')) return;
  clearToken();
  location.reload();
}

// ── Verificación de sesión al boot ──────────────────────────────────────────
async function verifyStoredToken() {
  const tk = getToken();
  if (!tk) return false;
  try {
    const r = await fetch(getApiBase() + '/auth/verify', {
      headers: { Authorization: `Bearer ${tk}` }
    });
    if (r.ok) return true;
  } catch (_) {}
  clearToken();
  return false;
}

// ── Enter en password = submit ──────────────────────────────────────────────
function wireLoginForm() {
  const pwEl = $('loginPw');
  if (!pwEl) return;
  pwEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireLoginForm, { once: true });
} else {
  wireLoginForm();
}

// ── Expose globals (legacy compat) ──────────────────────────────────────────
Object.assign(window, { doLogin, doLogout, getToken, setToken, clearToken });

window.BN = window.BN || {};
window.BN.auth = { doLogin, doLogout, verifyStoredToken, getToken, setToken, clearToken };
