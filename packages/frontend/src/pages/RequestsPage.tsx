import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Film,
  Search,
  CalendarClock,
  Trash2,
  Settings2,
  X,
  Save,
  Eraser,
  SlidersHorizontal, } from 'lucide-react';
import { clsx } from 'clsx';
import api, { posterUrl, backdropUrl } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useDownloadForMedia } from '@/hooks/useDownloads';
import { localizedDate } from '@/i18n/formatters';
import type { MediaRequest } from '@/types';
import { useModal } from '@/hooks/useModal';

const STATUS_CONFIG: Record<string, { labelKey: string; icon: typeof Clock; color: string; bg: string; dot: string }> = {
  pending: { labelKey: 'pending', icon: Clock, color: 'text-ndp-warning', bg: 'bg-ndp-warning', dot: 'bg-ndp-warning' },
  approved: { labelKey: 'approved', icon: CheckCircle, color: 'text-ndp-accent', bg: 'bg-ndp-accent', dot: 'bg-ndp-accent' },
  declined: { labelKey: 'declined', icon: XCircle, color: 'text-ndp-danger', bg: 'bg-ndp-danger', dot: 'bg-ndp-danger' },
  processing: { labelKey: 'processing', icon: Loader2, color: 'text-blue-400', bg: 'bg-ndp-accent', dot: 'bg-blue-400' },
  available: { labelKey: 'available', icon: CheckCircle, color: 'text-ndp-success', bg: 'bg-ndp-success', dot: 'bg-ndp-success' },
  searching: { labelKey: 'searching', icon: Search, color: 'text-ndp-accent', bg: 'bg-ndp-accent', dot: 'bg-ndp-accent' },
  upcoming: { labelKey: 'upcoming', icon: CalendarClock, color: 'text-purple-400', bg: 'bg-purple-500', dot: 'bg-purple-400' },
  failed: { labelKey: 'failed', icon: AlertCircle, color: 'text-ndp-danger', bg: 'bg-ndp-danger', dot: 'bg-ndp-danger' },
};

interface RequestStats {
  total: number;
  pending: number;
  approved: number;
  available: number;
  declined: number;
  failed: number;
  processing: number;
}

const FILTER_TABS = [
  { key: '', labelKey: 'requests.all' },
  { key: 'pending', labelKey: 'status.pending' },
  { key: 'approved', labelKey: 'status.approved' },
  { key: 'available', labelKey: 'status.available' },
  { key: 'declined', labelKey: 'status.declined' },
] as const;

export default function RequestsPage() {
  const { t } = useTranslation();
  const { hasPermission } = useAuth();
  const [requests, setRequests] = useState<MediaRequest[]>([]);
  const [stats, setStats] = useState<RequestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterMediaType, setFilterMediaType] = useState<string>('');
  const [filterQuality, setFilterQuality] = useState<string>('');
  const [users, setUsers] = useState<{ id: number; displayName: string }[]>([]);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [qualityOptions, setQualityOptions] = useState<{ id: number; label: string }[]>([]);
  const [showCleanup, setShowCleanup] = useState(false);
  const cleanupModal = useModal({
    open: showCleanup,
    onClose: () => setShowCleanup(false),
  });
  type CleanupAction = 'keep' | 'remove' | 'remove_with_service';
  const [cleanupActions, setCleanupActions] = useState<Record<string, CleanupAction>>({});
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ oscarr: number; service: number } | null>(null);
  const [confirmDeleteRequest, setConfirmDeleteRequest] = useState<MediaRequest | null>(null);
  const confirmDeleteModal = useModal({
    open: confirmDeleteRequest !== null,
    onClose: () => setConfirmDeleteRequest(null),
  });

  const canAccessAdmin = hasPermission('admin.*');

  useEffect(() => {
    api.get('/requests/stats').then(({ data }) => setStats(data)).catch(() => {});
    api.get('/app/quality-options').then(({ data }) => setQualityOptions(data)).catch(() => {});
    if (canAccessAdmin) api.get('/admin/users').then(({ data }) => setUsers(data.map((u: { id: number; displayName: string; email: string }) => ({ id: u.id, displayName: u.displayName || u.email })))).catch(() => {});
  }, [canAccessAdmin]);

  const fetchRequests = useCallback(async (pageNum: number, append = false) => {
    if (!append) setFiltering(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      if (filterUser) params.set('userId', filterUser);
      if (filterMediaType) params.set('mediaType', filterMediaType);
      if (filterQuality) params.set('qualityOptionId', filterQuality);
      params.set('page', String(pageNum));
      const { data } = await api.get(`/requests?${params}`);
      if (append) {
        setRequests((prev) => [...prev, ...data.results]);
      } else {
        setRequests(data.results);
      }
      setTotalPages(data.totalPages);
      setPage(pageNum);
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    } finally {
      setLoading(false);
      setFiltering(false);
      setLoadingMore(false);
    }
  }, [filter, filterUser, filterMediaType, filterQuality]);

  useEffect(() => {
    fetchRequests(1);
  }, [filter, filterUser, filterMediaType, filterQuality]);

  const loadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    fetchRequests(page + 1, true);
  }, [loadingMore, page, totalPages, fetchRequests]);

  // Infinite scroll — trigger loadMore when sentinel enters viewport
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Stable identity required — RequestCard is React.memo'd.
  const handleAction = useCallback(async (id: number, action: 'approve' | 'decline', qualityOptionId?: number) => {
    setActionLoading(id);
    try {
      await api.post(`/requests/${id}/${action}`, qualityOptionId ? { qualityOptionId } : {});
      fetchRequests(1);
      api.get('/requests/stats').then(({ data }) => setStats(data)).catch(() => {});
    } catch (err) {
      console.error(`Failed to ${action} request:`, err);
    } finally {
      setActionLoading(null);
    }
  }, [fetchRequests]);

  const handleDelete = useCallback(async (id: number) => {
    setActionLoading(id);
    try {
      await api.delete(`/requests/${id}`);
      fetchRequests(1);
      api.get('/requests/stats').then(({ data }) => setStats(data)).catch(() => {});
    } catch (err) {
      console.error('Failed to delete request:', err);
    } finally {
      setActionLoading(null);
    }
  }, [fetchRequests]);

  const onDeleteCard = useCallback((id: number) => {
    const r = requests.find((x) => x.id === id);
    if (r) setConfirmDeleteRequest(r);
  }, [requests]);

  const getStatCount = (key: string): number => {
    if (!stats) return 0;
    if (key === '') return stats.total;
    return (stats as unknown as Record<string, number>)[key] ?? 0;
  };

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-8 py-8">
      {/* Header + filter tabs */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-ndp-text">{t('requests.title')}</h1>
          {hasPermission('admin.danger') && stats && (stats.available > 0 || stats.approved > 0 || stats.declined > 0) && (
            <button
              onClick={() => { setShowCleanup(true); setCleanupActions({}); setCleanupResult(null); }}
              className="text-xs text-ndp-text-dim hover:text-ndp-text flex items-center gap-1.5 hover:bg-white/5 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Eraser className="w-3.5 h-3.5" />
              {t('requests.cleanup')}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 overflow-x-auto flex-1" style={{ scrollbarWidth: 'none' }}>
            {FILTER_TABS.map(tab => {
              const count = getStatCount(tab.key);
              const isActive = filter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  className={clsx(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors duration-200',
                    isActive
                      ? 'bg-ndp-accent text-white'
                      : 'text-ndp-text-muted hover:bg-ndp-surface-light',
                  )}
                >
                  {t(tab.labelKey)}
                  {count > 0 && (
                    <span className={clsx(
                      'text-xs px-1.5 py-0.5 rounded-md font-semibold',
                      isActive ? 'bg-white/20' : 'bg-white/5',
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Advanced filters */}
          {hasPermission('requests.approve') && (
            <RequestFilters
              filterUser={filterUser} setFilterUser={setFilterUser}
              filterMediaType={filterMediaType} setFilterMediaType={setFilterMediaType}
              filterQuality={filterQuality} setFilterQuality={setFilterQuality}
              users={users} qualityOptions={qualityOptions}
            />
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={`skel-${i}`} className="h-[200px] rounded-2xl skeleton" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-20">
          <Film className="w-16 h-16 text-ndp-text-dim mx-auto mb-4" />
          <p className="text-ndp-text-muted text-lg">{t('requests.no_requests')}</p>
          <Link to="/" className="btn-primary inline-flex items-center gap-2 mt-4">
            {t('requests.search_media')}
          </Link>
        </div>
      ) : (
        <>
          <div className={clsx('transition-opacity duration-300', filtering ? 'opacity-40' : 'opacity-100')}>
            {(() => {
              const pendingRequests = !filter ? requests.filter(r => r.status === 'pending') : [];
              const otherRequests = !filter ? requests.filter(r => r.status !== 'pending') : requests;

              return (
                <>
                  {pendingRequests.length > 0 && (
                    <div className="mb-8">
                      <h2 className="text-sm font-semibold text-ndp-warning uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {t('requests.pending_section', { count: pendingRequests.length })}
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                        {pendingRequests.map((req, index) => (
                          <RequestCard key={req.id} request={req} canApprove={hasPermission('requests.approve')} canDecline={hasPermission('requests.decline')} actionLoading={actionLoading} onAction={handleAction} onDelete={onDeleteCard} qualityOptions={qualityOptions} index={index} />
                        ))}
                      </div>
                    </div>
                  )}

                  {otherRequests.length > 0 && (
                    <div>
                      {pendingRequests.length > 0 && (
                        <h2 className="text-sm font-semibold text-ndp-text-dim uppercase tracking-wider mb-3">
                          {t('requests.processed_section')}
                        </h2>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
                        {otherRequests.map((req, index) => (
                          <RequestCard key={req.id} request={req} canApprove={hasPermission('requests.approve')} canDecline={hasPermission('requests.decline')} actionLoading={actionLoading} onAction={handleAction} onDelete={onDeleteCard} qualityOptions={qualityOptions} index={index} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 text-ndp-accent animate-spin" />
            </div>
          )}
        </>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteRequest && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setConfirmDeleteRequest(null)}
        >
          <div
            ref={confirmDeleteModal.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmDeleteModal.titleId}
            className="card p-6 max-w-sm w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id={confirmDeleteModal.titleId} className="text-lg font-bold text-ndp-text mb-2">
              {t('requests.confirm_delete_title')}
            </h3>
            <p className="text-sm text-ndp-text-muted mb-1">
              {t('requests.confirm_delete', { title: confirmDeleteRequest.media?.title || '' })}
            </p>
            <p className="text-xs text-ndp-text-dim mb-6">
              {t('requests.confirm_delete_desc')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDeleteRequest(null)} className="btn-secondary text-sm flex-1">
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  const id = confirmDeleteRequest.id;
                  setConfirmDeleteRequest(null);
                  await handleDelete(id);
                }}
                disabled={actionLoading === confirmDeleteRequest.id}
                className="btn-danger text-sm flex-1 flex items-center justify-center gap-2"
              >
                {actionLoading === confirmDeleteRequest.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Cleanup modal */}
      {showCleanup && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowCleanup(false); }}>
          <div
            ref={cleanupModal.dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={cleanupModal.titleId}
            className="bg-ndp-surface border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 id={cleanupModal.titleId} className="text-base font-bold text-ndp-text flex items-center gap-2">
                <Eraser className="w-4 h-4 text-ndp-text-muted" />
                {t('requests.cleanup_title')}
              </h3>
              <button onClick={() => setShowCleanup(false)} aria-label={t('common.close')} className="text-ndp-text-dim hover:text-ndp-text transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-ndp-text-muted mb-4">{t('requests.cleanup_desc')}</p>

            <div className="space-y-3">
              {[
                { key: 'pending', label: t('status.pending'), count: stats?.pending ?? 0, color: 'text-ndp-warning', dot: 'bg-ndp-warning' },
                { key: 'available', label: t('status.available'), count: stats?.available ?? 0, color: 'text-ndp-success', dot: 'bg-ndp-success' },
                { key: 'approved', label: t('status.approved'), count: stats?.approved ?? 0, color: 'text-ndp-accent', dot: 'bg-ndp-accent' },
                { key: 'declined', label: t('status.declined'), count: stats?.declined ?? 0, color: 'text-ndp-danger', dot: 'bg-ndp-danger' },
                { key: 'failed', label: t('status.failed'), count: stats?.failed ?? 0, color: 'text-purple-400', dot: 'bg-purple-400' },
              ].map(s => {
                const action = cleanupActions[s.key] || 'keep';
                return (
                  <div key={s.key} className="rounded-xl bg-ndp-surface-light p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={clsx('w-2 h-2 rounded-full', s.dot)} />
                      <span className={clsx('text-sm font-medium flex-1', s.color)}>{s.label}</span>
                      <span className="text-xs text-ndp-text-dim">{s.count}</span>
                    </div>
                    <div className="flex gap-1 bg-ndp-surface/60 rounded-lg p-1">
                      {(['keep', 'remove', 'remove_with_service'] as const).map(a => (
                        <button
                          key={a}
                          onClick={() => setCleanupActions(prev => ({ ...prev, [s.key]: a }))}
                          className={clsx(
                            'flex-1 text-[11px] font-medium py-1.5 rounded-md transition-all duration-200',
                            action === a
                              ? a === 'keep' ? 'bg-white/10 text-ndp-text shadow-sm'
                                : a === 'remove' ? 'bg-ndp-warning/20 text-ndp-warning shadow-sm'
                                : 'bg-ndp-danger/20 text-ndp-danger shadow-sm'
                              : 'text-ndp-text-dim hover:text-ndp-text-muted',
                          )}
                        >
                          {a === 'keep' ? t('requests.cleanup_keep')
                            : a === 'remove' ? t('requests.cleanup_remove')
                            : t('requests.cleanup_remove_service')}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {cleanupResult && (
              <div className="mt-4 p-3 rounded-xl bg-ndp-success/10 text-ndp-success text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                {t('requests.cleanup_result_detail', { oscarr: cleanupResult.oscarr, service: cleanupResult.service })}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCleanup(false)} className="btn-secondary text-sm">
                {t('common.close')}
              </button>
              <button
                onClick={async () => {
                  const hasAction = Object.values(cleanupActions).some(a => a !== 'keep');
                  if (!hasAction) return;
                  setCleanupLoading(true);
                  try {
                    const { data } = await api.post('/requests/cleanup', { actions: cleanupActions });
                    setCleanupResult({ oscarr: data.deletedFromOscarr, service: data.deletedFromService });
                    fetchRequests(1);
                    api.get('/requests/stats').then(({ data }) => setStats(data)).catch(() => {});
                  } catch (err) { console.error('Cleanup failed:', err); }
                  finally { setCleanupLoading(false); }
                }}
                disabled={!Object.values(cleanupActions).some(a => a !== 'keep') || cleanupLoading}
                className="btn-danger text-sm flex items-center gap-1.5"
              >
                {cleanupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eraser className="w-3.5 h-3.5" />}
                {t('requests.cleanup_confirm')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

interface RequestCardProps {
  request: MediaRequest;
  canApprove: boolean;
  canDecline?: boolean;
  actionLoading: number | null;
  onAction: (id: number, action: 'approve' | 'decline', qualityOptionId?: number) => void;
  onDelete: (id: number) => void;
  qualityOptions: { id: number; label: string }[];
  index: number;
}

function RequestCardInner({
  request: req,
  canApprove,
  canDecline,
  actionLoading,
  onAction,
  onDelete,
  qualityOptions,
  index,
}: RequestCardProps) {
  const { t } = useTranslation();
  const [selectedQuality, setSelectedQuality] = useState<number | undefined>(req.qualityOptionId ?? undefined);
  const [showSettings, setShowSettings] = useState(false);
  interface ResolvedCtx {
    folderPath: string | null;
    matchedRule: string | null;
    serviceName: string | null;
    qualityOption: { id: number; label: string } | null;
    seriesType: string | null;
    targetServiceId: number | null;
    availableRootFolders: { path: string }[];
    availableServices: { id: number; name: string }[];
  }
  const [resolvedCtx, setResolvedCtx] = useState<ResolvedCtx | null>(null);
  const [overridePath, setOverridePath] = useState<string>('');
  const [overrideServiceId, setOverrideServiceId] = useState<number | null>(null);
  const [useCustomPath, setUseCustomPath] = useState(false);
  const [resolvingCtx, setResolvingCtx] = useState(false);
  const download = useDownloadForMedia(req.media?.tmdbId, req.mediaType);
  const status = STATUS_CONFIG[req.status] || STATUS_CONFIG.pending;
  // Media synced from *arr webhooks without a TMDB match are stored with a
  // negative tmdbId — don't turn the card into a broken link in that case.
  const hasValidTmdbId = !!req.media?.tmdbId && req.media.tmdbId > 0;
  const mediaLink = hasValidTmdbId ? `/${req.mediaType}/${req.media!.tmdbId}` : '#';
  const year = req.media?.releaseDate?.slice(0, 4);
  const backdrop = req.media?.backdropPath;
  const isPending = req.status === 'pending';

  return (
    // Card is a <div> (not <Link>) so nested <button>s are valid HTML.
    // The clickable area is a sibling <Link className="absolute inset-0"> positioned under the
    // buttons via z-index — screen readers announce one link + the buttons independently.
    <div
      className="group relative rounded-2xl overflow-hidden min-h-[160px] flex transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/40 animate-fade-in border border-white/5"
      style={{ animationDelay: `${Math.min(index * 50, 400)}ms`, animationFillMode: 'backwards' }}
    >
      {hasValidTmdbId && (
        <Link
          to={mediaLink}
          className="absolute inset-0 z-[1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ndp-accent/60 rounded-2xl"
          aria-label={req.media?.title || t('requests.unknown_media')}
        />
      )}
{/* No left bar — status shown inline */}

      {/* Background — subtle backdrop hint */}
      <div className="absolute inset-0 bg-ndp-surface">
        {backdrop && (
          <>
            <img src={backdropUrl(backdrop, 'w300')} alt="" className="absolute right-0 top-0 h-full w-2/3 object-cover opacity-[0.07]" />
            <div className="absolute inset-0 bg-gradient-to-r from-ndp-surface via-ndp-surface/95 to-transparent" />
          </>
        )}
      </div>

      {/* Content */}
      <div className="relative flex w-full p-3.5 pointer-events-none">
        {/* Left: info */}
        <div className="flex-1 flex flex-col min-w-0 pr-3">
          <h3 className="text-base font-bold text-white leading-tight line-clamp-1 shrink-0">
            {req.media?.title || t('requests.unknown_media')}
          </h3>

          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-white/50">
            {year && <span className="text-white/70">{year}</span>}
            {year && <span>·</span>}
            <span>{localizedDate(req.createdAt)}</span>
          </div>

          <div className="flex items-center gap-1.5 mt-2">
            {req.user?.avatar ? (
              <img src={req.user.avatar} alt="" className="w-4 h-4 rounded-full ring-1 ring-white/20" />
            ) : (
              <div className="w-4 h-4 rounded-full bg-ndp-accent/30 flex items-center justify-center text-[9px] text-white font-bold">
                {(req.user?.displayName || '?')[0].toUpperCase()}
              </div>
            )}
            <span className="text-xs text-white/60 truncate">{req.user?.displayName}</span>
          </div>

          {qualityOptions.length > 0 && (
            <div className="mt-1.5">
              <span className={clsx('text-[11px] font-semibold', req.qualityOption ? 'text-ndp-accent' : 'text-ndp-text-dim')}>
                {req.qualityOption?.label || t('requests.no_quality')}
              </span>
            </div>
          )}

          {/* Status badge — hidden when pending (bottom bar shows intent) */}
          {!isPending && (
            <div className="mt-auto pt-1.5">
              <span className={clsx('inline-flex text-[11px] font-semibold px-2 py-0.5 rounded-md', status.color,
                req.status === 'available' ? 'bg-ndp-success/15' :
                req.status === 'approved' ? 'bg-ndp-accent/15' :
                req.status === 'declined' ? 'bg-ndp-danger/15' :
                'bg-white/10'
              )}>
                {t(`status.${status.labelKey}`)}
              </span>
            </div>
          )}

          {/* Download progress */}
          {download && (
            <div className="flex items-center gap-2 mt-auto pt-1.5">
              <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-ndp-accent rounded-full transition-all duration-1000" style={{ width: `${download.progress}%` }} />
              </div>
              <span className="text-[10px] text-white/50 font-mono">{Math.round(download.progress)}%</span>
            </div>
          )}
        </div>

        {/* Right: poster */}
        <div className="flex-shrink-0 w-[80px] self-center">
          <div className="aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-white/10 shadow-lg group-hover:ring-white/20 transition-all">
            {req.media?.posterPath ? (
              <img src={posterUrl(req.media.posterPath, 'w185')} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-ndp-surface-light flex items-center justify-center">
                <Film className="w-5 h-5 text-ndp-text-dim" />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Bottom action bar */}
      {isPending && (
        <div className="absolute bottom-2 left-2 right-[108px] z-10 flex items-center bg-white/[0.03] backdrop-blur-2xl border border-white/[0.07] rounded-xl" onClick={(e) => e.preventDefault()}>
          {canApprove ? (
            <>
              <button
                onClick={(e) => { e.preventDefault(); onAction(req.id, 'approve', selectedQuality); }}
                disabled={actionLoading === req.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 text-ndp-success hover:bg-ndp-success/10 transition-colors text-xs font-medium rounded-l-xl"
              >
                {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {t('requests.approve')}
              </button>
              {canDecline && (
                <>
                  <div className="w-px h-5 bg-white/10" />
                  <button
                    onClick={(e) => { e.preventDefault(); onAction(req.id, 'decline'); }}
                    disabled={actionLoading === req.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-ndp-danger hover:bg-ndp-danger/10 transition-colors text-xs font-medium"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {t('requests.decline')}
                  </button>
                </>
              )}
              <div className="w-px h-5 bg-white/10" />
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setShowSettings(true);
                  setResolvingCtx(true);
                  setUseCustomPath(false);
                  const qParam = selectedQuality ? `?qualityOptionId=${selectedQuality}` : '';
                  api.get(`/requests/${req.id}/resolve${qParam}`)
                    .then(({ data }) => { setResolvedCtx(data); setOverridePath(data.folderPath || ''); setOverrideServiceId(data.targetServiceId); })
                    .catch(() => {})
                    .finally(() => setResolvingCtx(false));
                }}
                className="px-4 py-2 text-white/50 hover:text-white hover:bg-white/5 transition-colors rounded-r-xl"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); onDelete(req.id); }}
              disabled={actionLoading === req.id}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 text-white/40 hover:text-ndp-danger hover:bg-ndp-danger/10 transition-colors text-xs font-medium"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('common.cancel')}
            </button>
          )}
        </div>
      )}

      {/* Settings modal */}
      {showSettings && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowSettings(false); }}>
          <div className="bg-ndp-surface border border-white/10 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-ndp-text flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-ndp-text-muted" />
                {t('requests.request_settings')}
              </h3>
              <button onClick={() => setShowSettings(false)} aria-label={t('common.close')} className="text-ndp-text-dim hover:text-ndp-text transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Quality selection */}
              {qualityOptions.length > 0 && (
                <div>
                  <label className="text-xs text-ndp-text-muted block mb-1.5 font-medium">{t('requests.quality_label')}</label>
                  <select
                    value={selectedQuality ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number.parseInt(e.target.value) : undefined;
                      setSelectedQuality(val);
                      setResolvingCtx(true);
                      const qParam = val ? `?qualityOptionId=${val}` : '';
                      api.get(`/requests/${req.id}/resolve${qParam}`)
                        .then(({ data }) => { setResolvedCtx(data); setOverridePath(data.folderPath || ''); setOverrideServiceId(data.targetServiceId); })
                        .catch(() => {})
                        .finally(() => setResolvingCtx(false));
                    }}
                    className="input w-full text-sm"
                  >
                    <option value="">{t('requests.no_quality')}</option>
                    {qualityOptions.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}
                  </select>
                </div>
              )}

              {/* Resolved context */}
              {resolvingCtx ? (
                <div className="flex items-center gap-2 text-sm text-ndp-text-dim py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('common.loading')}
                </div>
              ) : resolvedCtx && (
                <div className="space-y-4">
                  {/* Service */}
                  {resolvedCtx.availableServices.length > 1 && (
                    <div>
                      <label className="text-xs text-ndp-text-muted block mb-1.5 font-medium">{t('requests.target_service')}</label>
                      <select
                        value={overrideServiceId ?? ''}
                        onChange={(e) => setOverrideServiceId(e.target.value ? Number.parseInt(e.target.value) : null)}
                        className="input w-full text-sm"
                      >
                        {resolvedCtx.availableServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                  {resolvedCtx.availableServices.length <= 1 && resolvedCtx.serviceName && (
                    <div className="flex items-center justify-between bg-ndp-surface-light rounded-xl px-4 py-2.5">
                      <span className="text-xs text-ndp-text-dim">{t('requests.target_service')}</span>
                      <span className="text-sm text-ndp-text font-medium">{resolvedCtx.serviceName}</span>
                    </div>
                  )}

                  {/* Root folder */}
                  <div>
                    <label className="text-xs text-ndp-text-muted block mb-1.5 font-medium">{t('requests.root_folder')}</label>
                    {!useCustomPath ? (
                      <select
                        value={overridePath}
                        onChange={(e) => {
                          if (e.target.value === '__custom__') {
                            setUseCustomPath(true);
                            setOverridePath('');
                          } else {
                            setOverridePath(e.target.value);
                          }
                        }}
                        className="input w-full text-sm font-mono"
                      >
                        {resolvedCtx.availableRootFolders.map(f => (
                          <option key={f.path} value={f.path}>{f.path}</option>
                        ))}
                        <option value="__custom__">{t('requests.custom_path')}</option>
                      </select>
                    ) : (
                      <div className="flex gap-1.5">
                        <input
                          value={overridePath}
                          onChange={(e) => setOverridePath(e.target.value)}
                          className="input flex-1 text-sm font-mono"
                          placeholder="/custom/path"
                          autoFocus
                        />
                        <button
                          onClick={() => { setUseCustomPath(false); setOverridePath(resolvedCtx.folderPath || ''); }}
                          className="btn-secondary text-xs"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Rule match + series type info */}
                  {(resolvedCtx.matchedRule || resolvedCtx.seriesType) && (
                    <div className="bg-ndp-surface-light rounded-xl px-4 py-3 space-y-2">
                      {resolvedCtx.matchedRule && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-ndp-text-dim">{t('requests.matched_rule')}</span>
                          <span className="text-xs text-ndp-accent font-semibold">{resolvedCtx.matchedRule}</span>
                        </div>
                      )}
                      {resolvedCtx.seriesType && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-ndp-text-dim">{t('requests.series_type')}</span>
                          <span className="text-xs text-ndp-text font-medium capitalize">{resolvedCtx.seriesType}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowSettings(false)} className="btn-secondary text-sm">
                {t('common.close')}
              </button>
              <button
                onClick={async () => {
                  const updates: Record<string, unknown> = {};
                  if (overridePath && overridePath !== resolvedCtx?.folderPath) updates.rootFolder = overridePath;
                  if (selectedQuality !== (req.qualityOptionId ?? undefined)) updates.qualityOptionId = selectedQuality || null;
                  if (Object.keys(updates).length > 0) {
                    try {
                      await api.put(`/requests/${req.id}`, updates);
                    } catch (err) {
                      console.error('Failed to save request settings:', err);
                    }
                  }
                  setShowSettings(false);
                }}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                {t('common.save')}
              </button>
              <button
                onClick={async () => {
                  if (overridePath && overridePath !== resolvedCtx?.folderPath) {
                    await api.put(`/requests/${req.id}`, { rootFolder: overridePath }).catch(() => {});
                  }
                  setShowSettings(false);
                  onAction(req.id, 'approve', selectedQuality);
                }}
                disabled={actionLoading === req.id}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                {actionLoading === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                {t('requests.approve')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Request Filters Popover ─────────────────────────────────────

function RequestFilters({ filterUser, setFilterUser, filterMediaType, setFilterMediaType, filterQuality, setFilterQuality, users, qualityOptions }: {
  filterUser: string; setFilterUser: (v: string) => void;
  filterMediaType: string; setFilterMediaType: (v: string) => void;
  filterQuality: string; setFilterQuality: (v: string) => void;
  users: { id: number; displayName: string }[];
  qualityOptions: { id: number; label: string }[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const activeCount = [filterUser, filterMediaType, filterQuality].filter(Boolean).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const reset = () => { setFilterUser(''); setFilterMediaType(''); setFilterQuality(''); };

  // Active chips
  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filterUser) {
    const userName = users.find(u => String(u.id) === filterUser)?.displayName || filterUser;
    chips.push({ key: 'user', label: userName, onRemove: () => setFilterUser('') });
  }
  if (filterMediaType) {
    chips.push({ key: 'type', label: filterMediaType === 'movie' ? t('common.movie') : t('common.series'), onRemove: () => setFilterMediaType('') });
  }
  if (filterQuality) {
    const qLabel = qualityOptions.find(q => String(q.id) === filterQuality)?.label || filterQuality;
    chips.push({ key: 'quality', label: qLabel, onRemove: () => setFilterQuality('') });
  }

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {/* Chips */}
      {chips.map(chip => (
        <span key={chip.key} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 text-ndp-text-muted">
          {chip.label}
          <button onClick={chip.onRemove} className="hover:text-white transition-colors"><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}

      {/* Filter button + popover */}
      <div className="relative" ref={popoverRef}>
        <button
          onClick={() => setOpen(!open)}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
            open || activeCount > 0
              ? 'bg-ndp-accent/10 text-ndp-accent'
              : 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
          )}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          {t('filter.filters')}
          {activeCount > 0 && <span className="text-ndp-accent/70">· {activeCount}</span>}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-64 p-4 rounded-2xl bg-ndp-surface border border-white/10 shadow-2xl shadow-black/50 space-y-4 animate-fade-in z-50">
            {/* User */}
            <div>
              <label className="text-[10px] font-semibold text-ndp-text-dim uppercase tracking-wider mb-1.5 block">{t('requests.filter_all_users')}</label>
              <select
                value={filterUser}
                onChange={e => setFilterUser(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg text-xs text-ndp-text px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ndp-accent/40 appearance-none cursor-pointer"
              >
                <option value="">{t('requests.filter_all_users')}</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </div>

            {/* Media type */}
            <div>
              <label className="text-[10px] font-semibold text-ndp-text-dim uppercase tracking-wider mb-1.5 block">{t('requests.filter_all_types')}</label>
              <div className="flex gap-1.5">
                {[
                  { value: '', label: t('common.all') },
                  { value: 'movie', label: t('common.movie') },
                  { value: 'tv', label: t('common.series') },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setFilterMediaType(opt.value)}
                    className={clsx(
                      'flex-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
                      filterMediaType === opt.value ? 'bg-ndp-accent text-white' : 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality */}
            {qualityOptions.length > 0 && (
              <div>
                <label className="text-[10px] font-semibold text-ndp-text-dim uppercase tracking-wider mb-1.5 block">{t('requests.filter_all_qualities')}</label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setFilterQuality('')}
                    className={clsx(
                      'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
                      !filterQuality ? 'bg-ndp-accent text-white' : 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
                    )}
                  >
                    {t('common.all')}
                  </button>
                  {qualityOptions.map(q => (
                    <button
                      key={q.id}
                      onClick={() => setFilterQuality(String(q.id))}
                      className={clsx(
                        'px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all',
                        filterQuality === String(q.id) ? 'bg-ndp-accent text-white' : 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Reset */}
            {activeCount > 0 && (
              <button onClick={() => { reset(); setOpen(false); }} className="w-full flex items-center justify-center gap-1.5 text-xs text-ndp-text-dim hover:text-ndp-text-muted transition-colors pt-2 border-t border-white/5">
                <X className="w-3 h-3" />
                {t('filter.reset')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const RequestCard = memo(RequestCardInner);
