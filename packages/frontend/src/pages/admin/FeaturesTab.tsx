import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import { useFeatures } from '@/context/FeaturesContext';
import { Spinner } from './Spinner';
import { AdminTabLayout } from './AdminTabLayout';
import { FloatingSaveBar } from '@/components/FloatingSaveBar';
import { COLOR_TOKENS } from '@oscarr/shared';

/**
 * "How Oscarr behaves" — feature flags + request policy + disabled-login behavior.
 * Split out of the old General tab. Everything here tunes what's on/off and how the site
 * responds to edge cases, without touching the instance's identity.
 */

interface SourceOption { id: string; label: string; category: string }

/** True when the chosen source is a media server, i.e. the one case that introduces a wait. */
function sourceIsLibrary(id: string, options: SourceOption[]): boolean {
  return options.find((o) => o.id === id)?.category === 'media-server';
}

export function FeaturesTab() {
  const { t } = useTranslation();
  const { refreshFeatures } = useFeatures();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [autoApproveRequests, setAutoApproveRequests] = useState(false);
  const [requestsEnabled, setRequestsEnabled] = useState(true);
  const [calendarEnabled, setCalendarEnabled] = useState(true);
  const [nsfwBlurEnabled, setNsfwBlurEnabled] = useState(true);
  const [missingSearchCooldownMin, setMissingSearchCooldownMin] = useState(60);
  const [disabledLoginMode, setDisabledLoginMode] = useState<'block' | 'friendly'>('friendly');
  const [arrUserTaggingEnabled, setArrUserTaggingEnabled] = useState(false);
  // Availability threshold — split by media type because a movie lands as one file while a series
  // imports episode by episode into a library rescanned on a schedule.
  const [movieAvailabilitySource, setMovieAvailabilitySource] = useState('radarr');
  const [tvAvailabilitySource, setTvAvailabilitySource] = useState('sonarr');
  // Only what the connectors declare they can do — the picker never offers a dead option.
  const [sources, setSources] = useState<{ movie: SourceOption[]; tv: SourceOption[] }>({ movie: [], tv: [] });
  const [importedStateLabel, setImportedStateLabel] = useState('');
  const [importedStateColor, setImportedStateColor] = useState('');

  const initialValues = useRef<Record<string, unknown>>({});

  // Refuse to render the form on load failure — otherwise the admin toggles against stale
  // hardcoded defaults and a save would overwrite real config silently.
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data } = await api.get('/admin/settings');
      const vals = {
        autoApproveRequests: data.autoApproveRequests ?? false,
        requestsEnabled: data.requestsEnabled ?? true,
        calendarEnabled: data.calendarEnabled ?? true,
        nsfwBlurEnabled: data.nsfwBlurEnabled ?? true,
        missingSearchCooldownMin: data.missingSearchCooldownMin ?? 60,
        disabledLoginMode: (data.disabledLoginMode === 'block' ? 'block' : 'friendly') as 'block' | 'friendly',
        arrUserTaggingEnabled: data.arrUserTaggingEnabled ?? false,
        movieAvailabilitySource: data.movieAvailabilitySource ?? 'radarr',
        tvAvailabilitySource: data.tvAvailabilitySource ?? 'sonarr',
        importedStateLabel: data.importedStateLabel ?? '',
        importedStateColor: data.importedStateColor ?? '',
      };
      setAutoApproveRequests(vals.autoApproveRequests);
      setRequestsEnabled(vals.requestsEnabled);
      setCalendarEnabled(vals.calendarEnabled);
      setNsfwBlurEnabled(vals.nsfwBlurEnabled);
      setMissingSearchCooldownMin(vals.missingSearchCooldownMin);
      setDisabledLoginMode(vals.disabledLoginMode);
      setArrUserTaggingEnabled(vals.arrUserTaggingEnabled);
      setMovieAvailabilitySource(vals.movieAvailabilitySource);
      setTvAvailabilitySource(vals.tvAvailabilitySource);
      try {
        const { data: srcs } = await api.get('/admin/availability-sources');
        setSources(srcs);
      } catch { /* picker falls back to the stored value alone */ }
      setImportedStateLabel(vals.importedStateLabel);
      setImportedStateColor(vals.importedStateColor);
      initialValues.current = vals;
    } catch (err) {
      console.error('FeaturesTab load failed', err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const currentValues = useMemo(
    () => ({ autoApproveRequests, requestsEnabled, calendarEnabled, nsfwBlurEnabled, missingSearchCooldownMin, disabledLoginMode, arrUserTaggingEnabled, movieAvailabilitySource, tvAvailabilitySource, importedStateLabel, importedStateColor }),
    [autoApproveRequests, requestsEnabled, calendarEnabled, nsfwBlurEnabled, missingSearchCooldownMin, disabledLoginMode, arrUserTaggingEnabled, movieAvailabilitySource, tvAvailabilitySource, importedStateLabel, importedStateColor]
  );

  const hasChanges = !loading && Object.keys(initialValues.current).length > 0 &&
    Object.entries(currentValues).some(([k, v]) => initialValues.current[k] !== v);

  const handleReset = () => {
    const iv = initialValues.current;
    setAutoApproveRequests(iv.autoApproveRequests as boolean);
    setRequestsEnabled(iv.requestsEnabled as boolean);
    setCalendarEnabled(iv.calendarEnabled as boolean);
    setNsfwBlurEnabled(iv.nsfwBlurEnabled as boolean);
    setMissingSearchCooldownMin(iv.missingSearchCooldownMin as number);
    setDisabledLoginMode(iv.disabledLoginMode as 'block' | 'friendly');
    setArrUserTaggingEnabled(iv.arrUserTaggingEnabled as boolean);
    setMovieAvailabilitySource(iv.movieAvailabilitySource as string);
    setTvAvailabilitySource(iv.tvAvailabilitySource as string);
    setImportedStateLabel(iv.importedStateLabel as string);
    setImportedStateColor(iv.importedStateColor as string);
  };

  const handleSave = async () => {
    setSaving(true); setSaved(false); setSaveError(null);
    try {
      await api.put('/admin/settings', {
        autoApproveRequests,
        requestsEnabled,
        calendarEnabled,
        nsfwBlurEnabled,
        missingSearchCooldownMin,
        disabledLoginMode,
        arrUserTaggingEnabled,
        movieAvailabilitySource,
        tvAvailabilitySource,
        importedStateLabel: importedStateLabel.trim() || null,
        importedStateColor: importedStateColor || null,
      });
      await refreshFeatures();
      initialValues.current = { ...currentValues };
      setSaved(true); setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('FeaturesTab save failed', err);
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

  const features = [
    { label: t('admin.features.requests'), desc: t('admin.features.requests_desc'), value: requestsEnabled, set: setRequestsEnabled },
    { label: t('admin.features.auto_approve'), desc: t('admin.features.auto_approve_desc'), value: autoApproveRequests, set: setAutoApproveRequests },
    { label: t('admin.features.calendar'), desc: t('admin.features.calendar_desc'), value: calendarEnabled, set: setCalendarEnabled },
    { label: t('admin.features.nsfw_blur'), desc: t('admin.features.nsfw_blur_desc'), value: nsfwBlurEnabled, set: setNsfwBlurEnabled },
    { label: t('admin.features.arr_user_tagging'), desc: t('admin.features.arr_user_tagging_desc'), value: arrUserTaggingEnabled, set: setArrUserTaggingEnabled },
  ];

  return (
    <AdminTabLayout>
      <div>
        <h2 className="text-lg font-semibold text-ndp-text mb-2">{t('admin.features.section_title')}</h2>
        <p className="text-xs text-ndp-text-dim mb-4">{t('admin.features.section_desc')}</p>
        <div className="space-y-3">
          {features.map(({ label, desc, value, set }) => (
            <div key={label} className="card">
              <div className="flex items-center gap-4 p-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ndp-text">{label}</p>
                  <p className="text-xs text-ndp-text-dim mt-0.5">{desc}</p>
                </div>
                <button
                  type="button"
                  onClick={() => set(!value)}
                  className={clsx('relative w-11 h-6 rounded-full transition-colors flex-shrink-0', value ? 'bg-ndp-accent' : 'bg-white/10')}
                >
                  <span className={clsx('absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm', value && 'translate-x-5')} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ndp-text mb-2">{t('admin.features.search_cooldown')}</h2>
        <p className="text-xs text-ndp-text-dim mb-4">{t('admin.features.search_cooldown_desc')}</p>
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={1440}
              value={missingSearchCooldownMin}
              onChange={(e) => setMissingSearchCooldownMin(Math.max(1, Number.parseInt(e.target.value) || 60))}
              className="input w-24 text-sm text-center"
            />
            <span className="text-sm text-ndp-text-dim">min</span>
          </div>
        </div>
      </div>


      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ndp-text mb-2">{t('admin.features.availability_title')}</h2>
        <p className="text-xs text-ndp-text-dim mb-4">{t('admin.features.availability_desc')}</p>
        <div className="card p-4 space-y-3">

          {([
            { key: 'movie', label: t('admin.features.source_movies'), value: movieAvailabilitySource, set: setMovieAvailabilitySource, options: sources.movie },
            { key: 'tv', label: t('admin.features.source_tv'), value: tvAvailabilitySource, set: setTvAvailabilitySource, options: sources.tv },
          ] as const).map(({ key, label, value, set, options }) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-ndp-text">{label}</p>
              <select value={value} onChange={(e) => set(e.target.value)} className="input text-sm w-56">
                {/* The stored value stays selectable even if its service was since disabled, so
                    opening this page never silently rewrites the configuration. */}
                {!options.some((o) => o.id === value) && <option value={value}>{value}</option>}
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}{o.category === 'arr' ? t('admin.features.source_arr_suffix') : ''}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {(sourceIsLibrary(movieAvailabilitySource, sources.movie) || sourceIsLibrary(tvAvailabilitySource, sources.tv)) && (
            <div className="border-t border-white/10 pt-3 mt-1 space-y-3">
              <p className="text-xs text-ndp-text-dim">{t('admin.features.imported_state_desc')}</p>
              <div className="flex flex-wrap gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-ndp-text mb-1">{t('admin.features.imported_label')}</label>
                  <input
                    value={importedStateLabel}
                    maxLength={40}
                    onChange={(e) => setImportedStateLabel(e.target.value)}
                    placeholder={t('status.imported')}
                    className="input text-sm w-56"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ndp-text mb-1">{t('admin.features.imported_color')}</label>
                  <select value={importedStateColor} onChange={(e) => setImportedStateColor(e.target.value)} className="input text-sm w-40">
                    <option value="">{t('admin.features.imported_color_default')}</option>
                    {COLOR_TOKENS.map((token) => (<option key={token} value={token}>{token}</option>))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ndp-text mb-2">{t('admin.features.disabled_login_title', 'Disabled accounts')}</h2>
        <p className="text-xs text-ndp-text-dim mb-4">
          {t('admin.features.disabled_login_desc', 'Choose how the login screen responds when a user marked as disabled tries to sign in.')}
        </p>
        <div className="card p-4 space-y-2">
          <label className="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
            <input type="radio" name="disabledLoginMode" checked={disabledLoginMode === 'friendly'} onChange={() => setDisabledLoginMode('friendly')} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-ndp-text">{t('admin.features.disabled_login_friendly', 'Friendly message')}</p>
              <p className="text-xs text-ndp-text-dim mt-0.5">
                {t('admin.features.disabled_login_friendly_desc', 'Login rejected with an explicit message telling the user their account is disabled.')}
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-2 rounded-lg cursor-pointer hover:bg-white/5 transition-colors">
            <input type="radio" name="disabledLoginMode" checked={disabledLoginMode === 'block'} onChange={() => setDisabledLoginMode('block')} className="mt-0.5" />
            <div>
              <p className="text-sm font-medium text-ndp-text">{t('admin.features.disabled_login_silent', 'Silent block')}</p>
              <p className="text-xs text-ndp-text-dim mt-0.5">
                {t('admin.features.disabled_login_silent_desc', 'Login rejected with a generic "Invalid credentials" error. The user has no indication their account was disabled.')}
              </p>
            </div>
          </label>
        </div>
      </div>

      <FloatingSaveBar show={hasChanges} saving={saving} saved={saved} error={saveError} onSave={handleSave} onReset={handleReset} />
    </AdminTabLayout>
  );
}
