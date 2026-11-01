import axios from 'axios';
import i18n from '@/i18n';
import { expireAuthSession, getAuthSessionVersion } from './authSession';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});
const requestSessions = new WeakMap<object, number>();

// In-memory setup secret. Held only in the JS heap for the lifetime of the install wizard;
// never written to sessionStorage / localStorage so a tab snoop or stale tab can't read it.
// A page refresh during install loses it (acceptable — re-enter on the gate screen).
let setupSecret: string | null = null;
export function setSetupSecret(value: string | null): void { setupSecret = value; }

// Add language header (auth is via httpOnly cookie, no Bearer token needed)
api.interceptors.request.use((config) => {
  requestSessions.set(config, getAuthSessionVersion());
  config.headers['Accept-Language'] = i18n.language;
  // CSRF gate — paired with the backend X-Requested-With check.
  config.headers['X-Requested-With'] = 'oscarr';
  // "View as role" simulation for admin testing
  const viewAsRole = sessionStorage.getItem('view-as-role');
  if (viewAsRole) {
    config.headers['X-View-As-Role'] = viewAsRole;
  }
  // Attach setup secret for install routes — read from the module-local var, not storage.
  if (config.url?.startsWith('/setup/') || config.url === '/setup') {
    if (setupSecret) {
      config.headers['X-Setup-Secret'] = setupSecret;
    }
  }
  return config;
});

// Lightweight toast for global error feedback (no React dependency)
function showErrorToast(message: string) {
  const existing = document.getElementById('api-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'api-error-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed', bottom: '24px', right: '24px', zIndex: '9999',
    padding: '12px 20px', borderRadius: '12px', fontSize: '14px', fontWeight: '500',
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
    color: '#ef4444', backdropFilter: 'blur(8px)', transition: 'opacity 0.3s',
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
}

// Global NSFW detection — any API response with nsfwTmdbIds automatically updates the filter
let _addNsfwIds: ((ids: number[]) => void) | null = null;
export function registerNsfwHandler(handler: (ids: number[]) => void) { _addNsfwIds = handler; }

api.interceptors.response.use(
  (response) => {
    const ids = response.data?.nsfwTmdbIds;
    if (Array.isArray(ids) && ids.length > 0 && _addNsfwIds) {
      _addNsfwIds(ids);
    }
    return response;
  },
  (error) => {
    // Only the backend's session errors invalidate auth. Wrong login/backup passwords,
    // permission denials and service failures must keep their normal local error handling.
    const status = error.response?.status;
    const code = error.response?.data?.error;
    const version = error.config && requestSessions.get(error.config);
    if (version !== undefined && ((status === 401 && code === 'UNAUTHORIZED')
      || (status === 403 && code === 'ACCOUNT_DISABLED'))) {
      expireAuthSession(version);
    }
    if (error.response?.status === 403) {
      const translated = i18n.t('common.forbidden', 'Access denied');
      showErrorToast(translated);
      if (error.response.data?.error === 'FORBIDDEN' || error.response.data?.error === 'Forbidden') {
        error.response.data.error = translated;
      }
    }
    return Promise.reject(error);
  }
);


export default api;

// TMDB image helpers
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function posterUrl(path: string | null, size = 'w500'): string {
  if (!path) return '';
  if (path.startsWith('http')) return path; // Full URL (TVDB etc.)
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function backdropUrl(path: string | null, size = 'original'): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}
