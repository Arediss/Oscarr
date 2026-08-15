import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, Loader2, X } from 'lucide-react';
import { backdropUrl } from '@/lib/api';
import type { EpisodeInfo } from '@/hooks/useEpisodeModal';

interface TmdbSeason {
  season_number: number;
  episode_count: number;
}

interface SonarrSeason {
  seasonNumber: number;
  episodeFileCount: number;
  totalEpisodeCount: number;
}

interface Props {
  media: {
    title?: string;
    name?: string;
    backdrop_path?: string | null;
    seasons?: TmdbSeason[];
  };
  sonarrSeasons: SonarrSeason[];
  expandedSeason: number | null;
  loadingSeason: number | null;
  episodeCache: Record<number, EpisodeInfo[]>;
  nsfw: boolean;
  onToggleSeason: (seasonNumber: number) => void;
  onClose: () => void;
}

/** Overall completion across every tracked season. Null when Sonarr knows no episodes at all —
 *  a "0%" badge on an untracked series would read as a problem rather than as absence of data. */
export function overallCompletion(sonarrSeasons: SonarrSeason[]): number | null {
  const files = sonarrSeasons.reduce((sum, s) => sum + s.episodeFileCount, 0);
  const episodes = sonarrSeasons.reduce((sum, s) => sum + s.totalEpisodeCount, 0);
  return episodes === 0 ? null : Math.round((files / episodes) * 100);
}

function completionClass(pct: number): string {
  if (pct === 100) return 'bg-ndp-success/20 text-ndp-success';
  return pct > 0 ? 'bg-ndp-warning/20 text-ndp-warning' : 'bg-white/10 text-white/50';
}

export function EpisodeDetailsModal({
  media, sonarrSeasons, expandedSeason, loadingSeason, episodeCache, nsfw, onToggleSeason, onClose,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const pct = overallCompletion(sonarrSeasons);

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose}>
        <div className="bg-ndp-bg rounded-2xl w-full max-w-2xl max-h-[85vh] mx-4 shadow-2xl shadow-black/60 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Hero header with backdrop */}
          <div className="relative flex-shrink-0">
            {media.backdrop_path && (
              <img src={backdropUrl(media.backdrop_path, 'w780')} alt="" className={clsx('w-full h-36 object-cover', nsfw && 'blur-3xl scale-110')} />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-ndp-bg via-ndp-bg/60 to-transparent" />
            {/* Close button -- top right */}
            <button onClick={onClose} aria-label={t('common.close')} className="absolute top-3 right-3 p-2 text-white/60 hover:text-white rounded-xl hover:bg-black/20 backdrop-blur-sm transition-colors">
              <X className="w-5 h-5" />
            </button>
            {/* Title + availability */}
            <div className="absolute bottom-0 left-0 right-0 px-6 pb-4">
              <h2 className="text-lg font-bold text-white drop-shadow-lg">{media.title || media.name}</h2>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs text-white/60">{t('media.episodes_overview')}</p>
                {pct !== null && (
                      <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-full', completionClass(pct))}>
                        {pct}% {t('media.available_short')}
                      </span>
                    )}
              </div>
            </div>
          </div>

          {/* Seasons -- collapsible, lazy loaded */}
          <div className="overflow-y-auto flex-1">
            {(media.seasons || []).filter(s => s.season_number > 0).map((season) => {
              const sonarrSeason = sonarrSeasons.find(ss => ss.seasonNumber === season.season_number);
              const isExpanded = expandedSeason === season.season_number;
              const isLoading = loadingSeason === season.season_number;
              const episodes = episodeCache[season.season_number];
              const dlCount = sonarrSeason?.episodeFileCount ?? 0;
              const totalCount = sonarrSeason?.totalEpisodeCount ?? season.episode_count;
              const isFull = dlCount === totalCount && totalCount > 0;

              return (
                <div key={season.season_number} className={clsx(isExpanded && 'bg-white/[0.02]')}>
                  <button
                    onClick={() => onToggleSeason(season.season_number)}
                    className="w-full flex items-center justify-between px-6 py-3 hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-ndp-text">
                        {t('media.season_label', { number: season.season_number })}
                      </span>
                      <span className={clsx(
                        'text-[10px] px-2 py-0.5 rounded-full font-medium',
                        isFull ? 'bg-ndp-success/10 text-ndp-success' :
                        dlCount > 0 ? 'bg-ndp-warning/10 text-ndp-warning' :
                        'bg-white/5 text-ndp-text-dim'
                      )}>
                        {dlCount}/{totalCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isLoading && <Loader2 className="w-3.5 h-3.5 text-ndp-accent animate-spin" />}
                      <svg className={clsx('w-4 h-4 text-ndp-text-dim transition-transform duration-200', isExpanded && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  <div className={clsx(
                    'ml-8 mr-3 border-l-2 border-white/10 transition-all duration-200 ease-out overflow-hidden',
                    isExpanded ? 'max-h-[5000px] opacity-100 mb-2' : 'max-h-0 opacity-0 mb-0'
                  )}>
                  {isExpanded && (
                    <div>
                      {isLoading && !episodes ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="w-5 h-5 text-ndp-accent animate-spin" />
                        </div>
                      ) : episodes?.length === 0 ? (
                        <p className="text-sm text-ndp-text-dim text-center py-4">{t('media.no_episodes')}</p>
                      ) : episodes ? (
                        <div className="py-1">
                          {episodes.map((ep) => {
                            const aired = ep.airDateUtc ? new Date(ep.airDateUtc) <= new Date() : false;
                            return (
                              <div key={ep.episodeNumber} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                                <span className={clsx(
                                  'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0',
                                  ep.hasFile ? 'bg-ndp-success/10 text-ndp-success' :
                                  !aired ? 'bg-white/5 text-ndp-text-dim' :
                                  'bg-ndp-danger/10 text-ndp-danger'
                                )}>
                                  {ep.episodeNumber}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className={clsx('text-sm truncate', ep.hasFile ? 'text-ndp-text' : 'text-ndp-text-muted')}>
                                    {ep.title}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    {ep.airDateUtc && (
                                      <span className="text-[10px] text-ndp-text-dim">
                                        {new Date(ep.airDateUtc).toLocaleDateString()}
                                      </span>
                                    )}
                                    {ep.quality && (
                                      <span className="text-[10px] bg-ndp-accent/10 text-ndp-accent px-1.5 py-0.5 rounded">
                                        {ep.quality}
                                      </span>
                                    )}
                                    {ep.size && (
                                      <span className="text-[10px] text-ndp-text-dim">
                                        {(ep.size / 1073741824).toFixed(1)} GB
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {ep.hasFile ? (
                                  <Check className="w-4 h-4 text-ndp-success flex-shrink-0" />
                                ) : !aired ? (
                                  <Calendar className="w-4 h-4 text-ndp-text-dim flex-shrink-0" />
                                ) : (
                                  <X className="w-4 h-4 text-ndp-danger flex-shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
  );
}
