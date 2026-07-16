import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { clsx } from 'clsx';
import {
  Loader2, CheckCircle, ArrowUpCircle, ExternalLink, Key, Copy, RefreshCw, Trash2, Eye, EyeOff, FileText, AlertTriangle,
} from 'lucide-react';
import ChangelogModal from '@/components/ChangelogModal';
import api from '@/lib/api';
import { showToast } from '@/utils/toast';
import { useFeatures } from '@/context/FeaturesContext';
import { useVersionInfo } from '@/hooks/useVersionInfo';
import { Spinner } from './Spinner';
import { AdminTabLayout } from './AdminTabLayout';
import { FloatingSaveBar } from '@/components/FloatingSaveBar';

// Only locales that actually ship a translation bundle (i18n/index.ts registers en + fr). Offering
// de/es/it/pt/nl silently fell back to English for the whole UI — re-add a code here only once its
// locales/<code>/translation.json exists and is registered.
const AVAILABLE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

/**
 * "Who is this Oscarr" — identity, public URL, maintenance banner, language, version, API key.
 * Lives in the System group. Split out of the old General tab so the feature flags and the site
 * identity aren't mixed together; each concern owns its own save flow.
 */
export function InstanceTab() {
  const { t } = useTranslation();
  const { refreshFeatures } = useFeatures();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [siteName, setSiteName] = useState('Oscarr');
  const [siteUrl, setSiteUrl] = useState('');
  const [instanceLanguage, setInstanceLanguage] = useState('en');
  const [bannerText, setBannerText] = useState('');
  const versionInfo = useVersionInfo();
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [apiKeyFull, setApiKeyFull] = useState<string | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [apiKeyHasKey, setApiKeyHasKey] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [verboseLog, setVerboseLog] = useState(false);
  const [verboseLogToggling, setVerboseLogToggling] = useState(false);

  const initialValues = useRef<Record<string, unknown>>({});

  // Settings + banner are the load-critical calls — if either fails we refuse to render the form
  // so the admin doesn't silently overwrite real config with `Oscarr` / empty defaults on save.
  // Version + api-key probes are best-effort (failing them just hides the card / update badge).
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [settingsRes, bannerRes] = await Promise.all([
        api.get('/admin/settings'),
        api.get('/app/banner'),
      ]);
      const vals = {
        siteName: settingsRes.data.siteName ?? 'Oscarr',
        siteUrl: settingsRes.data.siteUrl ?? '',
        instanceLanguage: settingsRes.data.instanceLanguages?.[0] ?? 'en',
        bannerText: bannerRes.data.banner || '',
      };
      setSiteName(vals.siteName);
      setSiteUrl(vals.siteUrl);
      setInstanceLanguage(vals.instanceLanguage);
      setBannerText(vals.bannerText);
      initialValues.current = vals;

      // Non-critical probes — let these fail silently, they just degrade the UI.
      api.get('/admin/api-key')
        .then(({ data }) => { setApiKeyHasKey(data.hasKey); setApiKeyMasked(data.maskedKey); })
        .catch(() => {});
      api.get('/admin/verbose-request-log')
        .then(({ data }) => setVerboseLog(!!data.enabled))
        .catch(() => {});
    } catch (err) {
      console.error('InstanceTab load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const currentValues = useMemo(
    () => ({ siteName, siteUrl, instanceLanguage, bannerText }),
    [siteName, siteUrl, instanceLanguage, bannerText]
  );

  const hasChanges = !loading && Object.keys(initialValues.current).length > 0 &&
    Object.entries(currentValues).some(([k, v]) => initialValues.current[k] !== v);

  const handleReset = () => {
    const iv = initialValues.current;
    setSiteName(iv.siteName as string);
    setSiteUrl(iv.siteUrl as string);
    setInstanceLanguage(iv.instanceLanguage as string);
    setBannerText(iv.bannerText as string);
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await Promise.all([
        api.put('/admin/settings', {
          siteName: siteName.trim() || 'Oscarr',
          siteUrl: siteUrl.trim() || '',
          instanceLanguages: [instanceLanguage],
        }),
        api.put('/admin/banner', { banner: bannerText.trim() || null }),
      ]);
      await refreshFeatures();
      initialValues.current = { ...currentValues };
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('InstanceTab save failed', err);
      setSaveError(t('admin.save_bar.save_failed'));
    } finally { setSaving(false); }
  };

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <AdminTabLayout>
        <div className="mt-6 card p-5 flex items-start gap-3 border-ndp-danger/20 bg-ndp-danger/5">
          <AlertTriangle className="w-5 h-5 text-ndp-danger flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm text-ndp-text">{t('admin.load.failed')}</p>
            <button onClick={loadAll} className="btn-secondary text-sm mt-3 inline-flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              {t('admin.load.retry')}
            </button>
          </div>
        </div>
      </AdminTabLayout>
    );
  }

  return (
    <AdminTabLayout>
      {versionInfo && (
        <div className="flex gap-3">
          <div className="card p-4 flex-[7] flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-ndp-text">{t('admin.instance.oscarr')}</span>
              <span className="text-xs text-ndp-text-dim font-mono ml-2">{versionInfo.current}</span>
            </div>
            {versionInfo.updateAvailable && versionInfo.latest ? (
              <a href={versionInfo.releaseUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-ndp-accent/10 text-ndp-accent rounded-lg text-xs font-medium hover:bg-ndp-accent/20 transition-colors">
                <ArrowUpCircle className="w-3.5 h-3.5" />
                {t('admin.instance.update_available', { version: versionInfo.latest })}
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : versionInfo.latest ? (
              <span className="flex items-center gap-1.5 text-xs text-ndp-success">
                <CheckCircle className="w-3.5 h-3.5" />
                {t('admin.instance.up_to_date')}
              </span>
            ) : (
              <span className="text-xs text-ndp-text-dim">{t('admin.instance.update_check_failed')}</span>
            )}
          </div>
          <button
            onClick={() => setChangelogOpen(true)}
            className="card px-4 py-3 flex items-center justify-center gap-1.5 text-xs font-medium text-ndp-text-dim hover:text-ndp-accent transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            {t('changelog.view')}
          </button>
        </div>
      )}

      <div className="space-y-3 mt-6">
        <div className="card p-4">
          <div className="mb-2">
            <span className="text-sm font-medium text-ndp-text">{t('admin.instance.site_name')}</span>
            <span className="text-xs text-ndp-text-dim ml-2">{t('admin.instance.site_name_desc')}</span>
          </div>
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Oscarr" className="input w-full text-sm" />
        </div>
        <div className="card p-4">
          <div className="mb-2">
            <span className="text-sm font-medium text-ndp-text">{t('admin.instance.site_url')}</span>
            <span className="text-xs text-ndp-text-dim ml-2">{t('admin.instance.site_url_desc')}</span>
          </div>
          <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://oscarr.example.com" className="input w-full text-sm" />
        </div>
        <div className="card p-4">
          <div className="mb-2">
            <span className="text-sm font-medium text-ndp-text">{t('admin.instance.instance_languages')}</span>
            <span className="text-xs text-ndp-text-dim ml-2">{t('admin.instance.instance_languages_desc')}</span>
          </div>
          <select value={instanceLanguage} onChange={(e) => setInstanceLanguage(e.target.value)} className="input text-sm w-full">
            {AVAILABLE_LANGUAGES.map(({ code, label }) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
        <div className="card p-4">
          <div className="mb-2">
            <span className="text-sm font-medium text-ndp-text">{t('admin.instance.maintenance_banner')}</span>
            <span className="text-xs text-ndp-text-dim ml-2">{t('admin.instance.maintenance_desc')}</span>
          </div>
          <input value={bannerText} onChange={(e) => setBannerText(e.target.value)} placeholder={t('admin.instance.maintenance_placeholder')} className="input w-full text-sm" />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ndp-text mb-2">{t('admin.debug.title')}</h2>
        <p className="text-xs text-ndp-text-dim mb-4">
          {t('admin.debug.help')}
        </p>
        <div className={clsx('card p-4', verboseLog && 'border border-amber-400/40 bg-amber-400/5')}>
          <div className="flex items-start gap-3">
            <button
              onClick={async () => {
                const next = !verboseLog;
                setVerboseLogToggling(true);
                try {
                  await api.put('/admin/verbose-request-log', { enabled: next });
                  setVerboseLog(next);
                } catch {
                  showToast(t('admin.debug.toggle_failed'), 'error');
                } finally {
                  setVerboseLogToggling(false);
                }
              }}
              disabled={verboseLogToggling}
              className="flex items-center gap-2.5 text-xs font-medium text-ndp-text-dim hover:text-ndp-text transition-colors disabled:opacity-70"
              aria-pressed={verboseLog}
            >
              <span className={clsx('relative w-9 h-5 rounded-full transition-colors', verboseLog ? 'bg-amber-400' : 'bg-white/10')}>
                <span className={clsx('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', verboseLog && 'translate-x-4')} />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ndp-text">{t('admin.debug.verbose_title')}</p>
              <p className="text-xs text-ndp-text-dim mt-0.5">
                <Trans i18nKey="admin.debug.verbose_desc">
                  Persists every <code className="text-ndp-text bg-black/30 px-1 rounded">/api/*</code> request to <strong>Logs</strong> with status, redirect target, IP and user-agent. Useful for tracing OAuth round-trips. Tokens and auth headers are scrubbed.
                </Trans>
              </p>
              {verboseLog && (
                <p className="text-xs text-amber-300 mt-2">
                  {t('admin.debug.verbose_warning')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ndp-text mb-2 flex items-center gap-2">
          <Key className="w-5 h-5" />
          {t('admin.instance.api_key')}
        </h2>
        <p className="text-xs text-ndp-text-dim mb-4">{t('admin.instance.api_key_desc')}</p>
        <div className="card p-4">
          {apiKeyHasKey ? (
            <div className="flex items-center gap-3">
              <code className="flex-1 text-xs font-mono bg-black/20 px-3 py-2 rounded-lg text-ndp-text truncate select-all">
                {apiKeyVisible && apiKeyFull ? apiKeyFull : apiKeyMasked}
              </code>
              <button
                onClick={async () => {
                  // First reveal needs to hit the server. Subsequent toggles work from the
                  // in-memory copy so admins can flip visibility without re-hitting the API.
                  if (!apiKeyFull) {
                    setApiKeyLoading(true);
                    try {
                      const { data } = await api.get('/admin/api-key/reveal');
                      setApiKeyFull(data.apiKey);
                      setApiKeyVisible(true);
                    } catch (err) {
                      console.error('Reveal API key failed', err);
                      showToast(t('admin.instance.api_key_reveal_failed'), 'error');
                    } finally { setApiKeyLoading(false); }
                  } else {
                    setApiKeyVisible(!apiKeyVisible);
                  }
                }}
                disabled={apiKeyLoading}
                className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
                aria-label={apiKeyVisible ? t('admin.instance.api_key_hide') : t('admin.instance.api_key_show')}
              >
                {apiKeyLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : apiKeyVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={async () => {
                  let key = apiKeyFull;
                  if (!key) {
                    try {
                      const { data } = await api.get('/admin/api-key/reveal');
                      key = data.apiKey;
                      setApiKeyFull(data.apiKey);
                    } catch (err) {
                      console.error('Reveal for copy failed', err);
                      showToast(t('admin.instance.api_key_reveal_failed'), 'error');
                      return;
                    }
                  }
                  try {
                    await navigator.clipboard.writeText(key!);
                    setApiKeyCopied(true);
                    setTimeout(() => setApiKeyCopied(false), 2000);
                  } catch (err) {
                    console.error('Clipboard write failed', err);
                    showToast(t('admin.instance.api_key_copy_failed'), 'error');
                  }
                }}
                className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                {apiKeyCopied ? <CheckCircle className="w-3.5 h-3.5 text-ndp-success" /> : <Copy className="w-3.5 h-3.5" />}
                {apiKeyCopied ? t('common.copied') : t('common.copy')}
              </button>
              <button
                onClick={async () => {
                  setApiKeyLoading(true);
                  try {
                    const { data } = await api.post('/admin/api-key/generate');
                    setApiKeyFull(data.apiKey);
                    setApiKeyMasked(`${data.apiKey.slice(0, 8)}${'•'.repeat(24)}${data.apiKey.slice(-8)}`);
                    setApiKeyHasKey(true);
                    setApiKeyVisible(true);
                  } catch (err) {
                    console.error('Regenerate API key failed', err);
                    showToast(t('admin.instance.api_key_regenerate_failed'), 'error');
                  } finally { setApiKeyLoading(false); }
                }}
                disabled={apiKeyLoading}
                className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', apiKeyLoading && 'animate-spin')} />
                {t('admin.instance.regenerate')}
              </button>
              <button
                onClick={async () => {
                  try {
                    await api.delete('/admin/api-key');
                    setApiKeyFull(null);
                    setApiKeyMasked(null);
                    setApiKeyHasKey(false);
                    setApiKeyVisible(false);
                  } catch (err) {
                    console.error('Revoke API key failed', err);
                    showToast(t('admin.instance.api_key_revoke_failed'), 'error');
                  }
                }}
                className="text-xs text-ndp-danger hover:text-ndp-danger/80 flex items-center gap-1.5 flex-shrink-0"
                aria-label={t('admin.instance.api_key_revoke')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <span className="text-sm text-ndp-text-dim">{t('admin.instance.no_api_key')}</span>
              <button
                onClick={async () => {
                  setApiKeyLoading(true);
                  try {
                    const { data } = await api.post('/admin/api-key/generate');
                    setApiKeyFull(data.apiKey);
                    setApiKeyMasked(`${data.apiKey.slice(0, 8)}${'•'.repeat(24)}${data.apiKey.slice(-8)}`);
                    setApiKeyHasKey(true);
                    setApiKeyVisible(true);
                  } catch (err) {
                    console.error('Generate API key failed', err);
                    showToast(t('admin.instance.api_key_generate_failed'), 'error');
                  } finally { setApiKeyLoading(false); }
                }}
                disabled={apiKeyLoading}
                className="btn-primary text-sm flex items-center gap-2"
              >
                {apiKeyLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                {t('admin.instance.generate_api_key')}
              </button>
            </div>
          )}
        </div>
      </div>

      <FloatingSaveBar show={hasChanges} saving={saving} saved={saved} error={saveError} onSave={handleSave} onReset={handleReset} />
      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </AdminTabLayout>
  );
}
