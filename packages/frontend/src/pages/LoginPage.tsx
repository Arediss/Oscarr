import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeaturesContext';
import { Mail, Eye, EyeOff } from 'lucide-react';
import api, { backdropUrl } from '@/lib/api';
import type { AuthProviderConfig } from '@/types';
import { getProviderButtonClass } from '@/providers/colors';
import { startPlexPinFlow, type PlexPinFlowHandle } from '@/providers/plex/pinFlow';

const HERO_POOL_SIZE = 10;

interface HeroBackdrop { backdrop_path: string | null; title?: string; name?: string; }

/** Validates a `?next=` query param. Returns the safe destination, or `null` if the value
 *  is missing, malformed, or points to a foreign origin (open-redirect protection).
 *
 *  Implementation: parse every input through `new URL(raw, window.location.origin)` and
 *  reject anything whose computed origin doesn't match. This catches the obvious foreign
 *  hosts AND the WHATWG-normalised tricks browsers do behind the scenes:
 *    - `//evil.com/…`     → URL parses to `http://evil.com/` → reject
 *    - `/\evil.com`       → backslashes normalise to `/`, parses to `http://evil.com/` → reject
 *    - `/\t//evil.com`    → tab/control-char tricks fall through the same way
 *    - `data:` / `javascript:` URIs → wrong origin → reject
 *  Relying on the URL parser instead of hand-rolled `startsWith` checks keeps us in lockstep
 *  with the browser's own resolution, so anything `window.location.assign` would interpret
 *  as foreign is what we reject. */
function resolveSafeNext(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, globalThis.location.origin);
    if (u.origin !== globalThis.location.origin) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { login, user } = useAuth();
  const { features } = useFeatures();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [providers, setProviders] = useState<AuthProviderConfig[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);
  const flowRef = useRef<PlexPinFlowHandle | null>(null);

  const [hero, setHero] = useState<HeroBackdrop | null>(null);

  useEffect(() => {
    api.get('/auth/providers').then(({ data }) => setProviders(data)).catch((err) => console.warn('[LoginPage] /auth/providers failed', err));
    return () => flowRef.current?.cancel();
  }, []);

  useEffect(() => {
    api.get<{ results?: HeroBackdrop[] }>('/tmdb/trending')
      .then(({ data }) => {
        const pool = (data?.results ?? []).filter((m) => m.backdrop_path).slice(0, HERO_POOL_SIZE);
        if (pool.length === 0) return;
        setHero(pool[Math.floor(Math.random() * pool.length)]);
      })
      .catch((err) => console.warn('[LoginPage] /tmdb/trending failed', err));
  }, []);

  // OAuth providers redirect back to `/login?error=<TOKEN>` on failure (see Discord callback).
  // Pick that up, translate, display — and strip the query param so a reload doesn't re-trigger.
  useEffect(() => {
    const raw = searchParams.get('error');
    if (!raw) return;
    const key = `login.errors.${raw}`;
    const translated = t(key);
    setError(translated === key ? raw : translated);
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t]);

  /** `?next=` post-login redirect — supports plug-and-play link flows (e.g. a Discord bot
   *  plugin's "Link your account" button bouncing through `/api/auth/discord/authorize?action=link`
   *  → 302 to /login?next=<that URL> → user logs in → we send them back to the original URL).
   *
   *  Same-origin guard: only relative paths (or full URLs matching window.location.origin)
   *  are honoured. Protocol-relative `//evil.com` and absolute foreign URLs are dropped to
   *  prevent open-redirect phishing.
   *
   *  We use `window.location.assign` instead of react-router `navigate` because `next` may
   *  point at a backend route (`/api/auth/discord/authorize`) that the SPA router can't
   *  resolve — a full browser navigation is the right thing here.
   */
  const redirectAfterLogin = () => {
    const dest = resolveSafeNext(searchParams.get('next'));
    if (dest) {
      globalThis.location.assign(dest);
    } else {
      navigate('/', { replace: true });
    }
  };

  useEffect(() => {
    if (user) redirectAfterLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const hasEmailProvider = providers.some((p) => p.id === 'email');
  const oauthProviders = providers.filter((p) => p.type === 'oauth');
  const credentialProviders = providers.filter((p) => p.type === 'credentials' && p.id !== 'email');
  const [activeCredProvider, setActiveCredProvider] = useState<string | null>(null);
  const [credUsername, setCredUsername] = useState('');
  const [credPassword, setCredPassword] = useState('');

  // The backend returns specific tokens (INVALID_CREDENTIALS, EXTERNAL_ACCOUNT, …) that need
  // to be translated before display. Plain English strings from other errors pass through.
  const translateAuthError = (rawError: string | undefined): string => {
    if (!rawError) return t('login.error');
    const key = `login.errors.${rawError}`;
    const translated = t(key);
    return translated === key ? rawError : translated;
  };

  const handleCredentialLogin = async (providerId: string) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/auth/${providerId}/login`, { username: credUsername, password: credPassword });
      await login('', data.user);
      redirectAfterLogin();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      await login('', data.user);
      redirectAfterLogin();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(t('register.password_mismatch'));
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', { email, password, displayName });
      await login('', data.user);
      redirectAfterLogin();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(translateAuthError(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (providerId: string) => {
    // Discord uses a full-page OAuth redirect (no popup + polling): the authorize endpoint
    // sends the browser to discord.com, which redirects back to /api/auth/discord/callback
    // where the backend sets the cookie and redirects home.
    if (providerId === 'discord') {
      globalThis.location.href = '/api/auth/discord/authorize';
      return;
    }
    if (providerId === 'plex') {
      setLoading(true);
      setError('');
      const authWindow = window.open('about:blank', 'PlexAuth', 'width=600,height=700');
      setPolling(true);
      flowRef.current?.cancel();
      flowRef.current = startPlexPinFlow({
        authWindow,
        pinEndpoint: '/auth/plex/pin',
        // Ask Plex to forward the auth tab back to /plex-return after sign-in — only the login
        // flow does this (the shared link flow must not, or it would hijack the session). #212
        pinPayload: { forward: true },
        // Login's /callback returns { user, token }, not { token }. The helper treats a non-null
        // return as "got a token" — we return the pinId encoded in the user object indirectly
        // by returning a sentinel string when `user` is set. Caller reads `lastResponse` below.
        checkEndpoint: '/auth/plex/callback',
        extractToken: (res) => {
          const user = (res as { user?: unknown })?.user;
          return user ? 'ok' : null;
        },
        onToken: async () => {
          // We need the actual user payload for `login()` — refetch /me after the cookie lands.
          try {
            const { data } = await api.get('/auth/me');
            login('', data);
            redirectAfterLogin();
          } catch {
            setError(t('login.error'));
          } finally {
            setLoading(false);
            setPolling(false);
          }
        },
        onError: () => {
          setLoading(false);
          setPolling(false);
          setError(t('login.expired'));
        },
      });
    }
  };


  return (
    <div className="min-h-dvh bg-ndp-bg flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0">
        {hero?.backdrop_path && (
          <img
            src={backdropUrl(hero.backdrop_path)}
            alt=""
            aria-hidden
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-ndp-bg/70 backdrop-blur-sm" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-ndp-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        <div className="card p-8 shadow-2xl shadow-black/50">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <h1 className="text-2xl font-bold text-ndp-text">{features.siteName}</h1>
            <p className="text-ndp-text-muted text-sm mt-1">
              {mode === 'register' ? t('register.title') : t('login.title')}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 p-3 bg-ndp-danger/10 border border-ndp-danger/20 rounded-xl text-ndp-danger text-sm text-center">
              {error}
            </div>
          )}

          {/* Register form */}
          {mode === 'register' && hasEmailProvider && (
            <form onSubmit={handleRegister} className="space-y-4">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('register.displayname')}
                required
                className="input w-full"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.email_placeholder')}
                required
                className="input w-full"
              />
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  required
                  minLength={8}
                  className="input w-full pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('common.hide') : t('common.show')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('register.password_confirm')}
                required
                minLength={8}
                className="input w-full"
              />
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Mail className="w-4 h-4" />}
                {t('register.submit')}
              </button>
              <p className="text-center text-sm text-ndp-text-dim">
                <button type="button" onClick={() => { setMode('login'); setError(''); }} className="text-ndp-accent hover:underline">
                  {t('login.login_link')}
                </button>
              </p>
            </form>
          )}

          {/* Login */}
          {mode === 'login' && (
            <>
              {/* Active credential form (Jellyfin/Emby) */}
              {activeCredProvider ? (() => {
                const provider = credentialProviders.find(p => p.id === activeCredProvider);
                if (!provider) return null;
                const buttonClass = getProviderButtonClass(provider.id);
                return (
                  <div className="space-y-4">
                    <form onSubmit={e => { e.preventDefault(); handleCredentialLogin(provider.id); }} className="space-y-4">
                      <input
                        type="text"
                        placeholder={t('login.username')}
                        value={credUsername}
                        onChange={e => setCredUsername(e.target.value)}
                        className="input w-full"
                        autoFocus
                      />
                      <input
                        type="password"
                        placeholder={t('login.password_placeholder')}
                        value={credPassword}
                        onChange={e => setCredPassword(e.target.value)}
                        className="input w-full"
                      />
                      <button
                        type="submit"
                        disabled={loading || !credUsername || !credPassword}
                        className={`w-full ${buttonClass} font-semibold py-3.5 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
                      >
                        {loading ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          t('login.credentials_button', { provider: provider.label })
                        )}
                      </button>
                    </form>
                    <button
                      onClick={() => { setActiveCredProvider(null); setError(''); }}
                      className="w-full text-sm text-ndp-text-dim hover:text-ndp-text-muted transition-colors"
                    >
                      {t('login.back_to_providers')}
                    </button>
                  </div>
                );
              })()

              /* Provider selection */
              : (
                <div className="space-y-3">
                  {/* Email login */}
                  {hasEmailProvider && (
                    <form onSubmit={handleEmailLogin} className="space-y-3 mb-3">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('login.email_placeholder')}
                        required
                        className="input w-full"
                      />
                      <div className="relative">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t('login.password_placeholder')}
                          required
                          className="input w-full pr-10"
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('common.hide') : t('common.show')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text">
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      <button type="submit" disabled={loading && !polling} className="btn-primary w-full flex items-center justify-center gap-2">
                        {loading && !polling ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Mail className="w-4 h-4" />}
                        {t('login.signin')}
                      </button>
                    </form>
                  )}

                  {/* Divider */}
                  {hasEmailProvider && (oauthProviders.length > 0 || credentialProviders.length > 0) && (
                    <div className="flex items-center gap-3 py-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="text-ndp-text-dim text-xs uppercase">{t('login.or')}</span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                  )}

                  {/* All external providers as buttons */}
                  {[...oauthProviders, ...credentialProviders].map((provider) => {
                    const buttonClass = getProviderButtonClass(provider.id);
                    const isOAuth = provider.type === 'oauth';
                    return (
                      <button
                        key={provider.id}
                        onClick={() => {
                          if (isOAuth) handleOAuthLogin(provider.id);
                          else { setActiveCredProvider(provider.id); setCredUsername(''); setCredPassword(''); setError(''); }
                        }}
                        disabled={loading}
                        className={`w-full flex items-center justify-center gap-3 ${buttonClass} font-semibold py-3.5 px-6 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {polling && provider.id === 'plex' ? (
                          <>
                            <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            {t('login.waiting')}
                          </>
                        ) : (
                          t('login.oauth_button', { provider: provider.label })
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Register link */}
              {hasEmailProvider && providers.find(p => p.id === 'email')?.allowSignup && (
                <p className="text-center text-sm text-ndp-text-dim mt-6">
                  <button onClick={() => { setMode('register'); setError(''); }} className="text-ndp-accent hover:underline">
                    {t('login.register_link')}
                  </button>
                </p>
              )}
            </>
          )}

          <p className="text-ndp-text-dim text-xs text-center mt-6">
            {t('login.disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
}
