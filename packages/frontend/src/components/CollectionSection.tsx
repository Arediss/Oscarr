import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, Plus, Film } from 'lucide-react';
import { clsx } from 'clsx';
import api, { posterUrl } from '@/lib/api';
import { ACTIVE_REQUEST_STATUSES, type MediaStateCategory, type RequestStatus } from '@oscarr/shared';
import { MediaStateBadge } from '@/utils/mediaStateDisplay';
import type { TmdbMedia } from '@/types';

interface Props {
  collection: { id: number; name: string; poster_path: string | null };
}

export default function CollectionSection({ collection }: Readonly<Props>) {
  const { t } = useTranslation();
  const [parts, setParts] = useState<TmdbMedia[]>([]);
  const [statuses, setStatuses] = useState<Record<string, { statusCategory: MediaStateCategory; requestStatus?: RequestStatus }>>({});
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [result, setResult] = useState<{ requested: number; skipped: number; total: number } | null>(null);

  useEffect(() => {
    api.get(`/tmdb/collection/${collection.id}`)
      .then(async ({ data }) => {
        const movies = data.parts?.map((p: TmdbMedia) => ({ ...p, media_type: 'movie' })) || [];
        setParts(movies);
        if (movies.length > 0) {
          try {
            const { data: statusData } = await api.post('/media/batch-status', {
              ids: movies.map((m: TmdbMedia) => ({ tmdbId: m.id, mediaType: 'movie' })),
            });
            setStatuses(statusData);
          } catch (err) { console.warn("[CollectionSection] batch-status item failed", err); }
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [collection.id]);

  const requestAll = async () => {
    setRequesting(true);
    try {
      const { data } = await api.post('/requests/collection', { collectionId: collection.id });
      setResult(data);
    } catch (err) { console.error(err); }
    finally { setRequesting(false); }
  };

  const availableCount = parts.filter((p) => statuses[`movie:${p.id}`]?.statusCategory === 'AVAILABLE').length;
  const handledCount = parts.filter((p) => {
    const s = statuses[`movie:${p.id}`];
    return s?.statusCategory === 'AVAILABLE' || (s?.requestStatus && (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(s.requestStatus));
  }).length;
  const totalCount = parts.length;
  const allHandled = totalCount > 0 && handledCount === totalCount;
  const allAvailable = totalCount > 0 && availableCount === totalCount;
  const someHandled = handledCount > 0 && handledCount < totalCount;

  const buttonLabel = result
    ? t('media.requested_count', { requested: result.requested, skipped: result.skipped })
    : allAvailable
    ? t('media.collection_complete')
    : allHandled
    ? t('media.collection_in_progress')
    : someHandled
    ? t('media.complete_collection', { count: totalCount - handledCount })
    : t('media.request_collection');

  return (
    <div className="mt-12 px-4 sm:px-8">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-lg font-bold text-ndp-text truncate">{collection.name}</h3>
          {!loading && (
            <span className="text-xs text-ndp-text-dim flex-shrink-0">{handledCount}/{totalCount}</span>
          )}
        </div>
        {!allAvailable && (
          <button onClick={requestAll} disabled={requesting || !!result || allHandled}
            className={clsx('text-sm flex items-center gap-2 flex-shrink-0',
              allHandled ? 'btn-secondary opacity-60 cursor-default' : result ? 'btn-success cursor-default' : someHandled ? 'btn-secondary' : 'btn-primary'
            )}>
            {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : result ? <Check className="w-4 h-4" /> : allHandled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {buttonLabel}
          </button>
        )}
        {allAvailable && (
          <span className="btn-success cursor-default text-sm flex items-center gap-2 flex-shrink-0">
            <Check className="w-4 h-4" /> {t('media.collection_complete')}
          </span>
        )}
      </div>
      {!loading && parts.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
          {parts.map((movie) => {
            const status = statuses[`movie:${movie.id}`];
            const isAvail = status?.statusCategory === 'AVAILABLE';
            const isRequested = !isAvail && status?.requestStatus && (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(status.requestStatus);
            return (
              <Link key={movie.id} to={`/movie/${movie.id}`} className="flex-shrink-0 w-[120px] group">
                <div className="aspect-[2/3] rounded-xl overflow-hidden bg-ndp-surface-light mb-1.5 relative">
                  {movie.poster_path ? (
                    <img src={posterUrl(movie.poster_path, 'w185')} alt="" className={clsx('w-full h-full object-cover group-hover:scale-105 transition-transform', !isAvail && !isRequested && status && 'opacity-50')} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Film className="w-6 h-6 text-ndp-text-dim" /></div>
                  )}
                  <MediaStateBadge availability={status} mediaType="movie" className="absolute top-1.5 right-1.5" />
                </div>
                <p className="text-xs text-ndp-text-muted truncate">{movie.title}</p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
