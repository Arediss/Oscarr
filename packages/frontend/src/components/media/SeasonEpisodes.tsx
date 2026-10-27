import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, Clock, Download, Minus, HelpCircle } from 'lucide-react';
import { episodeState, episodeTitle, type EpisodeInfo } from '@/utils/episodeStatus';
import type { DownloadItem } from '@/hooks/useDownloads';

const icons = { available: Check, missing: Minus, upcoming: Calendar, downloading: Download, undated: Clock, unknown: HelpCircle };
const filters = ['all', 'available', 'missing', 'upcoming', 'downloading', 'undated', 'unknown'] as const;

export function SeasonEpisodes({ episodes, now, downloads }: Readonly<{
  episodes: EpisodeInfo[]; now: number; downloads: DownloadItem[];
}>) {
  const { t, i18n } = useTranslation();
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
    <ul className="episode-list" role="list">
      {visible.length === 0 && <li className="episode-empty py-8 text-sm text-ndp-text-muted" role="status">{t('media.explorer.empty')}</li>}
      {visible.map(ep => {
        const Icon = icons[ep.state];
        const date = ep.airDateUtc ? new Date(ep.airDateUtc) : null;
        return <li className="episode-line" key={ep.episodeNumber}>
          <span className="episode-number">E{String(ep.episodeNumber).padStart(2, '0')}</span>
          <div className="episode-info">
            <p className="text-sm font-medium break-words">{episodeTitle(ep.title, t('media.explorer.episode', { number: ep.episodeNumber }))}</p>
            <div className="episode-meta">
              {date && Number.isFinite(date.getTime()) && <time dateTime={ep.airDateUtc!}>
                {date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
              </time>}
              <span className={`episode-state episode-state-${ep.state}`}>
                <Icon size={13} aria-hidden="true" />{t(`media.explorer.${ep.state === 'available' || ep.state === 'missing' ? `state_${ep.state}` : ep.state}`)}
                {ep.state === 'downloading' && ep.download && <span>{Math.round(ep.download.progress)} %</span>}
              </span>
              {ep.hasFile && ep.quality && <span className="episode-quality">{ep.quality}</span>}
            </div>
          </div>
        </li>;
      })}
    </ul>
  </>;
}
