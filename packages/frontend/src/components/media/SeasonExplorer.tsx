import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Calendar, Check, Plus, X } from 'lucide-react';
import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import { useFeatures } from '@/context/FeaturesContext';
import { useAuth } from '@/context/AuthContext';
import { useDownloads } from '@/hooks/useDownloads';
import { useSeasonEpisodes } from '@/hooks/useSeasonEpisodes';
import { useModal } from '@/hooks/useModal';
import { episodeState, nextEpisodeDate } from '@/utils/episodeStatus';
import { fillOf, type SonarrSeasonLike } from '@/utils/seasonFill';
import type { MediaRequest, TmdbMedia, TmdbSeason } from '@/types';
import { SeasonEpisodes } from './SeasonEpisodes';
import { SeasonRequestForm } from './SeasonRequestForm';
import { SeasonPoster } from './SeasonPoster';
import './season-explorer.css';

interface Props {
  media: TmdbMedia;
  seasons: TmdbSeason[];
  sonarrSeasons: SonarrSeasonLike[];
  requests: MediaRequest[];
  qualityOptions: { id: number; label: string }[];
  activeQualityOptionIds: number[];
  blocked: boolean;
  blurred?: boolean;
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
    <div className="season-cards">
      {props.seasons.filter(season => season.season_number > 0).map(season =>
        <SeasonCard key={`${props.media.id}:${season.season_number}`} {...props} season={season} />)}
    </div>
  </section>;
}

function SeasonCard({ season, ...props }: Readonly<Props & { season: TmdbSeason }>) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { features, loading: featuresLoading } = useFeatures();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const requestButton = useRef<HTMLButtonElement>(null);
  const close = () => { setExpanded(false); setConfirming(false); };
  const { dialogRef, titleId } = useModal({ open: expanded, onClose: close });
  useEffect(() => {
    if (confirming) dialogRef.current?.querySelector<HTMLButtonElement>('form button:not([disabled])')?.focus();
  }, [confirming, dialogRef]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [expanded]);
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
  const label = t('media.season_label', { number: season.season_number });
  const counts = available !== undefined ? `${available}/${total} ${t('media.explorer.available').toLowerCase()}` : `${total} ${t('media.episodes_short')}`;

  return <article className="season-card">
    <button className="season-card-button" aria-haspopup="dialog" onClick={() => setExpanded(true)}>
      <span className="season-poster">
        <SeasonPoster posterPath={season.poster_path} seriesPosterPath={props.media.poster_path} blurred={props.blurred} />
        {complete && <span className="season-complete"><Check size={14} aria-hidden="true" />{t('media.explorer.complete')}</span>}
      </span>
      <span className="season-card-title">{label}</span>
      <span className="season-card-meta">{season.air_date?.slice(0, 4)}{season.air_date && ' · '}{total} {t('media.episodes_short')}</span>
      {available !== undefined && <span className="season-card-meta">{counts}</span>}
      {ownRequest && <span className="season-card-requested">{t('status.already_requested')}</span>}
    </button>
    {expanded && createPortal(<div className="season-dialog-backdrop" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="season-dialog"
        onClick={event => event.stopPropagation()}>
        <div className="season-dialog-heading">
          <div className="min-w-0">
            <p className="text-sm text-ndp-text-muted mb-1">{props.media.name || props.media.title}</p>
            <h2 id={titleId} className="font-bold text-xl">{label}</h2>
            <span className="season-counts">
              <span className={available ? 'text-ndp-success' : undefined}>{counts}</span>
              {complete && <span>{t('media.explorer.complete')}</span>}
              {!!missing && <span>{t('media.explorer.missing_count', { count: missing })}</span>}
              {ownRequest && <span>{t('status.already_requested')}</span>}
            </span>
            {nextDate && <span className="season-next mt-2"><Calendar size={14} aria-hidden="true" />{t('media.explorer.next', { date: new Date(nextDate).toLocaleDateString(i18n.language) })}</span>}
          </div>
          <button type="button" className="season-dialog-close" onClick={close} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button>
        </div>
        <div className="season-dialog-content">
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
        </div>
      </div>
    </div>, document.body)}
  </article>;
}
