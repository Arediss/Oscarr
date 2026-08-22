import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { fillOf, type Fill, type TmdbSeasonLike as TmdbSeason, type SonarrSeasonLike as SonarrSeason } from '@/utils/seasonFill';

interface Props {
  seasons: TmdbSeason[];
  sonarrSeasons: SonarrSeason[];
  selectedSeasons: number[];
  setSelectedSeasons: (updater: (prev: number[]) => number[]) => void;
  /** False only while the user's own request is in flight. Whole-series availability is
   *  deliberately not considered here — individual seasons decide for themselves. */
  canSelect: boolean;
  onOpenDetails: () => void;
}

const FILL_CLASS: Record<Fill, string> = {
  full: 'bg-ndp-success/10 text-ndp-success border border-ndp-success/20 cursor-default',
  partial: 'bg-ndp-warning/10 text-ndp-warning border border-ndp-warning/20 hover:bg-ndp-warning/20',
  empty: 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
  unknown: 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
};

export function SeasonsPicker({
  seasons, sonarrSeasons, selectedSeasons, setSelectedSeasons, canSelect, onOpenDetails,
}: Readonly<Props>) {
  const { t } = useTranslation();
  // Season 0 is the specials bucket; it is never requestable on its own.
  const real = seasons.filter((s) => s.season_number > 0);
  if (real.length === 0) return null;

  const tracked = sonarrSeasons.length > 0;
  const allSelected = selectedSeasons.length === real.length;

  const toggle = (num: number) => setSelectedSeasons((prev) =>
    prev.includes(num) ? prev.filter((s) => s !== num) : [...prev, num]
  );

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-ndp-text-muted uppercase tracking-wider">
          {tracked ? t('media.seasons') : t('media.seasons_to_request')}
        </h3>
        {tracked && (
          <button onClick={onOpenDetails} className="text-xs text-ndp-accent hover:text-ndp-accent/80 transition-colors">
            {t('media.more_details')}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {canSelect && (
          <button
            onClick={() => setSelectedSeasons((prev) => (prev.length === real.length ? [] : real.map((s) => s.season_number)))}
            className={clsx(
              'px-4 py-2 rounded-xl text-sm font-semibold transition-all',
              allSelected
                ? 'bg-ndp-accent text-white'
                : 'bg-white/5 text-ndp-text-muted hover:bg-white/10 border border-dashed border-white/10',
            )}
          >
            {t('media.all_seasons')}
          </button>
        )}

        {real.map((season) => {
          const sonarr = sonarrSeasons.find((ss) => ss.seasonNumber === season.season_number);
          const fill = fillOf(season, sonarr);
          const selected = selectedSeasons.includes(season.season_number);
          // A complete season has nothing left to ask for.
          const selectable = canSelect && fill !== 'full';

          return (
            <button
              key={season.season_number}
              onClick={() => selectable && toggle(season.season_number)}
              className={clsx(
                'px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2',
                selected ? 'bg-ndp-accent text-white' : FILL_CLASS[fill],
              )}
            >
              S{String(season.season_number).padStart(2, '0')}
              <span className="text-xs opacity-60">
                {sonarr
                  ? `${sonarr.episodeFileCount}/${sonarr.totalEpisodeCount || season.episode_count}`
                  : `${season.episode_count} ${t('media.episodes_short')}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
