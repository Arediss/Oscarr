import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, ChevronDown, Clock, Download, Minus, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import './season-explorer.css';

type EpisodeState = 'available' | 'missing' | 'upcoming' | 'downloading' | 'undated' | 'requested';
type Filter = 'all' | 'available' | 'missing' | 'upcoming';
interface Episode { number: number; date: string | null; state: EpisodeState }

// Deliberately illustrative. This development-only preview never calls the request API.
const scenarios: { number: number; episodes: Episode[] }[] = [
  { number: 1, episodes: Array.from({ length: 8 }, (_, i) => ({
    number: i + 1, date: `2017-10-${String(i + 3).padStart(2, '0')}`, state: 'available',
  })) },
  { number: 2, episodes: [
    { number: 1, date: '2026-09-15', state: 'available' },
    { number: 2, date: '2026-09-22', state: 'available' },
    { number: 3, date: '2026-09-29', state: 'available' },
    { number: 4, date: '2026-10-06', state: 'downloading' },
    { number: 5, date: '2026-10-13', state: 'missing' },
    { number: 6, date: '2026-10-20', state: 'upcoming' },
    { number: 7, date: '2026-10-27', state: 'upcoming' },
    { number: 8, date: null, state: 'undated' },
  ] },
];

const icons = { available: Check, missing: Minus, upcoming: Calendar, downloading: Download, undated: Clock, requested: Check };

export default function SeasonExplorerPreview() {
  const { t } = useTranslation();
  return (
    <section id="season-explorer" className="season-explorer" aria-labelledby="season-explorer-title" tabIndex={-1}>
      <div className="season-explorer-heading">
        <div>
          <h2 id="season-explorer-title" className="text-xl font-bold">{t('media.explorer.title')}</h2>
          <p className="text-sm text-ndp-text-muted mt-1">{t('media.explorer.hint')}</p>
        </div>
        <span className="season-preview-label">{t('media.explorer.preview')}</span>
      </div>
      <p className="text-xs text-ndp-text-muted mb-5">{t('media.explorer.disclaimer')}</p>
      <div className="space-y-3">
        {scenarios.map(season => <SeasonPreview key={season.number} season={season} />)}
      </div>
    </section>
  );
}

function SeasonPreview({ season }: Readonly<{ season: typeof scenarios[number] }>) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(season.number === 2);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(false);
  const [quality, setQuality] = useState('HD');
  const episodes = season.episodes.map(ep => ({ ...ep, state: requested && ep.state === 'missing' ? 'requested' as const : ep.state }));
  const count = (state: EpisodeState) => episodes.filter(ep => ep.state === state).length;
  const complete = count('available') === episodes.length;
  const visible = episodes.filter(ep => filter === 'all' || ep.state === filter);
  const panelId = `season-preview-${season.number}`;
  const formatDate = (date: string) => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

  return (
    <article className={clsx('season-panel', expanded && 'is-expanded')}>
      <h3>
        <button className="season-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={panelId}>
          <span className={clsx('season-number', complete && 'is-complete')}>
            {complete ? <Check size={20} /> : String(season.number).padStart(2, '0')}
          </span>
          <span className="season-summary">
            <span className="font-semibold text-base">{t('media.season_label', { number: season.number })}</span>
            <span className="season-counts">
              <span className="text-emerald-400">{count('available')}/{episodes.length} {t('media.explorer.available').toLowerCase()}</span>
              {complete ? <span>{t('media.explorer.complete')}</span> : (
                <>
                  <span>{t('media.explorer.missing_count', { count: count('missing') })}</span>
                  <span>{count('upcoming')} {t('media.explorer.upcoming').toLowerCase()}</span>
                </>
              )}
            </span>
          </span>
          {!complete && <span className="season-next"><Calendar size={14} />{t('media.explorer.next', { date: formatDate('2026-10-20') })}</span>}
          <ChevronDown size={18} className={clsx('shrink-0 text-ndp-text-muted transition-transform', expanded && 'rotate-180')} />
        </button>
      </h3>

      <div id={panelId} hidden={!expanded}>
        <div className="episode-filters" role="group" aria-label={t('media.explorer.filters')}>
          {(['all', 'available', 'missing', 'upcoming'] as const).map(value => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {t(`media.explorer.${value}`)} <span>{value === 'all' ? episodes.length : count(value)}</span>
            </button>
          ))}
        </div>
        <div className="episode-list">
          {visible.length === 0 && <p className="text-sm text-ndp-text-muted py-8 text-center" role="status">{t('media.explorer.empty')}</p>}
          {visible.map(ep => {
            const Icon = icons[ep.state];
            return (
              <div className="episode-line" key={ep.number}>
                <span className="episode-number">E{String(ep.number).padStart(2, '0')}</span>
                <div className="episode-info">
                  <p className="text-sm font-medium">{t('media.explorer.episode', { number: ep.number })}</p>
                  {ep.date && <p className="text-xs text-ndp-text-muted mt-1">{formatDate(ep.date)}</p>}
                </div>
                {ep.state === 'available' && <span className="episode-quality">HD · 1080p</span>}
                <span className={clsx('episode-state', `episode-state-${ep.state}`)}>
                  <Icon size={14} />{t(`media.explorer.${ep.state === 'available' || ep.state === 'missing' ? `state_${ep.state}` : ep.state}`)}
                  {ep.state === 'downloading' && <span>62 %</span>}
                </span>
              </div>
            );
          })}
        </div>

        <div className="season-footer">
          {complete ? (
            <p className="text-sm text-emerald-400 flex items-center gap-2"><Check size={16} />{t('media.explorer.complete_hint')}</p>
          ) : requested ? (
            <p className="text-sm text-emerald-400 flex items-center gap-2" role="status"><Check size={16} />{t('media.explorer.sent', { quality })}</p>
          ) : confirming ? (
            <div className="season-confirmation">
              <div><p className="font-medium text-sm">{t('media.explorer.confirm_title', { number: season.number })}</p><p className="text-xs text-ndp-text-muted mt-1">{t('media.explorer.confirm_hint')}</p></div>
              <label className="text-xs text-ndp-text-muted flex items-center gap-2">{t('media.explorer.quality')}
                <select className="bg-ndp-bg border border-white/15 rounded-lg p-2 text-ndp-text" value={quality} onChange={event => setQuality(event.target.value)}><option>HD</option><option>4K</option></select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary text-sm" onClick={() => setConfirming(false)}>{t('common.cancel')}</button>
                <button className="btn-primary text-sm" onClick={() => { setRequested(true); setConfirming(false); setFilter('all'); }}>{t('media.explorer.confirm')}</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs text-ndp-text-muted">{t('media.explorer.request_hint')}</p>
              <button className="btn-secondary text-sm flex items-center gap-2" onClick={() => setConfirming(true)}><Plus size={16} />{t('media.explorer.request')}</button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
