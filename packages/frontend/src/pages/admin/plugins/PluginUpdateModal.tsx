import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, ArrowRight, Plus, Minus, ShieldAlert, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { extractApiError } from '@/utils/toast';
import { useModal } from '@/hooks/useModal';
import type { PluginInfo } from '@/plugins/types';
import type { PluginUpdatePreflight } from '@oscarr/shared';

interface Props {
  plugin: PluginInfo | null;
  open: boolean;
  busy: boolean;
  /** Failure of the apply itself. Rendered inside the dialog — a banner behind the overlay
   *  can't be read or acted on. Distinct from the modal's own preflight `error` state. */
  applyError?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Update modal — fetches preflight on open, shows compat + permission diff, blocks apply
 *  when the new release is incompatible with the running Oscarr version. */
export function PluginUpdateModal({ plugin, open, busy, applyError, onCancel, onConfirm }: Readonly<Props>) {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useModal({ open: open && plugin !== null, onClose: onCancel });
  const [preflight, setPreflight] = useState<PluginUpdatePreflight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !plugin) {
      setPreflight(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api.get(`/plugins/${plugin.id}/update/preflight`)
      .then(({ data }) => setPreflight(data))
      .catch((err) => setError(extractApiError(err, t('admin.plugins.update.preflight_failed'))))
      .finally(() => setLoading(false));
  }, [open, plugin, t]);

  if (!open || !plugin) return null;

  const incompatible = preflight?.compat.status === 'incompatible';
  const hasAddedPerms = !!preflight && (
    preflight.permissionDiff.services.added.length > 0 ||
    preflight.permissionDiff.capabilities.added.length > 0 ||
    Object.keys(preflight.permissionDiff.capabilityReasons.added).length > 0
  );
  const canApply = !!preflight && !incompatible && !loading;
  const primaryLabel = hasAddedPerms ? t('admin.plugins.update.accept_and_apply') : t('admin.plugins.update.apply');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-lg flex flex-col shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 flex-shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ndp-text truncate">
              {t('admin.plugins.update.title', { name: plugin.name })}
            </h2>
            {preflight && (
              <p className="text-xs text-ndp-text-dim mt-0.5 inline-flex items-center gap-1.5">
                v{preflight.currentVersion}
                <ArrowRight className="w-3 h-3" />
                <span className="text-ndp-text">v{preflight.latestVersion}</span>
              </p>
            )}
          </div>
          <button
            onClick={() => !busy && onCancel()}
            className="p-1.5 -mt-1 -mr-1 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors flex-shrink-0"
            aria-label={t('common.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-2 min-h-[8rem]">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ndp-text-muted py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('admin.plugins.update.checking')}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-ndp-danger/10 border border-ndp-danger/20 text-sm text-ndp-danger">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {preflight && (
            <>
              {incompatible && (
                <div className="flex items-start gap-3 p-3 mb-4 rounded-lg bg-ndp-danger/10 border border-ndp-danger/20 text-sm text-ndp-danger">
                  <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">{t('admin.plugins.update.incompatible_title')}</div>
                    <div className="text-xs mt-0.5 text-ndp-danger/80">
                      {preflight.compat.reason ?? t('admin.plugins.update.incompatible_generic')}
                    </div>
                  </div>
                </div>
              )}

              {preflight.compat.status === 'untested' && (
                <div className="flex items-start gap-3 p-3 mb-4 rounded-lg bg-amber-400/10 border border-amber-400/20 text-sm text-amber-300">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium">{t('admin.plugins.update.untested_title')}</div>
                    <div className="text-xs mt-0.5 text-amber-300/80">
                      {t('admin.plugins.update.untested_body', { range: preflight.compat.range, version: preflight.compat.oscarrVersion })}
                    </div>
                  </div>
                </div>
              )}

              {hasAddedPerms && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-ndp-text-dim mb-2">
                    {t('admin.plugins.update.new_permissions')}
                  </div>
                  <PermList items={preflight.permissionDiff.services.added.map((s) => `service:${s}`)} kind="added" />
                  <PermList items={preflight.permissionDiff.capabilities.added} kind="added" />
                  {Object.entries(preflight.permissionDiff.capabilityReasons.added).map(([cap, reason]) => (
                    <PermLine key={cap} kind="added" label={cap} hint={reason} />
                  ))}
                </div>
              )}

              {(preflight.permissionDiff.services.removed.length > 0 ||
                preflight.permissionDiff.capabilities.removed.length > 0 ||
                preflight.permissionDiff.capabilityReasons.removed.length > 0) && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-ndp-text-dim mb-2">
                    {t('admin.plugins.update.removed_permissions')}
                  </div>
                  <PermList items={preflight.permissionDiff.services.removed.map((s) => `service:${s}`)} kind="removed" />
                  <PermList items={preflight.permissionDiff.capabilities.removed} kind="removed" />
                  {preflight.permissionDiff.capabilityReasons.removed.map((cap) => (
                    <PermLine key={cap} kind="removed" label={cap} />
                  ))}
                </div>
              )}

              {preflight.permissionDiff.capabilityReasons.changed.length > 0 && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wider text-ndp-text-dim mb-2">
                    {t('admin.plugins.update.changed_reasons')}
                  </div>
                  {preflight.permissionDiff.capabilityReasons.changed.map((c) => (
                    <div key={c.capability} className="px-3 py-2 rounded-lg bg-white/[0.03] mb-1.5 text-sm">
                      <div className="text-ndp-text font-medium">{c.capability}</div>
                      <div className="text-xs text-ndp-text-dim mt-0.5 line-through">{c.from}</div>
                      <div className="text-xs text-ndp-text-muted">{c.to}</div>
                    </div>
                  ))}
                </div>
              )}

              {!hasAddedPerms &&
                preflight.permissionDiff.services.removed.length === 0 &&
                preflight.permissionDiff.capabilities.removed.length === 0 &&
                preflight.permissionDiff.capabilityReasons.removed.length === 0 &&
                preflight.permissionDiff.capabilityReasons.changed.length === 0 && (
                <p className="text-sm text-ndp-text-muted">{t('admin.plugins.update.no_permission_changes')}</p>
              )}
            </>
          )}
        </div>

        {applyError && (
          <div
            role="alert"
            className="mx-6 mt-4 rounded-lg border border-ndp-danger/30 bg-ndp-danger/10 px-3 py-2.5 flex-shrink-0"
          >
            <p className="text-sm text-ndp-danger break-words">{applyError}</p>
          </div>
        )}

        <div className="flex gap-2 px-6 pt-4 pb-6 flex-shrink-0">
          <button
            onClick={() => !busy && onCancel()}
            disabled={busy}
            className="btn-secondary text-sm flex-1 disabled:opacity-50"
          >
            {applyError ? t('common.close') : t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={!canApply || busy}
            className="btn-primary text-sm flex-1 disabled:opacity-50"
          >
            {busy ? t('admin.plugins.update.applying') : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermList({ items, kind }: Readonly<{ items: string[]; kind: 'added' | 'removed' }>) {
  if (items.length === 0) return null;
  return <>{items.map((label) => <PermLine key={label} label={label} kind={kind} />)}</>;
}

function PermLine({ label, kind, hint }: Readonly<{ label: string; kind: 'added' | 'removed'; hint?: string }>) {
  const Icon = kind === 'added' ? Plus : Minus;
  const colorClass = kind === 'added' ? 'text-ndp-accent' : 'text-ndp-text-dim';
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-white/[0.03] mb-1.5 text-sm">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className="text-ndp-text">{label}</div>
        {hint && <div className="text-xs text-ndp-text-muted mt-0.5">{hint}</div>}
      </div>
    </div>
  );
}
