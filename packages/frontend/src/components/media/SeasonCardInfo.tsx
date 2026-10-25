import { Check, CircleDashed, Clock, Download, HelpCircle, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TmdbSeason } from '@/types';
import type { SonarrSeasonLike } from '@/utils/seasonFill';

const statusIcons = {
  complete: Check,
  downloading: Download,
  requested: Clock,
  partial: CircleDashed,
  not_available: Minus,
  not_requested: CircleDashed,
};

export type SeasonCardStatus = keyof typeof statusIcons;

export function SeasonCardInfo({ season, sonarr, status }: Readonly<{
  season: TmdbSeason;
  sonarr?: SonarrSeasonLike;
  status: SeasonCardStatus;
}>) {
  const { t } = useTranslation();
  const title = t('media.season_label', { number: season.season_number });
  const total = sonarr?.totalEpisodeCount || season.episode_count;
  const known = !!sonarr && total > 0;
  const available = known ? Math.min(total, Math.max(0, sonarr.episodeFileCount)) : 0;
  const StatusIcon = statusIcons[status];

  return <div className="season-card-info">
    <h3 className="season-card-title">{title}</h3>
    <p className="season-card-meta">
      {season.air_date && <><span>{season.air_date.slice(0, 4)}</span><span aria-hidden="true">·</span></>}
      <span>{t('calendar.episode_count', { count: season.episode_count })}</span>
    </p>
    <span className={`season-card-status season-status-${status}`}>
      <StatusIcon size={12} aria-hidden="true" />
      {t(`media.explorer.${status === 'partial' ? 'partial_short' : status}`)}
    </span>
    <div className="season-card-availability">
      {known ? <>
        <div className="season-card-availability-label">
          <span>{t('media.explorer.available')}</span>
          <span className="season-card-count"><strong>{available}</strong><span> / {total}</span></span>
        </div>
        <progress className="season-card-progress" value={available} max={total}
          aria-label={`${title} — ${t('media.explorer.available')}`}
          aria-valuetext={t('media.explorer.available_episodes', { available, total })} />
      </> : <p className="season-card-unknown"><HelpCircle size={12} aria-hidden="true" />{t('media.explorer.unknown')}</p>}
    </div>
  </div>;
}
