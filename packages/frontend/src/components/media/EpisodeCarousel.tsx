import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, Download, Minus, HelpCircle } from 'lucide-react';
import { episodeTitle, type EpisodeInfo, type EpisodeState } from '@/utils/episodeStatus';
import { episodePageAtOffset, episodePageRanges } from '@/utils/episodeCarousel';
import type { DownloadItem } from '@/hooks/useDownloads';

const icons = { available: Check, missing: Minus, upcoming: Calendar, downloading: Download, undated: Clock, unknown: HelpCircle };
type CarouselEpisode = EpisodeInfo & { state: EpisodeState; download?: DownloadItem };

export function EpisodeCarousel({ episodes }: Readonly<{ episodes: CarouselEpisode[] }>) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const currentPage = useRef(0);
  const [page, setPage] = useState(0);
  const ranges = episodePageRanges(episodes.length);
  const activePage = Math.min(page, Math.max(0, ranges.length - 1));
  const activeRange = ranges[activePage];
  const pageOffsets = () => Array.from(viewport.current?.children ?? [], child => (child as HTMLElement).offsetLeft);
  const goToPage = (next: number) => {
    const target = Math.max(0, Math.min(next, ranges.length - 1));
    viewport.current?.scrollTo({ left: pageOffsets()[target] ?? 0 });
  };

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const align = () => {
      const next = Math.min(currentPage.current, Math.max(0, element.children.length - 1));
      currentPage.current = next;
      setPage(next);
      element.scrollTo({ left: (element.children[next] as HTMLElement | undefined)?.offsetLeft ?? 0, behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [episodes.length]);

  if (!activeRange) return <p className="py-8 text-sm text-ndp-text-muted" role="status">{t('media.explorer.empty')}</p>;

  return <>
    <div id={id} ref={viewport} className="episode-carousel" tabIndex={0} role="region"
      aria-roledescription={t('media.explorer.carousel')} aria-label={t('media.explorer.episodes')}
      onScroll={() => {
        const next = episodePageAtOffset(pageOffsets(), viewport.current?.scrollLeft ?? 0);
        currentPage.current = next;
        setPage(next);
      }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const offsets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.episode-card'), card => card.offsetLeft);
          const current = episodePageAtOffset(offsets, event.currentTarget.scrollLeft);
          const next = Math.max(0, Math.min(offsets.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)));
          event.currentTarget.scrollTo({ left: offsets[next] });
          return;
        }
        const next = { PageUp: activePage - 1, PageDown: activePage + 1, Home: 0, End: ranges.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        goToPage(next);
      }}>
      {ranges.map(({ start, end }) => <ul key={start} className="episode-page" role="list" style={{ '--episode-count': end - start } as CSSProperties}
        aria-label={t('media.explorer.episode_range', { from: episodes[start].episodeNumber, to: episodes[end - 1].episodeNumber })}>
        {episodes.slice(start, end).map(ep => {
          const Icon = icons[ep.state];
          const date = ep.airDateUtc ? new Date(ep.airDateUtc) : null;
          const title = episodeTitle(ep.title, t('media.explorer.episode', { number: ep.episodeNumber }));
          return <li className="episode-card" key={ep.episodeNumber}>
            <span className="episode-number">E{String(ep.episodeNumber).padStart(2, '0')}</span>
            <p className="episode-title" title={title}>{title}</p>
            <div className="episode-meta">
              <span className={`episode-state episode-state-${ep.state}`}>
                <Icon size={13} aria-hidden="true" />{t(`media.explorer.${ep.state === 'available' || ep.state === 'missing' ? `state_${ep.state}` : ep.state}`)}
                {ep.state === 'downloading' && ep.download && <span>{Math.round(ep.download.progress)} %</span>}
              </span>
              {date && Number.isFinite(date.getTime()) && <time dateTime={ep.airDateUtc!}>
                {date.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
              </time>}
              {ep.hasFile && ep.quality && <span className="episode-quality">{ep.quality}</span>}
            </div>
          </li>;
        })}
      </ul>)}
    </div>
    <div className="episode-navigation">
      {ranges.length > 1 && <div className="episode-navigation-controls" role="group" aria-label={t('media.explorer.navigate_episodes')}>
        <button type="button" className="episode-arrow" disabled={activePage === 0} onClick={() => goToPage(activePage - 1)} aria-controls={id} aria-label={t('media.explorer.previous_episodes')}><ChevronLeft size={18} aria-hidden="true" /></button>
        <div className="episode-pages">
          {ranges.map(({ start, end }, index) => <button type="button" key={start} className="episode-page-button"
            aria-current={activePage === index ? 'true' : undefined} aria-controls={id}
            aria-label={t('media.explorer.go_episode_range', { from: episodes[start].episodeNumber, to: episodes[end - 1].episodeNumber })}
            onClick={() => goToPage(index)}><span aria-hidden="true" /></button>)}
        </div>
        <button type="button" className="episode-arrow" disabled={activePage === ranges.length - 1} onClick={() => goToPage(activePage + 1)} aria-controls={id} aria-label={t('media.explorer.next_episodes')}><ChevronRight size={18} aria-hidden="true" /></button>
      </div>}
      <p className="episode-position" aria-live="polite" aria-atomic="true">{t('media.explorer.episode_position', { from: activeRange.start + 1, to: activeRange.end, count: episodes.length })}</p>
    </div>
  </>;
}
