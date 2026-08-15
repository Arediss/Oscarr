import { useTranslation } from 'react-i18next';
import { Calendar, Clock, Film, Star, Tv } from 'lucide-react';

interface Props {
  year: string;
  runtime?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  numberOfSeasons?: number | null;
  type: 'movie' | 'tv';
  genres?: string;
}

function Item({ icon: Icon, className, children }: Readonly<{
  icon: typeof Calendar; className?: string; children: React.ReactNode;
}>) {
  return (
    <span className={`flex items-center gap-1.5${className ? ` ${className}` : ''}`}>
      <Icon className={`w-4 h-4${className ? ' fill-ndp-gold' : ''}`} />
      {children}
    </span>
  );
}

/** Year, runtime, rating, season count and genres — the facts under the title. */
export function MediaMetaBar({
  year, runtime, voteAverage, voteCount, numberOfSeasons, type, genres,
}: Readonly<Props>) {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 mt-4 text-sm text-ndp-text-muted">
        {year && <Item icon={Calendar}>{year}</Item>}
        {!!runtime && (
          <Item icon={Clock}>
            {Math.floor(runtime / 60)}h{String(runtime % 60).padStart(2, '0')}
          </Item>
        )}
        {!!voteAverage && voteAverage > 0 && (
          <Item icon={Star} className="text-ndp-gold">
            {voteAverage.toFixed(1)} ({voteCount} {t('media.votes')})
          </Item>
        )}
        {type === 'tv' && !!numberOfSeasons && (
          <Item icon={Tv}>{t('media.season', { count: numberOfSeasons })}</Item>
        )}
        <Item icon={Film}>{type === 'movie' ? t('common.movie') : t('common.series')}</Item>
      </div>

      {genres && (
        <div className="flex flex-wrap gap-2 mt-4">
          {genres.split(', ').map((g) => (
            <span key={g} className="px-3 py-1 bg-white/5 rounded-full text-xs font-medium text-ndp-text-muted">
              {g}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
