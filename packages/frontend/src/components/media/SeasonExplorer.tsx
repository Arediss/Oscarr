import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, ChevronDown, Plus } from 'lucide-react';
import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import { useFeatures } from '@/context/FeaturesContext';
import { useAuth } from '@/context/AuthContext';
import { useDownloads } from '@/hooks/useDownloads';
import { useSeasonEpisodes } from '@/hooks/useSeasonEpisodes';
import { episodeState, nextEpisodeDate } from '@/utils/episodeStatus';
import { fillOf, type SonarrSeasonLike, type TmdbSeasonLike } from '@/utils/seasonFill';
import type { MediaRequest, TmdbMedia } from '@/types';
import { SeasonEpisodes } from './SeasonEpisodes';
import { SeasonRequestForm } from './SeasonRequestForm';
import './season-explorer.css';

interface Props {
  media: TmdbMedia;
  seasons: TmdbSeasonLike[];
  sonarrSeasons: SonarrSeasonLike[];
  requests: MediaRequest[];
  qualityOptions: { id: number; label: string }[];
  activeQualityOptionIds: number[];
  blocked: boolean;
  onRefresh: () => Promise<void>;
}

function coversSeason(request: MediaRequest, number: number) {
  if (!request.seasons) return true;
  try {
    const seasons: unknown = JSON.parse(request.seasons);
    return !Array.isArray(seasons) || seasons.length === 0 || seasons.includes(number);
  } catch { return true; }
}

export default function SeasonExplorer(props: Readonly<Props>) {
  const { t } = useTranslation();
  return <section id="season-explorer" className="season-explorer" aria-labelledby="season-explorer-title" tabIndex={-1}>
    <div className="season-explorer-heading">
      <div>
        <h2 id="season-explorer-title" className="text-xl font-bold">{t('media.explorer.title')}</h2>
        <p className="text-sm text-ndp-text-muted mt-1">{t('media.explorer.hint')}</p>
      </div>
    </div>
    <div className="space-y-3 mt-5">
      {props.seasons.filter(season => season.season_number > 0).map(season =>
        <SeasonPanel key={`${props.media.id}:${season.season_number}`} {...props} season={season} />)}
    </div>
  </section>;
}

function SeasonPanel({ season, ...props }: Readonly<Props & { season: TmdbSeasonLike }>) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { features, loading: featuresLoading } = useFeatures();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const requestButton = useRef<HTMLButtonElement>(null);
  const { episodes, loading, error, now, retry } = useSeasonEpisodes(props.media.id, season.season_number, expanded);
  const downloads = useDownloads().filter(item => item.tmdbId === props.media.id && item.mediaType === 'tv' && item.episode?.seasonNumber === season.season_number);
  const sonarr = props.sonarrSeasons.find(item => item.seasonNumber === season.season_number);
  const knownEpisodes = episodes && episodes.length > 0 ? episodes : null;
  const available = knownEpisodes ? knownEpisodes.filter(ep => ep.hasFile).length : sonarr?.episodeFileCount;
  const total = knownEpisodes?.length ?? (sonarr?.totalEpisodeCount || season.episode_count);
  const complete = knownEpisodes ? available === total : fillOf(season, sonarr) === 'full';
  const nextDate = knownEpisodes ? nextEpisodeDate(knownEpisodes, now) : null;
  const missing = knownEpisodes?.filter(ep => episodeState(ep, now, downloads.some(item => item.episode?.episodeNumber === ep.episodeNumber)) === 'missing').length;
  const activeRequests = props.requests.filter(request => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status) && coversSeason(request, season.season_number));
  const ownRequest = activeRequests.some(request => request.userId === user?.id);
  const takenQualityIds = new Set([
    ...activeRequests.map(request => request.qualityOptionId).filter((id): id is number => id !== null),
    ...(complete ? props.activeQualityOptionIds : []),
  ]);
  const defaultAllowed = !complete && !ownRequest;
  const requestAccess = !featuresLoading && features.requestsEnabled && !props.blocked;
  const canRequest = requestAccess
    && (defaultAllowed || props.qualityOptions.some(option => !takenQualityIds.has(option.id)));
  const panelId = `season-${props.media.id}-${season.season_number}`;

  return <article className={`season-panel ${expanded ? 'is-expanded' : ''}`}>
    <h3><button className="season-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
      <span className={`season-number ${complete ? 'is-complete' : ''}`}>{complete ? <Check size={20} aria-hidden="true" /> : String(season.season_number).padStart(2, '0')}</span>
      <span className="season-summary">
        <span className="font-semibold text-base">{t('media.season_label', { number: season.season_number })}</span>
        <span className="season-counts">
          <span className={available ? 'text-ndp-success' : undefined}>{available !== undefined ? `${available}/${total} ${t('media.explorer.available').toLowerCase()}` : `${total} ${t('media.episodes_short')}`}</span>
          {complete && <span>{t('media.explorer.complete')}</span>}
          {!!missing && <span>{t('media.explorer.missing_count', { count: missing })}</span>}
          {ownRequest && <span>{t('status.already_requested')}</span>}
        </span>
      </span>
      {nextDate && <span className="season-next"><Calendar size={14} aria-hidden="true" />{t('media.explorer.next', { date: new Date(nextDate).toLocaleDateString(i18n.language) })}</span>}
      <ChevronDown size={18} aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button></h3>
    <div id={panelId} hidden={!expanded}>
      {expanded && <>
        {loading && !episodes && <p className="p-5 text-sm text-ndp-text-muted" role="status">{t('common.loading')}</p>}
        {error && <div className="p-5 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ndp-text-muted" role="status">{t(`media.explorer.${error}`)}</p>
          <button type="button" className="btn-secondary text-sm" onClick={retry} disabled={loading}>{t('media.explorer.refresh')}</button>
        </div>}
        {episodes && <SeasonEpisodes episodes={episodes} now={now} downloads={downloads} />}
        <div className="season-footer">
          {requestAccess && confirming ? <SeasonRequestForm media={props.media} seasonNumber={season.season_number}
            qualityOptions={props.qualityOptions} takenQualityIds={takenQualityIds} defaultAllowed={defaultAllowed}
            onRefresh={props.onRefresh} onCancel={() => { setConfirming(false); requestAnimationFrame(() => requestButton.current?.focus()); }} /> : <>
            <p className="text-xs text-ndp-text-muted">{t(!features.requestsEnabled ? 'media.explorer.disabled' : props.blocked ? 'media.blocked' : complete ? 'media.explorer.complete_hint' : ownRequest ? 'status.already_requested' : 'media.explorer.request_hint')}</p>
            {canRequest && <button ref={requestButton} className="btn-secondary text-sm flex items-center gap-2" onClick={() => setConfirming(true)}><Plus size={16} aria-hidden="true" />{t('media.explorer.request')}</button>}
          </>}
        </div>
      </>}
    </div>
  </article>;
}
