import { Check, CircleDashed, Clock, Download, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TmdbSeason } from '@/types';

const statusIcons = {
  complete: Check,
  downloading: Download,
  requested: Clock,
  partial: CircleDashed,
  not_available: Minus,
  not_requested: CircleDashed,
};

export type SeasonCardStatus = keyof typeof statusIcons;

export function SeasonCardInfo({ season, status }: Readonly<{
  season: TmdbSeason;
  status: SeasonCardStatus;
}>) {
  const { t } = useTranslation();
  const title = t('media.season_label', { number: season.season_number });
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
  </div>;
}
