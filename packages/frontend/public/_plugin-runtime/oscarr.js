/**
 * Oscarr Plugin SDK
 * Lightweight helpers for plugin developers.
 * Import with: import { api, apiPost, apiPut, apiDelete, formatSize, formatDate, formatRelative, storageGet, storageSet, getLang, useLanguage, t } from '@oscarr/sdk';
 */

import { useEffect, useState } from 'react';

// ── API helpers ─────────────────────────────────────────────────────

/** GET request to an Oscarr API endpoint. Returns parsed JSON. */
export async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json();
}

/** POST request with JSON body. */
export async function apiPost(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** PUT request with JSON body. */
export async function apiPut(path, body) {
  return api(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETE request. */
export async function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}

// ── Formatting helpers ──────────────────────────────────────────────

/** Format bytes to human-readable string (e.g. 1.5 GB). */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

/** Format a date string to localized short date. */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString();
}

/** Format a date string to relative time (e.g. "2 hours ago"). */
export function formatRelative(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(dateStr);
}

// ── LocalStorage helpers (namespaced per plugin) ────────────────────

/** Get a value from localStorage, namespaced by plugin ID. */
export function storageGet(pluginId, key, fallback = null) {
  try {
    const raw = localStorage.getItem(`plugin-${pluginId}-${key}`);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Set a value in localStorage, namespaced by plugin ID. */
export function storageSet(pluginId, key, value) {
  try {
    localStorage.setItem(`plugin-${pluginId}-${key}`, JSON.stringify(value));
  } catch { /* quota exceeded or private mode */ }
}

// ── i18n helpers ────────────────────────────────────────────────────
//
// Plugins live in a separate import graph from the host app, so they can't
// share Oscarr's react-i18next instance. Instead the core dispatches a
// `oscarr:lang-changed` CustomEvent every time the user switches language,
// and these helpers let plugin code read + react to it.
//
// Typical plugin pattern:
//
//   import { useLanguage, t } from '@oscarr/sdk';
//   const dict = { en: { greet: 'Hello {{name}}' }, fr: { greet: 'Bonjour {{name}}' } };
//   const lang = useLanguage();
//   <p>{t(dict, lang, 'greet', { name: 'Quentin' })}</p>
//

const LANG_EVENT = 'oscarr:lang-changed';

/** Read the current Oscarr language. Falls back to localStorage (i18next's own
 *  detection cache), then 'en'. Safe to call outside React. */
export function getLang() {
  if (typeof document !== 'undefined') {
    const fromHtml = document.documentElement.getAttribute('lang');
    if (fromHtml) return fromHtml;
  }
  try {
    const cached = localStorage.getItem('i18nextLng');
    if (cached) return cached;
  } catch { /* private mode or storage disabled */ }
  return 'en';
}

/** React hook that re-renders whenever the user changes language. Returns the
 *  current language code (e.g. 'en', 'fr'). */
export function useLanguage() {
  const [lang, setLang] = useState(getLang);
  useEffect(() => {
    const onChange = (e) => {
      const detail = typeof e?.detail === 'string' ? e.detail : null;
      setLang(detail ?? getLang());
    };
    window.addEventListener(LANG_EVENT, onChange);
    // Also catch a late event that may have fired before this component mounted.
    setLang(getLang());
    return () => window.removeEventListener(LANG_EVENT, onChange);
  }, []);
  return lang;
}

/** Resolve a translation. Falls back to English, then the key itself, so a
 *  missing string never crashes the plugin UI. `vars` interpolates {{name}}
 *  placeholders the same way i18next does. */
export function t(dict, lang, key, vars) {
  if (!dict) return key;
  // Try the exact lang, then its base (e.g. 'fr-CA' → 'fr'), then English.
  const base = typeof lang === 'string' ? lang.split('-')[0] : null;
  const bundle =
    (lang && dict[lang]) ||
    (base && dict[base]) ||
    dict.en ||
    {};
  let str = bundle[key];
  if (typeof str !== 'string') str = dict.en?.[key] ?? key;
  if (vars && typeof str === 'string') {
    for (const k of Object.keys(vars)) {
      str = str.split(`{{${k}}}`).join(String(vars[k]));
    }
  }
  return str;
}
