import { Server, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ServiceSchema } from '@/hooks/useServiceSchemas';
import type { ServiceTagsState } from '@/hooks/useServiceTags';
import type { RoutingService } from './routingServices';

interface InstanceProps { service?: RoutingService; serviceId: number | null; schema?: ServiceSchema }

export function ServiceInstanceLabel({ service, serviceId, schema }: Readonly<InstanceProps>) {
  const { t } = useTranslation();
  const name = service?.name ?? t('admin.paths.tag_service_missing');
  const title = [schema?.label, name, serviceId != null ? `#${serviceId}` : null, service?.config?.url].filter(Boolean).join(' · ');
  return (
    <span title={title} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-ndp-accent/10 px-2 py-1 text-xs text-ndp-accent">
      {schema?.icon ? <img src={schema.icon} alt="" className="h-3.5 w-3.5 shrink-0 object-contain" /> : <Server className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{name}</span>
      {serviceId != null && <span className="shrink-0 text-ndp-text-muted">#{serviceId}</span>}
    </span>
  );
}

export function ServiceTagBadge({ service, serviceId, schema, tagId, state }: Readonly<InstanceProps & { tagId: number; state?: ServiceTagsState }>) {
  const { t } = useTranslation();
  const tag = state?.tags.find(item => item.id === tagId);
  const label = tag?.label ?? t('admin.paths.tag_reference', { id: tagId });
  const status = !service || service.enabled === false || !schema?.supportsTags || state?.status === 'error'
    ? t('admin.paths.tag_unavailable_short')
    : !state || state.status === 'loading' ? t('common.loading')
    : !tag ? t('admin.paths.tag_missing_short') : null;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-ndp-surface-light p-1 text-xs">
      <ServiceInstanceLabel service={service} serviceId={serviceId} schema={schema} />
      <span className="inline-flex min-w-0 items-center gap-1.5 px-1 text-ndp-text">
        <Tag className="h-3 w-3 shrink-0 text-ndp-text-muted" />
        <span className="break-all">{label}</span>
      </span>
      {status && <span className="px-1 text-ndp-text-muted">({status})</span>}
    </span>
  );
}
