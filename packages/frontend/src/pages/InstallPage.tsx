import { useState, useEffect, useRef } from 'react';
import { startPlexPinFlow, type PlexPinFlowHandle } from '@/providers/plex/pinFlow';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Film, Loader2, CheckCircle, RefreshCw, PartyPopper, Plus, Trash2, XCircle, Eye, EyeOff, Mail, Pencil } from 'lucide-react';
import api, { setSetupSecret as setApiSetupSecret } from '@/lib/api';
import { useServiceSchemas } from '@/hooks/useServiceSchemas';
import { extractApiError } from '@/utils/toast';
import { ImportFlow } from './admin/ImportFlow';

interface WizardService {
  id: string;
  type: string;
  name: string;
  config: Record<string, string>;
  testStatus: 'idle' | 'testing' | 'ok' | 'error';
  testError?: string;
  saved: boolean;
}

const TOTAL_STEPS = 6; // 0-5

export default function InstallPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [setupSecret, setSetupSecret] = useState('');
  const [secretValid, setSecretValid] = useState(false);
  // The wizard can be resumed after it crashed between steps 1 and 4. If an admin is already
  // on record we swap the register form for a login form — user re-authenticates, cookie gets
  // set, wizard resumes at step 2.
  const [adminExists, setAdminExists] = useState(false);
  const { schemas: SERVICE_SCHEMAS } = useServiceSchemas('/setup/service-schemas', secretValid);
  const [secretShake, setSecretShake] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [countdown, setCountdown] = useState(5);

  // Step 1: Admin account
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 2: Services (unified)
  const [services, setServices] = useState<WizardService[]>([
    { id: '1', type: 'radarr', name: 'Radarr', config: { url: '', apiKey: '' }, testStatus: 'idle', saved: false },
  ]);

  // Plex OAuth helpers
  const [plexPolling, setPlexPolling] = useState<string | null>(null); // service id being polled

  // Step 3: Sync
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [syncResult, setSyncResult] = useState<{ radarr?: { added: number }; sonarr?: { added: number } } | null>(null);

  useEffect(() => {
    api.get('/setup/install-status')
      .then(({ data }) => {
        if (data.installed) navigate('/login', { replace: true });
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [navigate]);

  useEffect(() => () => flowRef.current?.cancel(), []);

  // ─── Step 1: Admin account ──────────────────────────────────────────

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    if (adminPassword !== adminConfirmPassword) {
      setError(t('register.password_mismatch'));
      setSaving(false);
      return;
    }
    try {
      const { data } = await api.post('/auth/register', {
        email: adminEmail, password: adminPassword, displayName: adminDisplayName,
      });
      await login('', data.user);
      // Pre-seed instanceLanguages from the browser's detected locale so the first TMDB sync
      // pulls metadata in the admin's language straight away instead of downloading English
      // and re-pulling later. Skipped for 'en' (schema default) and silently best-effort —
      // if the PUT fails the admin can still adjust it in Instance settings.
      const detectedLang = i18n.language.split('-')[0];
      if (detectedLang && detectedLang !== 'en') {
        api.put('/admin/settings', { instanceLanguages: [detectedLang] }).catch(() => {});
      }
      setStep(2);
    } catch (err: unknown) {
      setError(extractApiError(err, t('login.error')));
    } finally { setSaving(false); }
  };

  const handleResumeAsAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { email: adminEmail, password: adminPassword });
      // Defense-in-depth: /verify-secret only returns adminExists=true when an admin row exists,
      // but nothing stops a non-admin with email creds from logging in here. The wizard needs
      // an admin session to mutate services, so refuse non-admin users and tell them to clear.
      if (data.user?.role !== 'admin') {
        setError(t('install.admin_required', 'This account is not an admin — the wizard needs an admin to continue.'));
        return;
      }
      await login('', data.user);
      setStep(2);
    } catch (err: unknown) {
      setError(extractApiError(err, t('login.error')));
    } finally { setSaving(false); }
  };

  // ─── Step 2: Services ──────────────────────────────────────────────

  const addService = () => {
    const existing = new Set(services.map(s => s.type));
    const nextType = !existing.has('sonarr') ? 'sonarr' : !existing.has('radarr') ? 'radarr' : 'sonarr';
    const schema = SERVICE_SCHEMAS[nextType];
    const emptyConfig: Record<string, string> = {};
    schema?.fields.forEach(f => { emptyConfig[f.key] = ''; });
    setServices(prev => [...prev, {
      id: String(Date.now()), type: nextType, name: schema?.label || nextType,
      config: emptyConfig, testStatus: 'idle', saved: false,
    }]);
  };

  const removeService = (id: string) => {
    setServices(prev => prev.filter(s => s.id !== id));
  };

  const updateService = (id: string, updates: Partial<WizardService>) => {
    setServices(prev => prev.map(s => {
      if (s.id !== id) return s;
      const updated = { ...s, ...updates };
      // Reset test status if config changed
      if (updates.config) updated.testStatus = 'idle';
      return updated;
    }));
  };

  const changeServiceType = (id: string, newType: string) => {
    const schema = SERVICE_SCHEMAS[newType];
    if (!schema) return;
    const emptyConfig: Record<string, string> = {};
    schema.fields.forEach(f => { emptyConfig[f.key] = ''; });
    updateService(id, { type: newType, name: schema.label, config: emptyConfig, testStatus: 'idle' });
  };

  const testService = async (id: string) => {
    const svc = services.find(s => s.id === id);
    if (!svc) return;
    updateService(id, { testStatus: 'testing', testError: undefined });
    try {
      await api.post('/setup/test-service', { type: svc.type, config: svc.config });
      setServices(prev => prev.map(s => s.id === id ? { ...s, testStatus: 'ok' as const, testError: undefined } : s));
    } catch (err) {
      // Backend returns { error: <code>, detail: <human message> } — show the detail so the
      // user can distinguish refused / timeout / bad API key / DNS without reading server logs.
      const resp = (err as { response?: { data?: { error?: string; detail?: string } } }).response?.data;
      const message = resp?.detail || resp?.error || (err as Error)?.message || 'Test failed';
      setServices(prev => prev.map(s => s.id === id ? { ...s, testStatus: 'error' as const, testError: message } : s));
    }
  };

  const autoDetectMachineId = async (serviceId: string, token: string) => {
    const svc = services.find(s => s.id === serviceId);
    if (!svc?.config.url) return;
    try {
      const { data } = await api.post<{ machineId: string }>('/setup/plex-identity', { url: svc.config.url, token });
      if (data.machineId) {
        setServices(prev => prev.map(s => s.id === serviceId
          ? { ...s, config: { ...s.config, machineId: data.machineId } }
          : s
        ));
      }
    } catch { /* ignore — user can still type it manually or retry via detect button */ }
  };

  const flowRef = useRef<PlexPinFlowHandle | null>(null);

  const startPlexOAuth = (serviceId: string) => {
    setPlexPolling(serviceId);
    setError('');
    const authWindow = window.open('about:blank', 'PlexAuth', 'width=600,height=700');
    flowRef.current?.cancel();
    flowRef.current = startPlexPinFlow({
      authWindow,
      pinEndpoint: '/auth/plex/pin',
      checkEndpoint: '/setup/plex-check',
      extractToken: (res) => (res as { token?: string })?.token ?? null,
      onToken: async (token) => {
        setPlexPolling(null);
        setServices(prev => prev.map(s => s.id === serviceId
          ? { ...s, config: { ...s.config, token }, testStatus: 'idle' as const }
          : s
        ));
        await autoDetectMachineId(serviceId, token);
      },
      onError: () => {
        setPlexPolling(null);
        setError(t('login.expired'));
      },
    });
  };

  const detectPlexMachineId = async (serviceId: string) => {
    const svc = services.find(s => s.id === serviceId);
    if (!svc?.config.url || !svc?.config.token) return;
    try {
      const { data } = await api.post<{ machineId: string }>('/setup/plex-identity', {
        url: svc.config.url, token: svc.config.token,
      });
      if (data.machineId) {
        setServices(prev => prev.map(s => s.id === serviceId
          ? { ...s, config: { ...s.config, machineId: data.machineId } }
          : s
        ));
      }
    } catch { /* ignore — manual retry possible */ }
  };

  const saveServices = async () => {
    setSaving(true);
    setError('');
    try {
      for (const svc of services) {
        if (svc.saved || svc.testStatus !== 'ok') continue;
        await api.post('/setup/service', { name: svc.name, type: svc.type, config: svc.config });
        setServices(prev => prev.map(s => s.id === svc.id ? { ...s, saved: true } : s));
      }
      setStep(3);
    } catch (err: unknown) {
      setError(extractApiError(err, t('common.error')));
    } finally { setSaving(false); }
  };

  const hasArrService = services.some(s => (s.type === 'radarr' || s.type === 'sonarr') && s.testStatus === 'ok');

  // ─── Step 3: Sync ──────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      // Backend returns { ok, result, restarting: true } then process.exit(0) 500ms later so
      // setup routes unmount. If the response races with the exit we may see a network error
      // despite the install succeeding — poll /install-status after, don't trust the throw.
      const { data } = await api.post('/setup/sync').catch(() => ({ data: null }));
      if (data?.result) setSyncResult(data.result);
      setSyncDone(true);
      setTimeout(() => setStep(4), 2000); // step 4 = optional Import (skippable)
    } catch (err: unknown) {
      setError(extractApiError(err, t('common.error')));
    } finally { setSyncing(false); }
  };

  useEffect(() => {
    if (step === 3 && !syncing && !syncDone) handleSync();
  }, [step]);

  useEffect(() => {
    if (step !== 5) return;
    if (countdown <= 0) {
      // Hard reload instead of SPA navigation: BackendGate cached installed:false at mount.
      // A full reload re-probes /setup/install-status (now reporting installed:true) and
      // remounts the app on the normal routes instead of looping back to /install.
      setApiSetupSecret(null);
      globalThis.location.href = '/';
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [step, countdown]);

  if (checking) {
    return (
      <div className="min-h-dvh bg-ndp-bg flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-ndp-accent/30 border-t-ndp-accent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-ndp-bg flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-ndp-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-lg mx-4">
        <div className="card p-8 shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-ndp-accent to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-ndp-accent/30 mb-4">
              <Film className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-ndp-text">{t('install.title')}</h1>
            <p className="text-ndp-text-muted text-sm mt-1 text-center">{t('install.subtitle')}</p>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {Array.from({ length: TOTAL_STEPS }, (_, s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  s <= step ? (step === TOTAL_STEPS - 1 ? 'bg-ndp-success w-8' : 'bg-ndp-accent w-8') : 'bg-white/10 w-4'
                }`}
              />
            ))}
          </div>

          {error && secretValid && (
            <div className="mb-6 p-3 bg-ndp-danger/10 border border-ndp-danger/20 rounded-xl text-ndp-danger text-sm text-center">
              {error}
            </div>
          )}

          {/* Setup Secret Gate */}
          {step === 0 && !secretValid && (
            <form className="space-y-4" onSubmit={async (e) => {
              e.preventDefault();
              if (!setupSecret) return;
              setApiSetupSecret(setupSecret);
              setError('');
              try {
                const { data } = await api.post('/setup/verify-secret');
                setAdminExists(Boolean(data?.adminExists));
                setSecretValid(true);
              } catch {
                setError(t('install.setup_secret_invalid', 'Invalid setup secret.'));
                setApiSetupSecret(null);
                setSecretShake(true);
              }
            }}>
              <div>
                <label htmlFor="install-setup-secret" className="text-sm text-ndp-text mb-1.5 block font-medium">{t('install.setup_secret', 'Setup Secret')}</label>
                <input
                  id="install-setup-secret"
                  type="password"
                  value={setupSecret}
                  onChange={(e) => { setSetupSecret(e.target.value); setError(''); }}
                  placeholder="SETUP_SECRET"
                  className={`input w-full ${secretShake ? 'animate-shake border-ndp-danger' : ''}`}
                  onAnimationEnd={() => setSecretShake(false)}
                  autoFocus
                />
                <p className="text-xs text-ndp-text-dim mt-1.5">
                  {t('install.setup_secret_help', 'Enter the SETUP_SECRET from your .env file to begin installation.')}
                </p>
              </div>
              {error && <div className="text-xs px-3 py-2 rounded-lg bg-ndp-danger/10 text-ndp-danger">{error}</div>}
              <button type="submit" disabled={!setupSecret} className="btn-primary flex items-center gap-2 text-sm w-full justify-center">
                {t('common.next')}
              </button>
            </form>
          )}

          {/* Step 0 after secret → go to step 1 */}
          {step === 0 && secretValid && (
            <div className="space-y-4">
              <p className="text-sm text-ndp-text-muted text-center">{t('install.admin_desc')}</p>
              <button onClick={() => setStep(1)} className="btn-primary text-sm w-full">{t('common.next')}</button>
            </div>
          )}

          {/* Step 1: Create admin account — or resume as existing admin when the wizard was
              interrupted after account creation (DB already has an admin row). */}
          {step === 1 && adminExists && (
            <form onSubmit={handleResumeAsAdmin} className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-ndp-text mb-1">{t('install.resume_title', 'Sign in to resume')}</h2>
                <p className="text-xs text-ndp-text-dim">{t('install.resume_desc', 'An admin account already exists. Sign in to continue the installation from where you left off.')}</p>
              </div>
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder={t('login.email_placeholder')} required className="input w-full" autoFocus />
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder={t('login.password_placeholder')} required className="input w-full pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('common.hide') : t('common.show')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {t('install.resume_login', 'Sign in and continue')}
              </button>
            </form>
          )}

          {step === 1 && !adminExists && (
            <form onSubmit={handleCreateAdmin} className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-ndp-text mb-1">{t('install.admin_title')}</h2>
                <p className="text-xs text-ndp-text-dim">{t('install.admin_desc')}</p>
              </div>
              <input type="text" value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} placeholder={t('register.displayname')} required className="input w-full" autoFocus />
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder={t('login.email_placeholder')} required className="input w-full" />
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder={t('login.password_placeholder')} required minLength={8} className="input w-full pr-10" />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? t('common.hide') : t('common.show')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input type="password" value={adminConfirmPassword} onChange={(e) => setAdminConfirmPassword(e.target.value)} placeholder={t('register.confirm_password')} required minLength={8} className="input w-full" />
              <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                {t('install.create_admin')}
              </button>
            </form>
          )}

          {/* Step 2: Services (all types, dynamic) */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-ndp-text mb-1">{t('install.arr_title')}</h2>
                <p className="text-xs text-ndp-text-dim">{t('install.arr_desc')}</p>
              </div>

              <div className="space-y-3">
                {services.map((svc) => {
                  const schema = SERVICE_SCHEMAS[svc.type];
                  const isCollapsed = svc.testStatus === 'ok';

                  return (
                    <div key={svc.id} className="bg-white/5 rounded-xl overflow-hidden transition-all duration-300">
                      {/* Collapsed view */}
                      <div className={`flex items-center gap-3 px-4 transition-all duration-300 ${isCollapsed ? 'py-3' : 'py-0 h-0 opacity-0 overflow-hidden'}`}>
                        <CheckCircle className="w-4 h-4 text-ndp-success flex-shrink-0" />
                        {schema && <img src={schema.icon} alt="" className="w-5 h-5" />}
                        <span className="text-sm font-medium text-ndp-text">{schema?.label || svc.type}</span>
                        <span className="text-xs text-ndp-text-dim truncate flex-1">{svc.config.url}</span>
                        <button onClick={() => updateService(svc.id, { testStatus: 'idle' })} className="text-ndp-text-dim hover:text-ndp-text transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {services.length > 1 && (
                          <button onClick={() => removeService(svc.id)} className="text-ndp-text-dim hover:text-ndp-danger transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Expanded form */}
                      <div className={`transition-all duration-300 ease-in-out ${isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[500px] opacity-100'}`}>
                        <div className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <select
                              value={svc.type}
                              onChange={(e) => changeServiceType(svc.id, e.target.value)}
                              className="input text-sm w-auto"
                            >
                              {Object.entries(SERVICE_SCHEMAS).map(([key, s]) => (
                                <option key={key} value={key}>{s.label}</option>
                              ))}
                            </select>
                            {services.length > 1 && (
                              <button onClick={() => removeService(svc.id)} className="text-ndp-text-dim hover:text-ndp-danger transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {schema?.fields.map((field) => (
                            <div key={field.key}>
                              {field.helper === 'plex-oauth' ? (
                                <div className="flex gap-2">
                                  <input
                                    type={field.type}
                                    value={svc.config[field.key] || ''}
                                    onChange={(e) => updateService(svc.id, { config: { ...svc.config, [field.key]: e.target.value } })}
                                    placeholder={t(field.labelKey)}
                                    className="input flex-1 text-sm"
                                  />
                                  <button
                                    onClick={() => startPlexOAuth(svc.id)}
                                    disabled={plexPolling === svc.id}
                                    className="btn-secondary text-xs flex items-center gap-1.5 px-3 whitespace-nowrap"
                                  >
                                    {plexPolling === svc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                                    {plexPolling === svc.id ? t('login.waiting') : 'OAuth'}
                                  </button>
                                </div>
                              ) : field.helper === 'plex-detect-machine-id' ? (
                                <div className="flex gap-2">
                                  <input
                                    type={field.type}
                                    value={svc.config[field.key] || ''}
                                    onChange={(e) => updateService(svc.id, { config: { ...svc.config, [field.key]: e.target.value } })}
                                    placeholder={t(field.labelKey)}
                                    className="input flex-1 text-sm"
                                  />
                                  <button
                                    onClick={() => detectPlexMachineId(svc.id)}
                                    disabled={!svc.config.url || !svc.config.token}
                                    className="btn-secondary text-sm flex items-center gap-1.5 px-3"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <input
                                  type={field.type}
                                  value={svc.config[field.key] || ''}
                                  onChange={(e) => updateService(svc.id, { config: { ...svc.config, [field.key]: e.target.value } })}
                                  placeholder={field.placeholder || t(field.labelKey)}
                                  className="input w-full text-sm"
                                />
                              )}
                            </div>
                          ))}

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => testService(svc.id)}
                              disabled={svc.testStatus === 'testing'}
                              className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                            >
                              {svc.testStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                              {t('common.test')}
                            </button>
                            {svc.testStatus === 'error' && (
                              <span className="flex items-center gap-1 text-xs text-ndp-danger"><XCircle className="w-3.5 h-3.5" /> {t('status.connection_failed')}</span>
                            )}
                          </div>
                          {svc.testStatus === 'error' && svc.testError && (
                            <p className="mt-2 text-xs text-ndp-danger/90 break-words">{svc.testError}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={addService} className="btn-secondary text-xs flex items-center gap-1.5 w-full justify-center">
                <Plus className="w-3.5 h-3.5" />
                {t('install.arr_add')}
              </button>

              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="btn-secondary text-sm flex-1">{t('common.back')}</button>
                <button onClick={saveServices} disabled={!hasArrService || saving} className="btn-primary flex items-center justify-center gap-2 text-sm flex-1">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t('common.next')}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Sync */}
          {step === 3 && (
            <div className="space-y-6 text-center">
              <div>
                <h2 className="text-lg font-bold text-ndp-text mb-1">{t('install.sync_title')}</h2>
                <p className="text-xs text-ndp-text-dim">{t('install.sync_desc')}</p>
              </div>
              {syncing && (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-ndp-accent/30 border-t-ndp-accent rounded-full animate-spin" />
                  <p className="text-sm text-ndp-text-muted">{t('install.sync_running')}</p>
                </div>
              )}
              {syncDone && syncResult && (
                <div className="space-y-2">
                  <div className="p-3 bg-ndp-success/10 border border-ndp-success/20 rounded-xl text-ndp-success text-sm flex items-center justify-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {t('install.sync_done')}
                  </div>
                  {syncResult.radarr && <p className="text-xs text-ndp-text-dim">Radarr: +{syncResult.radarr.added} {t('install.sync_added')}</p>}
                  {syncResult.sonarr && <p className="text-xs text-ndp-text-dim">Sonarr: +{syncResult.sonarr.added} {t('install.sync_added')}</p>}
                </div>
              )}
              {!syncing && !syncDone && (
                <button onClick={handleSync} className="btn-primary text-sm">{t('install.sync_retry')}</button>
              )}
            </div>
          )}

          {/* Step 4: Optional import from another tool */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-ndp-text">{t('install.import_title')}</h2>
                <p className="text-sm text-ndp-text-muted mt-1">{t('install.import_desc')}</p>
              </div>
              <ImportFlow onDone={() => setStep(5)} />
              <div className="flex justify-end pt-2 border-t border-white/5">
                <button onClick={() => setStep(5)} className="btn-secondary text-sm">
                  {t('install.skip_import')}
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Done */}
          {step === 5 && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="w-16 h-16 bg-ndp-success/10 rounded-full flex items-center justify-center">
                  <PartyPopper className="w-8 h-8 text-ndp-success" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-bold text-ndp-text">{t('install.done_title')}</h2>
                <p className="text-sm text-ndp-text-muted mt-2">{t('install.done_desc')}</p>
              </div>
              <p className="text-sm text-ndp-text-dim">{t('install.redirect', { seconds: countdown })}</p>
              <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-ndp-success rounded-full transition-all duration-1000 ease-linear" style={{ width: `${((5 - countdown) / 5) * 100}%` }} />
              </div>
              <button onClick={() => { setApiSetupSecret(null); navigate('/', { replace: true }); }} className="btn-primary text-sm">
                {t('install.go_now')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
