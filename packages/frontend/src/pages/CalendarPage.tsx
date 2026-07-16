import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Film, Tv, CheckCircle, Loader2, LayoutGrid, List } from 'lucide-react';
import { clsx } from 'clsx';
import { Link } from 'react-router-dom';
import { posterUrl } from '@/lib/api';
import { localizedDate, localizedTime } from '@/i18n/formatters';
import { useCalendar, type CalendarItem } from '@/hooks/useCalendar';

type ViewMode = 'grid' | 'list';

function extractPosterPath(url: string | null): string | null {
  if (!url) return null;
  const match = /\/t\/p\/\w+(\/.+?)(?:\?|$)/.exec(url);
  return match ? match[1] : url.startsWith('http') ? url : null;
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PAST_DAYS = 0;
const FUTURE_DAYS = 5;

function getStoredView(): ViewMode {
  return (localStorage.getItem('calendar-view') as ViewMode) || 'grid';
}

export default function CalendarPage() {
  const { t, i18n } = useTranslation();
  const { items, loading } = useCalendar(30);
  const [view, setView] = useState<ViewMode>(getStoredView);

  const switchView = (v: ViewMode) => {
    setView(v);
    localStorage.setItem('calendar-view', v);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayKey = toDateKey(today);
  const lang = i18n.language;

  // Build day columns
  const columns: { date: Date; key: string; isPast: boolean; isToday: boolean }[] = [];
  for (let i = -PAST_DAYS; i <= FUTURE_DAYS; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    columns.push({ date: d, key: toDateKey(d), isPast: i < 0, isToday: i === 0 });
  }

  // Group + dedup episodes (clone to avoid mutating state)
  const grouped: Record<string, CalendarItem[]> = {};
  for (const item of items) {
    const d = new Date(item.date);
    if (Number.isNaN(d.getTime())) continue; // skip invalid dates
    const key = toDateKey(d);
    if (!grouped[key]) grouped[key] = [];
    if (item.type === 'episode' && item.tmdbId != null) {
      const existing = grouped[key].find(i => i.type === 'episode' && i.tmdbId === item.tmdbId);
      if (existing) {
        existing.episodeCount = (existing.episodeCount || 1) + 1;
        continue;
      }
    }
    grouped[key].push({ ...item }); // clone
  }

  // For list view: all days from today onward that have items
  const listDays = Object.keys(grouped)
    .filter(key => key >= todayKey)
    .sort((a, b) => a.localeCompare(b));

  return (
    <div className="max-w-[1800px] mx-auto px-4 sm:px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-ndp-accent" />
          <h1 className="text-2xl font-bold text-ndp-text">{t('calendar.title')}</h1>
        </div>
        <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => switchView('grid')}
            className={clsx(
              'p-2 rounded-lg transition-all',
              view === 'grid' ? 'bg-ndp-accent text-white' : 'text-ndp-text-dim hover:text-ndp-text-muted',
            )}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => switchView('list')}
            className={clsx(
              'p-2 rounded-lg transition-all',
              view === 'list' ? 'bg-ndp-accent text-white' : 'text-ndp-text-dim hover:text-ndp-text-muted',
            )}
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-ndp-accent animate-spin" />
        </div>
      ) : view === 'grid' ? (
        <GridView columns={columns} grouped={grouped} lang={lang} t={t} />
      ) : (
        <ListView days={listDays} grouped={grouped} todayKey={todayKey} t={t} />
      )}
    </div>
  );
}

// ─── Grid View (columns) ─────────────────────────────────────────────

function GridView({ columns, grouped, lang, t }: {
  columns: { date: Date; key: string; isPast: boolean; isToday: boolean }[];
  grouped: Record<string, CalendarItem[]>;
  lang: string;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <div className="pb-8">
      <div className="flex gap-3 w-full">
        {columns.map((col, colIndex) => {
          const dayName = col.date.toLocaleDateString(lang, { weekday: 'short' });
          const dayNum = col.date.getDate();
          const monthName = col.date.toLocaleDateString(lang, { month: 'short' });
          const dayItems = grouped[col.key] || [];
          const count = dayItems.length;
          const futureIndex = colIndex - PAST_DAYS;
          const futureOpacity = col.isPast ? 0.4 : col.isToday ? 1 : Math.max(0.6, 1 - futureIndex * 0.06);

          return (
            <div
              key={col.key}
              className={clsx(
                'flex flex-col gap-2 rounded-2xl p-2 transition-all',
                col.isToday && 'bg-ndp-accent/[0.06]',
              )}
              style={{
                flex: '1 1 0%',
                minWidth: 0,
                opacity: futureOpacity,
              }}
            >
              <div className={clsx(
                'rounded-xl px-3 py-3 text-center',
                col.isToday ? 'bg-ndp-accent/10 border border-ndp-accent/30' : 'border border-transparent',
              )}>
                <p className={clsx('text-[10px] uppercase tracking-wider font-semibold', col.isToday ? 'text-ndp-accent' : 'text-ndp-text-dim')}>
                  {col.isToday ? t('calendar.today') : dayName}
                </p>
                <p className={clsx('text-2xl font-bold mt-0.5', col.isToday ? 'text-ndp-accent' : 'text-ndp-text')}>
                  {dayNum}
                </p>
                <p className={clsx('text-[10px] uppercase', col.isToday ? 'text-ndp-accent/70' : 'text-ndp-text-dim')}>
                  {monthName}
                </p>
                {count > 0 && (
                  <p className={clsx('text-[10px] font-medium mt-1', col.isToday ? 'text-ndp-accent' : 'text-ndp-text-dim')}>
                    {count} {count === 1 ? t('calendar.release_one', 'sortie') : t('calendar.release_other', 'sorties')}
                  </p>
                )}
              </div>

              {dayItems.length === 0 ? (
                <div className="flex-1 rounded-xl border border-dashed border-white/5 flex items-center justify-center min-h-[80px]">
                  <span className="text-[10px] text-ndp-text-dim/30">—</span>
                </div>
              ) : (
                dayItems.map((item, i) => (
                  <CompactCard key={`${item.type}-${item.tmdbId ?? item.tvdbId ?? 0}-${item.season ?? 0}-${item.episode ?? 0}`} item={item} />
                ))
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── List View (day by day, horizontal cards) ────────────────────────

function ListView({ days, grouped, todayKey, t }: {
  days: string[];
  grouped: Record<string, CalendarItem[]>;
  todayKey: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-10 pb-16">
      {days.map((dateKey) => {
        const dayItems = grouped[dateKey] || [];
        if (dayItems.length === 0) return null;
        const isToday = dateKey === todayKey;
        const dateLabel = localizedDate(dateKey, { weekday: 'long', day: 'numeric', month: 'long' });

        return (
          <section key={dateKey}>
            <div className="flex items-center gap-3 mb-5">
              <h2 className={clsx('text-base font-bold capitalize', isToday ? 'text-ndp-accent' : 'text-ndp-text')}>
                {isToday ? t('calendar.today') : dateLabel}
              </h2>
              {isToday && (
                <span className="text-[10px] bg-ndp-accent/10 text-ndp-accent px-2 py-0.5 rounded-full font-semibold">
                  {t('calendar.release_count', { count: dayItems.length })}
                </span>
              )}
              <div className="flex-1 h-px bg-white/5" />
            </div>

            <div className="flex gap-3 overflow-x-auto py-4 -my-4" style={{ scrollbarWidth: 'none', overflowY: 'visible', clipPath: 'inset(-100px 0)' }}>
              {dayItems.map((item, i) => (
                <PosterCard key={`${item.type}-${item.tmdbId ?? item.tvdbId ?? 0}-${item.season ?? 0}-${item.episode ?? 0}`} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ─── Compact Card (grid view) ────────────────────────────────────────

function CompactCard({ item }: { item: CalendarItem }) {
  const { t } = useTranslation();
  const poster = extractPosterPath(item.poster);
  const link = item.tmdbId && item.tmdbId > 0
    ? item.type === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`
    : null;
  const isEpisode = item.type === 'episode';
  const epLabel = item.episodeCount && item.episodeCount > 1
    ? t('calendar.episode_count', { count: item.episodeCount })
    : isEpisode && item.season != null && item.episode != null
      ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
      : null;

  const inner = (
    <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-colors">
      <div className="w-11 h-16 rounded-lg overflow-hidden bg-ndp-surface-light flex-shrink-0 shadow-md shadow-black/20">
        {poster ? (
          <img src={posterUrl(poster, 'w92')} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {item.type === 'movie' ? <Film className="w-3 h-3 text-ndp-text-dim" /> : <Tv className="w-3 h-3 text-ndp-text-dim" />}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ndp-text truncate leading-tight">{item.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {epLabel && <span className="text-[10px] font-medium text-ndp-accent">{epLabel}</span>}
          <span className="text-[10px] text-ndp-text-dim">{localizedTime(item.date, { hour: '2-digit', minute: '2-digit' })}</span>
          {item.hasFile && <CheckCircle className="w-2.5 h-2.5 text-ndp-success flex-shrink-0" />}
        </div>
      </div>
    </div>
  );

  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>;
}

// ─── Poster Card (list view) ─────────────────────────────────────────

function PosterCard({ item }: { item: CalendarItem }) {
  const { t } = useTranslation();
  const poster = extractPosterPath(item.poster);
  const link = item.tmdbId && item.tmdbId > 0
    ? item.type === 'movie' ? `/movie/${item.tmdbId}` : `/tv/${item.tmdbId}`
    : null;
  const isEpisode = item.type === 'episode';
  const epLabel = item.episodeCount && item.episodeCount > 1
    ? t('calendar.episode_count', { count: item.episodeCount })
    : isEpisode && item.season != null && item.episode != null
      ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
      : null;

  const inner = (
    <div className="group relative flex-shrink-0 w-[160px] rounded-xl overflow-hidden transition-all duration-300 hover:scale-105 hover:z-10 hover:shadow-2xl hover:shadow-black/50">
      <div className="aspect-[2/3] bg-ndp-surface-light">
        {poster ? (
          <img src={posterUrl(poster, 'w185')} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ndp-text-dim">
            {item.type === 'movie' ? <Film className="w-8 h-8" /> : <Tv className="w-8 h-8" />}
          </div>
        )}
      </div>

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-2.5">
        <h3 className="text-[11px] font-semibold text-white line-clamp-2 leading-tight">{item.title}</h3>
        {isEpisode && item.episodeTitle && (
          <p className="text-[9px] text-ndp-text-muted mt-0.5 line-clamp-1">{item.episodeTitle}</p>
        )}
        <span className="text-[10px] uppercase tracking-wider text-ndp-accent font-semibold mt-1">
          {item.type === 'movie' ? t('common.movie') : t('common.series')}
        </span>
      </div>

      {/* Type badge */}
      <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-md p-1">
        {item.type === 'movie' ? <Film className="w-3 h-3 text-white/80" /> : <Tv className="w-3 h-3 text-white/80" />}
      </div>

      {/* Episode badge */}
      {epLabel && (
        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-1.5 h-5 flex items-center rounded-md">
          <span className="text-[11px] font-semibold text-white leading-none">{epLabel}</span>
        </div>
      )}

      {/* Available */}
      {item.hasFile && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-ndp-success/80 px-1.5 h-5 rounded-md backdrop-blur-sm">
          <CheckCircle className="w-3 h-3 text-white" />
        </div>
      )}

      {/* Time */}
      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm px-1.5 h-5 flex items-center rounded-md">
        <span className="text-[11px] font-medium text-white leading-none">
          {localizedTime(item.date, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );

  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>;
}
