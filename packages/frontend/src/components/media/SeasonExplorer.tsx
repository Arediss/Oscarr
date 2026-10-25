import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SeasonQuickRequest, type SeasonRequestResult } from './SeasonQuickRequest';
import { ACTIVE_REQUEST_STATUSES } from '@oscarr/shared';
import { useFeatures } from '@/context/FeaturesContext';
import { useAuth } from '@/context/AuthContext';
import { useDownloads } from '@/hooks/useDownloads';
import { fillOf, type SonarrSeasonLike } from '@/utils/seasonFill';
import type { MediaRequest, TmdbMedia, TmdbSeason } from '@/types';
import { SeasonPanel } from './SeasonPanel';
import { SeasonPoster } from './SeasonPoster';
import { SeasonCardInfo, type SeasonCardStatus } from './SeasonCardInfo';
import './season-explorer.css';

export interface SeasonExplorerProps {
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

export interface SeasonRequestState {
  complete: boolean;
  ownRequest: boolean;
  takenQualityIds: Set<number>;
  defaultAllowed: boolean;
  canRequest: boolean;
}

function coversSeason(request: MediaRequest, number: number) {
  if (!request.seasons) return true;
  try {
    const seasons: unknown = JSON.parse(request.seasons);
    return !Array.isArray(seasons) || seasons.length === 0 || seasons.includes(number);
  } catch { return true; }
}

export default function SeasonExplorer(props: Readonly<SeasonExplorerProps>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { features, loading } = useFeatures();
  const downloads = useDownloads().filter(item => item.tmdbId === props.media.id && item.mediaType === 'tv');
  const [selection, setSelection] = useState<{ number: number; requesting: boolean } | null>(null);
  const [submitted, setSubmitted] = useState<Record<number, SeasonRequestResult>>({});
  const opener = useRef<HTMLButtonElement | null>(null);
  const requestAccess = !loading && features.requestsEnabled && !props.blocked;
  const seasons = props.seasons.filter(season => season.season_number > 0).map(season => {
    const sonarr = props.sonarrSeasons.find(item => item.seasonNumber === season.season_number);
    const complete = fillOf(season, sonarr) === 'full';
    const activeRequests = props.requests.filter(request => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status) && coversSeason(request, season.season_number));
    const ownRequest = !!submitted[season.season_number] || activeRequests.some(request => request.userId === user?.id);
    const takenQualityIds = new Set([
      ...activeRequests.map(request => request.qualityOptionId).filter((id): id is number => id !== null),
      ...(complete ? props.activeQualityOptionIds : []),
    ]);
    const defaultAllowed = !complete && !ownRequest;
    const canRequest = requestAccess && (defaultAllowed || props.qualityOptions.some(option => !takenQualityIds.has(option.id)));
    const downloading = downloads.some(item => item.episode?.seasonNumber === season.season_number);
    const status: SeasonCardStatus = complete ? 'complete' : downloading ? 'downloading' : ownRequest || activeRequests.length ? 'requested'
      : sonarr?.episodeFileCount ? 'partial' : sonarr ? 'not_available' : 'not_requested';
    return { season, status, state: { complete, ownRequest, takenQualityIds, defaultAllowed, canRequest } };
  });
  const selected = seasons.find(item => item.season.season_number === selection?.number);
  const open = (number: number, requesting: boolean, button: HTMLButtonElement) => {
    opener.current = button;
    setSelection({ number, requesting });
  };
  const close = () => { setSelection(null); opener.current?.focus(); };

  return <section id="season-explorer" className="season-explorer" aria-labelledby="season-explorer-title" tabIndex={-1}>
    <div className="season-explorer-heading">
      <div>
        <h2 id="season-explorer-title" className="text-xl font-bold">{t('media.explorer.title')}</h2>
        <p className="text-sm text-ndp-text-muted mt-1">{t('media.explorer.hint')}</p>
      </div>
    </div>
    <div className="season-cards">
      {seasons.map(({ season, state, status }) => {
        const label = t('media.season_label', { number: season.season_number });
        const active = selection?.number === season.season_number;
        return <article className="season-card" key={season.season_number}>
          <div className="season-poster group" data-selected={active}>
            <button className="season-card-button" aria-label={`${label} — ${t('media.explorer.view_episodes')}`}
              aria-expanded={active} aria-controls="season-details" onClick={event => open(season.season_number, false, event.currentTarget)}>
              <SeasonPoster posterPath={season.poster_path} seriesPosterPath={props.media.poster_path} blurred={props.blurred} />
            </button>
            {requestAccess && !state.complete && <SeasonQuickRequest media={props.media} seasonNumber={season.season_number}
              allowed={state.defaultAllowed} result={submitted[season.season_number]} onRefresh={props.onRefresh}
              onRequested={result => setSubmitted(previous => ({ ...previous, [season.season_number]: result }))} />}
          </div>
          <SeasonCardInfo season={season} status={status} />
        </article>;
      })}
    </div>
    {selected && selection && <SeasonPanel key={`${props.media.id}:${selection.number}`} {...props}
      season={selected.season} state={selected.state} requesting={selection.requesting}
      requestAccess={requestAccess} requestsEnabled={features.requestsEnabled}
      downloads={downloads.filter(item => item.episode?.seasonNumber === selection.number)}
      onClose={close} onRequest={() => setSelection({ ...selection, requesting: true })}
      onCancelRequest={() => setSelection({ ...selection, requesting: false })} />}
  </section>;
}
