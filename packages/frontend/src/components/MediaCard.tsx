import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Star, CheckCircle, Film, Tv, Plus, Loader2, EyeOff } from 'lucide-react';
import api, { posterUrl } from '@/lib/api';
import { canRequest, type MediaStateCategory, type RequestStatus } from '@oscarr/shared';
import type { TmdbMedia } from '@/types';
import { clsx } from 'clsx';
import { useNsfwFilter } from '@/hooks/useNsfwFilter';
import { MediaStateBadge } from '@/utils/mediaStateDisplay';
import { toastApiError } from '@/utils/toast';

interface MediaCardProps {
  media: TmdbMedia;
  className?: string;
  availability?: { statusCategory: MediaStateCategory; requestStatus?: RequestStatus } | null;
  index?: number;
}

export default function MediaCard({ media, className, availability, index = 0 }: Readonly<MediaCardProps>) {
  const { t } = useTranslation();
  const { isNsfw } = useNsfwFilter();
  const [loaded, setLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const nsfw = isNsfw(media.id) && !revealed;
  const delay = Math.min(index * 50, 400); // 50ms stagger, max 400ms
  const title = media.title || media.name || 'Sans titre';
  const year = (media.release_date || media.first_air_date || '').slice(0, 4);
  const type = media.media_type || (media.title ? 'movie' : 'tv');
  const link = `/${type}/${media.id}`;

  const showRequest = !availability || canRequest(availability.statusCategory, availability.requestStatus ?? null);

  const handleRequest = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (requesting || requested) return;
    setRequesting(true);
    try {
      await api.post('/requests', { tmdbId: media.id, mediaType: type });
      setRequested(true);
    } catch (err) {
      toastApiError(err, t('status.request_send_failed'));
    }
    finally { setRequesting(false); }
  };

  return (
    // The card is a <div> wrapper so the quick-request <button> can live as a sibling of the
    // <Link> rather than inside it. <button> nested inside <a> is invalid HTML — even with
    // e.preventDefault() + e.stopPropagation() in the click handler, some browsers still
    // navigate to the anchor's href because the click event bubbles natively on the DOM
    // element, not just through React's synthetic event tree. Sibling positioning sidesteps
    // the whole problem.
    <div
      className={clsx(
        'group relative flex-shrink-0 rounded-xl overflow-hidden will-change-transform transition-[transform,box-shadow] duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/50',
        className
      )}
    >
      <Link to={link} className="block">
      {/* Poster */}
      <div className="aspect-[2/3] bg-ndp-surface-light relative">
        {media.poster_path ? (
          <img
            src={posterUrl(media.poster_path, 'w342')}
            alt={title}
            className={clsx(
              'w-full h-full object-cover transition-opacity duration-500 ease-out',
              loaded ? 'opacity-100' : 'opacity-0',
              nsfw && 'blur-xl scale-110',
            )}
            style={{ transitionDelay: loaded ? '0ms' : `${delay}ms` }}
            loading="lazy"
            onLoad={() => setLoaded(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ndp-text-dim">
            <Film className="w-10 h-10" />
          </div>
        )}
        {nsfw && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setRevealed(true); }}
            className="absolute inset-0 flex items-center justify-center cursor-pointer group/nsfw"
          >
            <div className="p-2 rounded-full bg-black/50 shadow-lg shadow-black/30 group-hover/nsfw:bg-black/70 transition-colors">
              <EyeOff className="w-5 h-5 text-white/80 group-hover/nsfw:text-white transition-colors" />
            </div>
          </button>
        )}
      </div>

      {/* Overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
        <h3 className="text-sm font-semibold text-white line-clamp-2 leading-tight">{title}</h3>
        <div className="flex items-center gap-2 mt-1">
          {year && <span className="text-xs text-ndp-text-muted">{year}</span>}
          {media.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-ndp-gold">
              <Star className="w-3 h-3 fill-ndp-gold" />
              {media.vote_average.toFixed(1)}
            </span>
          )}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-ndp-accent font-semibold mt-1">
          {type === 'movie' ? t('common.movie') : t('common.series')}
        </span>
      </div>

      {/* Top-left: media type badge (hidden on hover) */}
      <div className="absolute top-2 left-2 bg-black/75 rounded-md p-1 transition-opacity duration-300 group-hover:opacity-0">
        {type === 'movie' ? (
          <Film className="w-3 h-3 text-white/80" />
        ) : (
          <Tv className="w-3 h-3 text-white/80" />
        )}
      </div>

      {/* Top-right: rating (hidden on hover) */}
      {media.vote_average > 0 && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-black/75 px-1.5 py-0.5 rounded-md transition-opacity duration-300 group-hover:opacity-0">
          <Star className="w-3 h-3 fill-ndp-gold text-ndp-gold" />
          <span className="text-xs font-medium text-white">{media.vote_average.toFixed(1)}</span>
        </div>
      )}

      {/* Bottom-left: latest episode badge for TV */}
      {media.lastEpisodeInfo && type === 'tv' && (media.lastEpisodeInfo.season != null) && (media.lastEpisodeInfo.episode != null) && (
        <div className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-black/75 text-white transition-opacity duration-300 group-hover:opacity-0">
          S{String(media.lastEpisodeInfo.season).padStart(2, '0')}E{String(media.lastEpisodeInfo.episode).padStart(2, '0')}
        </div>
      )}

      {/* Bottom-right: availability status (hidden on hover) */}
      <MediaStateBadge
        availability={availability}
        mediaType={type}
        className="absolute bottom-2 right-2 transition-opacity duration-300 group-hover:opacity-0"
      />
      </Link>

      {/* Quick request — rendered OUTSIDE the Link so the click never bubbles to the
       *  anchor. Visible only on hover (matches the rest of the overlay), positioned
       *  absolute so it overlays the top-right of the card. */}
      {showRequest && !requested && (
        <button
          onClick={handleRequest}
          className="absolute top-2 right-2 p-1.5 bg-ndp-accent rounded-full hover:bg-ndp-accent/80 transition-colors shadow-lg opacity-0 group-hover:opacity-100 z-10"
          title={t('media.request')}
          aria-label={t('media.request')}
        >
          {requesting ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Plus className="w-4 h-4 text-white" />}
        </button>
      )}
      {requested && (
        <div className="absolute top-2 right-2 p-1.5 bg-ndp-success rounded-full shadow-lg opacity-0 group-hover:opacity-100 z-10 pointer-events-none">
          <CheckCircle className="w-4 h-4 text-white" />
        </div>
      )}
    </div>
  );
}

export function MediaCardSkeleton({ className }: Readonly<{ className?: string }>) {
  return (
    <div className={clsx('flex-shrink-0 rounded-xl overflow-hidden', className || 'w-[140px] sm:w-[160px] lg:w-[180px]')}>
      <div className="aspect-[2/3] skeleton" />
      <div className="mt-2 space-y-1.5">
        <div className="skeleton h-3 w-3/4 rounded" />
        <div className="skeleton h-2.5 w-1/2 rounded" />
      </div>
    </div>
  );
}
