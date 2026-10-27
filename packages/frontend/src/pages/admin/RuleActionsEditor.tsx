import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, XCircle } from 'lucide-react';
import api from '@/lib/api';

export interface RuleAction { type: 'folder' | 'seriesType' | 'tag'; value: string; }
interface Service { id: number; name: string; type: string; enabled?: boolean; config?: { url?: string }; }
interface Folder { path: string; label: string; serviceId: number | null; }
interface ArrTag { id: number; label: string; }

export function RuleActionsEditor({ actions, onChange, serviceId, onServiceChange, mediaType, services, folders }: Readonly<{
  actions: RuleAction[]; onChange: (actions: RuleAction[]) => void;
  serviceId: string; onServiceChange: (id: string) => void;
  mediaType: string; services: Service[]; folders: Folder[];
}>) {
  const { t } = useTranslation();
  const fieldId = useId();
  const [tagState, setTagState] = useState<{ serviceId: string; status: 'loading' | 'ready' | 'error'; tags: ArrTag[] }>({ serviceId: '', status: 'ready', tags: [] });
  const [reload, setReload] = useState(0);
  const hasTagAction = actions.some(action => action.type === 'tag');

  useEffect(() => {
    if (!serviceId || !hasTagAction) return;
    let cancelled = false;
    setTagState({ serviceId, status: 'loading', tags: [] });
    api.get<ArrTag[]>(`/admin/services/${serviceId}/tags`).then(({ data }) => {
      if (!cancelled) setTagState({ serviceId, status: 'ready', tags: data });
    }).catch(() => {
      if (!cancelled) setTagState({ serviceId, status: 'error', tags: [] });
    });
    return () => { cancelled = true; };
  }, [serviceId, hasTagAction, reload]);

  const compatibleServices = services.filter(service => service.enabled !== false &&
    (mediaType === 'any' || service.type === (mediaType === 'movie' ? 'radarr' : 'sonarr')));
  const service = services.find(item => String(item.id) === serviceId);
  const availableFolders = folders.filter(folder => !serviceId || String(folder.serviceId) === serviceId)
    .filter(folder => mediaType === 'any' || compatibleServices.some(item => item.id === folder.serviceId));
  const tagsReady = tagState.serviceId === serviceId && tagState.status === 'ready';
  const actionLabel = (type: RuleAction['type']) => t(`admin.paths.action_${type}`);
  const allowedTypes = (index: number): RuleAction['type'][] => (['folder', 'seriesType', 'tag'] as const).filter(type => {
    if (type === 'seriesType' && mediaType === 'movie') return false;
    if (type === 'tag') return mediaType !== 'any';
    return !actions.some((action, i) => i !== index && action.type === type);
  });
  const setAction = (index: number, action: RuleAction) => onChange(actions.map((current, i) => i === index ? action : current));

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${fieldId}-service`} className="mb-1 block text-xs text-ndp-text-dim">{t('admin.paths.action_service')}</label>
        <select id={`${fieldId}-service`} value={serviceId} onChange={e => onServiceChange(e.target.value)} className="input w-full text-sm">
          <option value="">{t('admin.paths.default_service')}</option>
          {serviceId && !compatibleServices.some(item => String(item.id) === serviceId) && (
            <option value={serviceId} disabled>{service?.name ?? `#${serviceId}`} — {t('admin.paths.rule_broken')}</option>
          )}
          {compatibleServices.map(item => <option key={item.id} value={item.id}>{item.name}{item.config?.url ? ` (${item.config.url})` : ''}</option>)}
        </select>
      </div>
      <p className="text-xs text-ndp-text-dim">{t('admin.paths.actions_help')}</p>
      {actions.map((action, index) => (
        <div key={index} className="flex items-start gap-2">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <select aria-label={t('admin.paths.action_kind', { number: index + 1 })} value={action.type}
              onChange={e => setAction(index, { type: e.target.value as RuleAction['type'], value: '' })} className="input w-full text-sm">
              {allowedTypes(index).map(type => <option key={type} value={type}>{actionLabel(type)}</option>)}
            </select>
            {action.type === 'folder' && (
              <select aria-label={actionLabel('folder')} value={action.value ? `${serviceId}:${action.value}` : ''}
                onChange={e => {
                  const folder = availableFolders.find(item => `${item.serviceId}:${item.path}` === e.target.value);
                  const nextServiceId = folder?.serviceId?.toString() ?? serviceId;
                  onServiceChange(nextServiceId);
                  onChange(actions.map((current, i) => i === index ? { type: 'folder', value: folder?.path ?? '' }
                    : nextServiceId !== serviceId && current.type === 'tag' ? { ...current, value: '' } : current));
                }} className="input min-w-0 w-full text-sm">
                <option value="">{t('admin.paths.defaults_title')}</option>
                {action.value && !availableFolders.some(folder => folder.path === action.value && String(folder.serviceId) === serviceId) && (
                  <option value={`${serviceId}:${action.value}`}>{action.value}</option>
                )}
                {availableFolders.map(folder => <option key={`${folder.serviceId}:${folder.path}`} value={`${folder.serviceId}:${folder.path}`}>{folder.label}</option>)}
              </select>
            )}
            {action.type === 'seriesType' && (
              <select aria-label={actionLabel('seriesType')} value={action.value} onChange={e => setAction(index, { ...action, value: e.target.value })} className="input w-full text-sm">
                <option value="">{t('common.choose')}</option>
                <option value="standard">{t('admin.paths.standard')}</option>
                <option value="anime">{t('admin.paths.anime_rule')}</option>
                <option value="daily">{t('admin.paths.daily')}</option>
              </select>
            )}
            {action.type === 'tag' && (
              <select aria-label={t('admin.paths.service_tag', { number: index + 1 })} value={action.value}
                disabled={!serviceId || !tagsReady} onChange={e => setAction(index, { ...action, value: e.target.value })} className="input w-full text-sm disabled:opacity-50">
                <option value="">{t('admin.paths.select_service_tag')}</option>
                {action.value && (!tagsReady || !tagState.tags.some(tag => String(tag.id) === action.value)) && (
                  <option value={action.value} disabled>{tagsReady ? t('admin.paths.tag_missing', { id: action.value }) : `#${action.value}`}</option>
                )}
                {tagsReady && tagState.tags.map(tag => <option key={tag.id} value={tag.id}
                  disabled={actions.some((other, i) => i !== index && other.type === 'tag' && other.value === String(tag.id))}>{tag.label}</option>)}
              </select>
            )}
          </div>
          <button type="button" onClick={() => onChange(actions.filter((_, i) => i !== index))}
            aria-label={t('admin.paths.remove_action', { number: index + 1 })} className="p-3 text-ndp-text-dim hover:text-ndp-danger">
            <XCircle className="h-4 w-4" />
          </button>
        </div>
      ))}
      {hasTagAction && (
        <div aria-live="polite" className="text-xs text-ndp-text-muted">
          {!serviceId ? t('admin.paths.tags_choose_service')
            : tagState.serviceId !== serviceId || tagState.status === 'loading' ? t('admin.paths.tags_loading')
            : tagState.status === 'error' ? (
              <span className="text-ndp-warning">{t('admin.paths.tags_unavailable')} <button type="button" onClick={() => setReload(value => value + 1)} className="underline">{t('admin.paths.tags_retry')}</button></span>
            ) : <span>{tagState.tags.length === 0 ? t('admin.paths.tags_empty') : t('admin.paths.tags_help')} <button type="button" onClick={() => setReload(value => value + 1)} className="underline">{t('admin.paths.tags_refresh')}</button></span>}
        </div>
      )}
      {allowedTypes(-1).length > 0 && (
        <button type="button" onClick={() => onChange([...actions, { type: allowedTypes(-1)[0], value: '' }])} className="inline-flex items-center gap-1 text-xs text-ndp-accent hover:underline">
          <Plus className="h-3.5 w-3.5" /> {t('admin.paths.add_action')}
        </button>
      )}
    </div>
  );
}
