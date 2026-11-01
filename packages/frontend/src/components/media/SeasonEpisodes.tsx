import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { episodeState, type EpisodeInfo } from '@/utils/episodeStatus';
import type { DownloadItem } from '@/hooks/useDownloads';
import { EpisodeCarousel } from './EpisodeCarousel';

const filters = ['all', 'available', 'missing', 'upcoming', 'downloading', 'undated', 'unknown'] as const;

export function SeasonEpisodes({ episodes, now, downloads }: Readonly<{
  episodes: EpisodeInfo[]; now: number; downloads: DownloadItem[];
}>) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<typeof filters[number]>('all');
  const rows = episodes.map(ep => {
    const download = downloads.find(item => item.episode?.episodeNumber === ep.episodeNumber);
    return { ...ep, state: episodeState(ep, now, !!download), download };
  });
  const visible = rows.filter(ep => filter === 'all' || ep.state === filter);
  return <>
    <div className="episode-filters" role="group" aria-label={t('media.explorer.filters')}>
      {filters.filter(value => value === 'all' || value === filter || rows.some(ep => ep.state === value)).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {t(`media.explorer.${value}`)} <span>{value === 'all' ? rows.length : rows.filter(ep => ep.state === value).length}</span>
      </button>)}
    </div>
    <EpisodeCarousel key={filter} episodes={visible} />
  </>;
}
