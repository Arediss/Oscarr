import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Loader2, CheckCircle, XCircle, RefreshCw, Pencil, Power, Webhook } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import i18n from '@/i18n';
import { localizedDateTime } from '@/i18n/formatters';
import api from '@/lib/api';
import { showToast as showGlobalToast, toastApiError, extractApiError } from '@/utils/toast';
import { Spinner } from './Spinner';
import { AdminTabLayout } from './AdminTabLayout';
import { useServiceSchemas, type ServiceData } from '@/hooks/useServiceSchemas';

interface CronJobData {
  id: number;
  key: string;
  label: string;
  cronExpression: string;
  enabled: boolean;
  pluginId: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDuration: number | null;
  lastResult: string | null;
  running?: boolean;
}

interface PluginInfoLite {
  id: string;
  name: string;
}

interface SyncToast {
  type: 'success' | 'error';
  message: string;
}

interface WebhookStatus {
  serviceId: number;
  serviceName: string;
  serviceType: string;
  icon: string;
  enabled: boolean;
  serviceReachable: boolean;
  url: string;
  events: { key: string; label: string; description: string }[];
  supportsWebhooks: boolean;
}

export function JobsTab() {
  const { t } = useTranslation();
  const { schemas: SERVICE_SCHEMAS } = useServiceSchemas();
  const [jobs, setJobs] = useState<CronJobData[]>([]);
  const [pluginsById, setPluginsById] = useState<Map<string, PluginInfoLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [editingCron, setEditingCron] = useState<{ key: string; value: string } | null>(null);
  const [toast, setToast] = useState<SyncToast | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookStatus[]>([]);
  const [webhookLoading, setWebhookLoading] = useState<number | null>(null);
  // Snapshot of lastRunAt taken when *this* client triggered the job — lets us detect
  // completion (lastRunAt advances + running goes false) and surface the result toast.
  const [triggered, setTriggered] = useState<Map<string, string | null>>(new Map());

  const fetchJobs = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/jobs');
      setJobs(data);
    } catch (err) { toastApiError(err, t('admin.jobs.load_failed')); }
    finally { setLoading(false); }
  }, [t]);

  const fetchWebhooks = useCallback(async () => {
    try {
      const { data: services } = await api.get('/admin/services') as { data: ServiceData[] };
      const arrServices = services.filter(s => ['radarr', 'sonarr'].includes(s.type));
      setWebhooks([]);
      arrServices.forEach(async (svc) => {
        const schema = SERVICE_SCHEMAS[svc.type];
        try {
          const { data } = await api.get(`/admin/services/${svc.id}/webhook/status`);
          const status = { serviceId: svc.id, serviceName: svc.name, serviceType: svc.type, icon: schema?.icon || '', ...data } as WebhookStatus;
          setWebhooks(prev => [...prev.filter(w => w.serviceId !== svc.id), status]);
        } catch (err) {
          // If the probe itself fails (service down, 500, network), push a degraded tile so the
          // Webhooks section doesn't vanish when all services are unreachable — admin sees the
          // row with "unreachable" state instead of thinking webhooks aren't supported at all.
          console.error(`Webhook status probe failed for service ${svc.id}`, err);
          setWebhooks(prev => [...prev.filter(w => w.serviceId !== svc.id), {
            serviceId: svc.id,
            serviceName: svc.name,
            serviceType: svc.type,
            icon: schema?.icon || '',
            enabled: false,
            serviceReachable: false,
            url: '',
            events: [],
            supportsWebhooks: false,
          }]);
        }
      });
    } catch (err) { toastApiError(err, t('admin.jobs.webhooks_load_failed')); }
  }, [SERVICE_SCHEMAS, t]);

  const fetchPlugins = useCallback(async () => {
    try {
      const { data } = await api.get<PluginInfoLite[]>('/plugins');
      setPluginsById(new Map(data.map((p) => [p.id, p])));
    } catch { /* non-critical — UI falls back to raw pluginId */ }
  }, []);

  useEffect(() => { fetchJobs(); fetchWebhooks(); fetchPlugins(); }, [fetchJobs, fetchWebhooks, fetchPlugins]);

  const showToast = (t: SyncToast) => { setToast(t); setTimeout(() => setToast(null), 6000); };

  const formatSyncResult = (data: Record<string, any>) => {
    const parts: string[] = [];
    if (data.radarr) {
      const r = data.radarr;
      if ('added' in r) parts.push(t('admin.jobs.toast.radarr_sync', { added: r.added, updated: r.updated, duration: (r.duration / 1000).toFixed(1) }));
      else if ('imported' in r) parts.push(t('admin.jobs.toast.radarr_requests', { imported: r.imported, skipped: r.skipped }) + (r.errors ? t('admin.jobs.toast.errors', { errors: r.errors }) : ''));
    }
    if (data.sonarr) {
      const s = data.sonarr;
      if ('added' in s) parts.push(t('admin.jobs.toast.sonarr_sync', { added: s.added, updated: s.updated, duration: (s.duration / 1000).toFixed(1) }));
      else if ('imported' in s) parts.push(t('admin.jobs.toast.sonarr_requests', { imported: s.imported, skipped: s.skipped }) + (s.errors ? t('admin.jobs.toast.errors', { errors: s.errors }) : ''));
    }
    return parts.join(' — ') || JSON.stringify(data);
  };

  const runJob = async (key: string) => {
    const snapshot = jobs.find((j) => j.key === key)?.lastRunAt ?? null;
    try {
      await api.post(`/admin/jobs/${key}/run`);
      setTriggered((prev) => new Map(prev).set(key, snapshot));
      showToast({ type: 'success', message: t('admin.jobs.job_started', { key }) });
      fetchJobs();
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        showToast({ type: 'error', message: t('admin.jobs.job_already_running', { key }) });
      } else {
        showToast({ type: 'error', message: extractApiError(err, t('admin.jobs.job_failed', { key })) });
      }
    }
  };

  // Poll while any job is mid-run (server-reported `running` flag, or one we just triggered
  // and haven't seen finish yet). 3s strikes a balance between responsive UI and not hammering
  // the admin endpoint.
  useEffect(() => {
    const anyActive = jobs.some((j) => j.running) || triggered.size > 0;
    if (!anyActive) return;
    const id = setInterval(fetchJobs, 3000);
    return () => clearInterval(id);
  }, [jobs, triggered, fetchJobs]);

  // Surface the result toast when a tracked job finishes.
  useEffect(() => {
    if (triggered.size === 0) return;
    const next = new Map(triggered);
    let changed = false;
    for (const [key, snapshot] of triggered) {
      const job = jobs.find((j) => j.key === key);
      if (!job || job.running) continue;
      if (job.lastRunAt && job.lastRunAt !== snapshot) {
        next.delete(key);
        changed = true;
        if (job.lastStatus === 'success') {
          let parsed: Record<string, unknown> | null = null;
          try { parsed = job.lastResult ? JSON.parse(job.lastResult) : null; } catch { /* ignore */ }
          if (parsed && (parsed.radarr || parsed.sonarr)) {
            showToast({ type: 'success', message: formatSyncResult(parsed as Record<string, any>) });
          } else {
            showToast({ type: 'success', message: t('admin.jobs.job_done', { key }) });
          }
        } else {
          showToast({ type: 'error', message: t('admin.jobs.job_failed', { key }) });
        }
      }
    }
    if (changed) setTriggered(next);
  }, [jobs, triggered, t]);

  const toggleJob = async (job: CronJobData) => {
    try {
      await api.put(`/admin/jobs/${job.key}`, { enabled: !job.enabled });
      fetchJobs();
    } catch (err) { toastApiError(err, t('admin.jobs.toggle_failed', { key: job.key })); }
  };

  const saveCron = async (key: string, cronExpression: string) => {
    try {
      await api.put(`/admin/jobs/${key}`, { cronExpression });
      setEditingCron(null);
      fetchJobs();
    } catch (err) { toastApiError(err, t('admin.jobs.schedule_save_failed', { key })); }
  };

  if (loading) return <Spinner />;

  const cronToHuman = (expr: string) => {
    try { return cronstrue.toString(expr, { locale: i18n.language, use24HourTimeFormat: true }); }
    catch { return null; }
  };
  const formatDuration = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <AdminTabLayout title={t('admin.jobs.header.job')} count={jobs.length}>
      {/* Toast */}
      {toast && (
        <div className={clsx(
          'fixed bottom-6 right-6 z-50 max-w-lg px-5 py-3 rounded-xl shadow-2xl shadow-black/50 animate-fade-in flex items-start gap-3',
          toast.type === 'success' ? 'bg-ndp-success/10 border border-ndp-success/20 text-ndp-success' : 'bg-ndp-danger/10 border border-ndp-danger/20 text-ndp-danger'
        )}>
          {toast.type === 'success' ? <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />}
          <p className="text-sm">{toast.message}</p>
        </div>
      )}

      {/* Jobs grouped by source: system (pluginId IS NULL) vs plugin-owned. */}
      {(() => {
        const systemJobs = jobs.filter((j) => !j.pluginId);
        const pluginJobs = jobs.filter((j) => j.pluginId);
        const pluginGroups = new Map<string, CronJobData[]>();
        for (const j of pluginJobs) {
          const arr = pluginGroups.get(j.pluginId!) ?? [];
          arr.push(j);
          pluginGroups.set(j.pluginId!, arr);
        }
        const activeCount = jobs.filter((j) => j.enabled).length;
        const errorCount = jobs.filter((j) => j.lastStatus === 'error').length;
        const runningCount = jobs.filter((j) => j.running).length;
        return (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <KpiCard
                label={t('admin.jobs.kpi.total', 'Total')}
                value={jobs.length}
                hint={t('admin.jobs.kpi.total_breakdown', '{{system}} system · {{plugin}} plugin', { system: systemJobs.length, plugin: pluginJobs.length })}
              />
              <KpiCard
                label={t('admin.jobs.kpi.active', 'Active')}
                value={activeCount}
                tone="success"
              />
              <KpiCard
                label={t('admin.jobs.kpi.errors', 'Errors')}
                value={errorCount}
                tone={errorCount > 0 ? 'danger' : 'muted'}
              />
              <KpiCard
                label={t('admin.jobs.kpi.running', 'Running')}
                value={runningCount}
                tone={runningCount > 0 ? 'accent' : 'muted'}
              />
            </div>

            {/* Two-column layout: system jobs left, plugin jobs right. Collapses to a
                single column on mobile. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="space-y-3">
                <SectionHeading label={t('admin.jobs.section.system', 'System jobs')} count={systemJobs.length} />
                <div className="space-y-3">
                  {systemJobs.map((job) => renderJob(job))}
                </div>
              </section>

              <section className="space-y-3">
                <SectionHeading label={t('admin.jobs.section.plugin', 'Plugin jobs')} count={pluginJobs.length} />
                {pluginGroups.size === 0 ? (
                  <div className="card p-6 text-center text-sm text-ndp-text-dim">
                    {t('admin.jobs.section.plugin_empty', 'No plugin jobs installed.')}
                  </div>
                ) : (
                  <div className="space-y-5">
                    {[...pluginGroups.entries()].map(([pid, list]) => {
                      const meta = pluginsById.get(pid);
                      return (
                        <div key={pid} className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-xs font-medium uppercase tracking-wider text-ndp-text-dim">
                              {meta?.name ?? pid}
                            </span>
                            <span className="text-[10px] text-ndp-text-dim">{list.length}</span>
                          </div>
                          <div className="space-y-3">
                            {list.map((job) => renderJob(job))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </>
        );

        function renderJob(job: CronJobData) {
          const isEditing = editingCron?.key === job.key;
          return (
            <div key={job.key} className={clsx('card', !job.enabled && 'opacity-50')}>
              <div className="flex items-center gap-4 p-4">
                {/* Status dot */}
                <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0',
                  !job.enabled ? 'bg-ndp-text-dim' :
                  job.lastStatus === 'success' ? 'bg-ndp-success' :
                  job.lastStatus === 'error' ? 'bg-ndp-danger' :
                  'bg-ndp-text-dim'
                )} />

                {/* Job info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ndp-text">
                      {job.label.startsWith('admin.jobs.labels.') ? t(job.label) : job.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingCron.value}
                          onChange={(e) => setEditingCron({ key: job.key, value: e.target.value })}
                          className="input text-xs font-mono w-32 py-0.5 px-2"
                          onKeyDown={(e) => { if (e.key === 'Enter') saveCron(job.key, editingCron.value); if (e.key === 'Escape') setEditingCron(null); }}
                          autoFocus
                        />
                        <button onClick={() => saveCron(job.key, editingCron.value)} className="p-0.5 text-ndp-success hover:bg-ndp-success/10 rounded"><CheckCircle className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingCron(null)} className="p-0.5 text-ndp-text-dim hover:bg-white/5 rounded"><XCircle className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <button onClick={() => setEditingCron({ key: job.key, value: job.cronExpression })} className="text-xs text-ndp-text-dim hover:text-ndp-accent transition-colors flex items-center gap-1">
                        <Pencil className="w-3 h-3" />
                        {cronToHuman(job.cronExpression) || job.cronExpression}
                      </button>
                    )}
                  </div>
                </div>

                {/* Last run info */}
                <div className="hidden sm:flex items-center gap-4 text-xs text-ndp-text-dim flex-shrink-0">
                  {job.lastRunAt && (
                    <span title={localizedDateTime(job.lastRunAt)}>{localizedDateTime(job.lastRunAt)}</span>
                  )}
                  {job.lastDuration !== null && (
                    <span className="font-mono">{formatDuration(job.lastDuration)}</span>
                  )}
                  {job.lastStatus && (
                    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full',
                      job.lastStatus === 'success' ? 'bg-ndp-success/10 text-ndp-success' : 'bg-ndp-danger/10 text-ndp-danger'
                    )}>
                      {job.lastStatus === 'success' ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                      {job.lastStatus === 'success' ? t('common.ok') : t('common.error')}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button onClick={() => runJob(job.key)} disabled={!!job.running} className="p-2 text-ndp-text-dim hover:text-ndp-accent hover:bg-white/5 rounded-lg transition-colors" title={t('admin.jobs.run')}>
                    {job.running || triggered.has(job.key) ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  </button>
                  <button onClick={() => toggleJob(job)} className="p-2 text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 rounded-lg transition-colors" title={job.enabled ? t('common.disable') : t('common.enable')}>
                    <Power className={clsx('w-4 h-4', job.enabled && 'text-ndp-success')} />
                  </button>
                </div>
              </div>
            </div>
          );
        }
      })()}

      {/* Webhooks section */}
      {webhooks.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Webhook className="w-5 h-5 text-ndp-accent" />
            <h2 className="text-lg font-semibold text-ndp-text">{t('admin.jobs.webhooks_title')}</h2>
          </div>
          <p className="text-xs text-ndp-text-dim mb-4">{t('admin.jobs.webhooks_desc')}</p>

          <div className="space-y-3">
            {webhooks.map(wh => (
              <div key={wh.serviceId} className={clsx('card', !wh.enabled && 'opacity-50')}>
                <div className="flex items-center gap-4 p-4">
                  {/* Service icon */}
                  {wh.icon ? (
                    <img src={wh.icon} alt="" className="w-6 h-6 rounded-lg object-contain flex-shrink-0" />
                  ) : (
                    <Webhook className="w-5 h-5 text-ndp-text-dim flex-shrink-0" />
                  )}

                  {/* Name + event labels */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ndp-text">{wh.serviceName}</span>
                      {wh.enabled && !wh.serviceReachable && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ndp-warning/10 text-ndp-warning font-medium">
                          {t('admin.services.unreachable')}
                        </span>
                      )}
                    </div>
                    {wh.supportsWebhooks && wh.events.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {wh.events.map(ev => (
                          <span
                            key={ev.key}
                            title={ev.description}
                            className={clsx(
                              'text-[10px] font-medium px-1.5 py-0.5 rounded-md cursor-default',
                              wh.enabled ? 'bg-ndp-success/10 text-ndp-success' : 'bg-white/5 text-ndp-text-dim',
                            )}
                          >
                            {ev.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Power toggle */}
                  <button
                    onClick={async () => {
                      setWebhookLoading(wh.serviceId);
                      try {
                        if (wh.enabled) {
                          await api.post(`/admin/services/${wh.serviceId}/webhook/disable`);
                          showGlobalToast(t('admin.services.webhook_disabled_toast', { name: wh.serviceName }), 'info');
                        } else {
                          await api.post(`/admin/services/${wh.serviceId}/webhook/enable`);
                          showGlobalToast(t('admin.services.webhook_enabled_toast', { name: wh.serviceName }), 'success');
                        }
                        fetchWebhooks();
                      } catch (err) {
                        const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
                        const base = extractApiError(err, t('admin.services.webhook_failed_toast'));
                        showGlobalToast(detail ? `${base}: ${detail}` : base, 'error');
                      } finally { setWebhookLoading(null); }
                    }}
                    disabled={webhookLoading === wh.serviceId}
                    className="p-2 text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 rounded-lg transition-colors flex-shrink-0"
                    title={wh.enabled ? t('common.disable') : t('common.enable')}
                  >
                    {webhookLoading === wh.serviceId ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className={clsx('w-4 h-4', wh.enabled && 'text-ndp-success')} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </AdminTabLayout>
  );
}

function SectionHeading({ label, count }: Readonly<{ label: string; count: number }>) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ndp-text-muted">{label}</h2>
      <span className="text-xs text-ndp-text-dim">{count}</span>
    </div>
  );
}

function KpiCard({
  label, value, hint, tone = 'default',
}: Readonly<{
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'success' | 'danger' | 'accent' | 'muted';
}>) {
  const valueClass = {
    default: 'text-ndp-text',
    success: 'text-ndp-success',
    danger: 'text-ndp-danger',
    accent: 'text-ndp-accent',
    muted: 'text-ndp-text-dim',
  }[tone];
  return (
    <div className="card p-3.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-ndp-text-dim">{label}</div>
      <div className={clsx('text-2xl font-bold tabular-nums mt-1', valueClass)}>{value}</div>
      {hint && <div className="text-[11px] text-ndp-text-dim mt-0.5 truncate">{hint}</div>}
    </div>
  );
}
