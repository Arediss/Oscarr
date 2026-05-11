import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadCloud, AlertCircle, CheckCircle2, Users, FileText } from 'lucide-react';
import api from '@/lib/api';
import { showToast, toastApiError } from '@/utils/toast';

interface ImportFlowProps {
  /** Optional callback after a successful import — used by the install
   *  wizard to advance to the next step. Admin-tab usage omits it. */
  onDone?: () => void;
}

type ImportSource = 'overseerr' | 'jellyseerr' | 'seerr';

interface CanonicalUser {
  sourceId: string;
  email: string | null;
  displayName: string | null;
  plexId?: string | null;
  jellyfinId?: string | null;
  isAdmin: boolean;
}

interface UserMatch {
  sourceUser: CanonicalUser;
  oscarrUserId: number | null;
  strategy: 'plex_id' | 'jellyfin_id' | 'email' | 'manual' | 'create' | 'skip';
}

interface ImportPreview {
  source: ImportSource;
  users: { total: number; matched: UserMatch[]; needsDecision: UserMatch[] };
  requests: {
    total: number;
    importable: number;
    conflicts: Array<{ reason: 'duplicate' | 'no_user' | 'tmdb_missing' }>;
  };
}

type Decision = { sourceId: string; action: 'link' | 'create' | 'skip'; oscarrUserId?: number };

const SOURCES: Array<{ id: ImportSource; label: string }> = [
  { id: 'overseerr', label: 'Overseerr' },
  { id: 'jellyseerr', label: 'Jellyseerr' },
  { id: 'seerr', label: 'Seerr' },
];

export function ImportFlow({ onDone }: Readonly<ImportFlowProps> = {}) {
  const { t } = useTranslation();

  const [source, setSource] = useState<ImportSource>('overseerr');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [previewing, setPreviewing] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [decisions, setDecisions] = useState<Map<string, Decision['action']>>(new Map());

  async function runPreview() {
    if (!url.trim() || !apiKey.trim()) {
      showToast(t('admin.import.creds_required'), 'error');
      return;
    }
    setPreviewing(true);
    try {
      const res = await api.post<ImportPreview>('/admin/import/preview', {
        source,
        url: url.trim(),
        apiKey: apiKey.trim(),
      });
      setPreview(res.data);
      // Default every needs-decision user to "create" — admin can flip individuals.
      const next = new Map<string, Decision['action']>();
      for (const m of res.data.users.needsDecision) next.set(m.sourceUser.sourceId, 'create');
      setDecisions(next);
    } catch (err) {
      toastApiError(err, t('admin.import.preview_failed'));
    } finally {
      setPreviewing(false);
    }
  }

  async function runExecute() {
    if (!preview) return;
    setExecuting(true);
    try {
      const payload: Decision[] = preview.users.needsDecision.map((m) => ({
        sourceId: m.sourceUser.sourceId,
        action: decisions.get(m.sourceUser.sourceId) ?? 'create',
      }));
      const res = await api.post<{
        usersCreated: number;
        usersLinked: number;
        requestsCreated: number;
        requestsSkipped: number;
      }>('/admin/import/execute', {
        source,
        url: url.trim(),
        apiKey: apiKey.trim(),
        decisions: payload,
      });
      showToast(
        t('admin.import.done', {
          users: res.data.usersCreated + res.data.usersLinked,
          requests: res.data.requestsCreated,
        }),
        'success'
      );
      setPreview(null);
      setApiKey('');
      onDone?.();
    } catch (err) {
      toastApiError(err, t('admin.import.execute_failed'));
    } finally {
      setExecuting(false);
    }
  }

  const conflictsByReason = preview
    ? preview.requests.conflicts.reduce<Record<string, number>>((acc, c) => {
        acc[c.reason] = (acc[c.reason] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-6 max-w-3xl">
      <p className="text-sm text-ndp-text-muted">{t('admin.import.intro')}</p>

        {/* Step 1 — credentials */}
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ndp-text">
            <DownloadCloud className="w-4 h-4" />
            {t('admin.import.step_source')}
          </div>

          <div className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s.id)}
                className={
                  'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ' +
                  (source === s.id
                    ? 'bg-ndp-accent/15 border-ndp-accent/40 text-ndp-accent'
                    : 'border-white/10 text-ndp-text-muted hover:text-ndp-text hover:bg-white/5')
                }
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-ndp-text-muted">
              {t('admin.import.url_label')}
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://overseerr.example.com"
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm text-ndp-text focus:outline-none focus:border-ndp-accent/50"
              />
            </label>
            <label className="block text-xs font-medium text-ndp-text-muted">
              {t('admin.import.api_key_label')}
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm text-ndp-text focus:outline-none focus:border-ndp-accent/50"
              />
            </label>
          </div>

          <button
            type="button"
            onClick={runPreview}
            disabled={previewing}
            className="px-4 py-2 rounded-md bg-ndp-accent text-white text-sm font-medium hover:bg-ndp-accent/90 disabled:opacity-50"
          >
            {previewing ? t('admin.import.previewing') : t('admin.import.run_preview')}
          </button>
        </div>

        {/* Step 2 — preview + decisions */}
        {preview && (
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Stat icon={Users} label={t('admin.import.users_matched')} value={preview.users.matched.length} sub={t('admin.import.of_total', { total: preview.users.total })} />
              <Stat icon={FileText} label={t('admin.import.requests_importable')} value={preview.requests.importable} sub={t('admin.import.of_total', { total: preview.requests.total })} />
            </div>

            {Object.keys(conflictsByReason).length > 0 && (
              <div className="text-xs text-ndp-text-muted flex flex-wrap gap-3">
                {conflictsByReason.duplicate ? (
                  <span><AlertCircle className="inline w-3 h-3 mr-1 text-amber-400" />{t('admin.import.conflict_duplicate', { count: conflictsByReason.duplicate })}</span>
                ) : null}
                {conflictsByReason.no_user ? (
                  <span><AlertCircle className="inline w-3 h-3 mr-1 text-amber-400" />{t('admin.import.conflict_no_user', { count: conflictsByReason.no_user })}</span>
                ) : null}
                {conflictsByReason.tmdb_missing ? (
                  <span><AlertCircle className="inline w-3 h-3 mr-1 text-amber-400" />{t('admin.import.conflict_tmdb_missing', { count: conflictsByReason.tmdb_missing })}</span>
                ) : null}
              </div>
            )}

            {preview.users.needsDecision.length > 0 && (
              <div>
                <div className="text-sm font-medium text-ndp-text mb-2">
                  {t('admin.import.users_need_decision', { count: preview.users.needsDecision.length })}
                </div>
                <div className="space-y-1 max-h-[280px] overflow-y-auto pr-1">
                  {preview.users.needsDecision.map((m) => {
                    const id = m.sourceUser.sourceId;
                    const action = decisions.get(id) ?? 'create';
                    return (
                      <div key={id} className="flex items-center justify-between gap-3 text-sm py-1.5 px-2 rounded hover:bg-white/5">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-ndp-text">{m.sourceUser.displayName ?? m.sourceUser.email ?? `#${id}`}</div>
                          <div className="truncate text-xs text-ndp-text-muted">{m.sourceUser.email ?? '—'}</div>
                        </div>
                        <select
                          value={action}
                          onChange={(e) => {
                            const next = new Map(decisions);
                            next.set(id, e.target.value as Decision['action']);
                            setDecisions(next);
                          }}
                          className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-xs text-ndp-text focus:outline-none focus:border-ndp-accent/50"
                        >
                          <option value="create">{t('admin.import.action_create')}</option>
                          <option value="skip">{t('admin.import.action_skip')}</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="px-3 py-1.5 rounded-md text-sm text-ndp-text-muted hover:text-ndp-text hover:bg-white/5"
              >
                {t('admin.import.cancel')}
              </button>
              <button
                type="button"
                onClick={runExecute}
                disabled={executing}
                className="px-4 py-2 rounded-md bg-ndp-accent text-white text-sm font-medium hover:bg-ndp-accent/90 disabled:opacity-50 inline-flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                {executing ? t('admin.import.executing') : t('admin.import.run_execute')}
              </button>
            </div>
          </div>
        )}
    </div>
  );
}

interface StatProps {
  icon: typeof Users;
  label: string;
  value: number;
  sub?: string;
}

function Stat({ icon: Icon, label, value, sub }: Readonly<StatProps>) {
  return (
    <div className="rounded-md border border-white/5 bg-black/20 p-3">
      <div className="text-xs text-ndp-text-muted flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-2xl font-semibold text-ndp-text mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-ndp-text-muted">{sub}</div>}
    </div>
  );
}
