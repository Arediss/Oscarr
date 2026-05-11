import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { AlertTriangle, Loader2, Pencil, Plug, Power, Star, Trash2 } from 'lucide-react';
import type { ServiceData, ServiceSchema } from '@/hooks/useServiceSchemas';
import type { ServiceTestResult } from './useServicesTab';

interface ServiceRowProps {
  service: ServiceData;
  schema: ServiceSchema | undefined;
  testing: boolean;
  result: ServiceTestResult | null;
  /** Set when the security endpoint flagged this row — drives the inline warning icon.
   *  "plaintext" = pending encryption upgrade; "undecryptable" = imported from another env,
   *  credentials must be re-entered for the service to work. */
  flagReason?: 'plaintext' | 'undecryptable' | null;
  onTest: (service: ServiceData) => void;
  onEdit: (service: ServiceData) => void;
  onToggle: (service: ServiceData) => void;
  onSetDefault: (service: ServiceData) => void;
  onDelete: (id: number) => void;
}

/** One row in the services list — status dot, icon, name + URL, test badge, action buttons. */
export function ServiceRow({
  service, schema, testing, result, flagReason, onTest, onEdit, onToggle, onSetDefault, onDelete,
}: ServiceRowProps) {
  const { t } = useTranslation();

  return (
    <div className={clsx('card', !service.enabled && 'opacity-50')}>
      <div className="flex items-center gap-4 p-4">
        <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', service.enabled ? 'bg-ndp-success' : 'bg-ndp-text-dim')} />

        <img src={schema?.icon || '/logo.png'} alt={schema?.label || service.type} className="w-8 h-8 rounded-lg object-contain flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-ndp-text truncate">{service.name}</span>
            {service.isDefault && (
              <span className="px-1.5 py-0.5 bg-ndp-accent/10 text-ndp-accent text-[10px] font-semibold rounded-full flex-shrink-0">{t('common.default_badge')}</span>
            )}
            {flagReason && (
              <span
                className={clsx(
                  'flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0',
                  flagReason === 'undecryptable'
                    ? 'bg-ndp-danger/15 text-ndp-danger'
                    : 'bg-amber-500/15 text-amber-400',
                )}
                title={t(
                  flagReason === 'undecryptable'
                    ? 'admin.services.flag.undecryptable'
                    : 'admin.services.flag.plaintext',
                )}
              >
                <AlertTriangle className="w-3 h-3" />
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-ndp-text-dim">{schema?.label || service.type}</span>
            {service.config.url && <span className="text-xs text-ndp-text-dim truncate">{service.config.url}</span>}
          </div>
        </div>

        {result && (() => {
          const blocked = !result.ok && result.errorCode === 'URL_BLOCKED_BY_SSRF_GUARD';
          // Hovering the badge shows the full pre-rendered cause (e.g. "Connection refused at
          // 192.168.1.50:7878 — nothing listening, or bound to localhost"). Keeps the row tight
          // while still giving admins enough to diagnose without opening AppLog.
          const title = blocked
            ? t('admin.services.ssrf_blocked')
            : !result.ok
            ? result.errorDetail
            : undefined;
          return (
            <span
              className={clsx(
                'text-xs px-2 py-1 rounded-lg flex-shrink-0',
                result.ok
                  ? 'bg-ndp-success/10 text-ndp-success'
                  : blocked
                  ? 'bg-ndp-warning/10 text-ndp-warning'
                  : 'bg-ndp-danger/10 text-ndp-danger',
              )}
              title={title}
            >
              {result.ok
                ? (result.version ? `v${result.version}` : t('status.connected'))
                : blocked
                ? t('status.ssrf_blocked')
                : t('status.connection_failed')}
            </span>
          );
        })()}

        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={() => onTest(service)} disabled={testing} className="p-2 text-ndp-text-dim hover:text-ndp-accent hover:bg-white/5 rounded-lg transition-colors" title={t('common.test')}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          </button>
          <button onClick={() => onEdit(service)} className="p-2 text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 rounded-lg transition-colors" title={t('common.edit')}>
            <Pencil className="w-4 h-4" />
          </button>
          <button onClick={() => onToggle(service)} className="p-2 text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 rounded-lg transition-colors" title={service.enabled ? t('common.disable') : t('common.enable')}>
            <Power className={clsx('w-4 h-4', service.enabled && 'text-ndp-success')} />
          </button>
          {!service.isDefault && (
            <button onClick={() => onSetDefault(service)} className="p-2 text-ndp-text-dim hover:text-ndp-warning hover:bg-white/5 rounded-lg transition-colors" title={t('admin.services.set_default')}>
              <Star className="w-4 h-4" />
            </button>
          )}
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={() => onDelete(service.id)} className="p-2 text-ndp-text-dim hover:text-ndp-danger hover:bg-white/5 rounded-lg transition-colors" title={t('common.delete')}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
