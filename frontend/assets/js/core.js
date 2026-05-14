// core.js — shared utilities for Bitácora Noir
// Token storage (localStorage + sessionStorage fallback), toast(), apiFetch().
// Designed to coexist with existing inline functions: if a global toast/apiFetch
// is already defined when this module loads, we do NOT overwrite it — instead we
// expose ours under window.BN.* so callers can migrate progressively.

const TOKEN_KEY = 'aetheryon_token';

function safeStorage(kind) {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = '__bn_probe__';
    s.setItem(probe, '1'); s.removeItem(probe);
    return s;
  } catch (_) { return null; }
}

const localS = safeStorage('local');
const sessionS = safeStorage('session');

export function getToken() {
  // 1. URL param (used by ide12 deep-link)
  try {
    const urlToken = new URLSearchParams(window.location.search).get('token');
    if (urlToken) {
      setToken(urlToken);
      return urlToken;
    }
  } catch (_) {}
  if (localS) {
    const t = localS.getItem(TOKEN_KEY);
    if (t) return t;
  }
  if (sessionS) {
    const t = sessionS.getItem(TOKEN_KEY);
    if (t) return t;
  }
  return null;
}

export function setToken(t) {
  if (!t) return;
  if (localS) try { localS.setItem(TOKEN_KEY, t); } catch (_) {}
  if (sessionS) try { sessionS.setItem(TOKEN_KEY, t); } catch (_) {}
}

export function clearToken() {
  if (localS) try { localS.removeItem(TOKEN_KEY); } catch (_) {}
  if (sessionS) try { sessionS.removeItem(TOKEN_KEY); } catch (_) {}
}

// ── toast ────────────────────────────────────────────────────────────────────
export function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const prefix = ({ ok: '✓ ', err: '✕ ', info: '◈ ' }[type] || '');
  t.textContent = prefix + msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ── api fetch ────────────────────────────────────────────────────────────────
export function getApiBase() {
  // Respect the legacy config input if present (cfgApi); otherwise default to /api.
  const el = document.getElementById('cfgApi');
  return (el && el.value) || (window.API_URL || '/api');
}

export async function apiFetch(path, opts = {}) {
  const url = getApiBase() + path;
  const token = getToken();
  const isJsonBody = opts.body && typeof opts.body === 'string';
  try {
    const r = await fetch(url, {
      ...opts,
      headers: {
        ...(isJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {})
      }
    });
    if (r.status === 401) {
      clearToken();
      // Defer to legacy doLogout if present, else reload.
      if (typeof window.doLogout === 'function') window.doLogout();
      else location.reload();
      return null;
    }
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? await r.json() : await r.text();
  } catch (_) {
    return null;
  }
}

// ── expose under window.BN ──────────────────────────────────────────────────
window.BN = window.BN || {};
window.BN.core = { getToken, setToken, clearToken, toast, apiFetch, getApiBase };
