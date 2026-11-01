import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SeasonQuickRequest, type SeasonRequestResult } from './SeasonQuickRequest';
import { ACTIVE_REQUEST_STATUSES, type SeriesCatalog, type SeriesSeason } from '@oscarr/shared';
import { useFeatures } from '@/context/FeaturesContext';
import { useAuth } from '@/context/AuthContext';
import { useDownloads } from '@/hooks/useDownloads';
import { isSeasonComplete, seasonStatus } from '@/utils/seriesCatalog';
import type { MediaRequest, TmdbMedia } from '@/types';
import { SeasonDialog } from './SeasonDialog';
import { SeasonPoster } from './SeasonPoster';
import { SeasonCardInfo, SeasonStatusBadge, type SeasonCardStatus } from './SeasonCardInfo';
import './season-explorer.css';
import { catalogDownloads } from '@/utils/catalogDownloads';

export interface SeasonExplorerProps {
  media: TmdbMedia;
  seasons: SeriesSeason[];
  catalog: SeriesCatalog | null;
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

function coversSeason(request: MediaRequest, number: number, numbering: string | undefined) {
  if (!request.seasons) return true;
  if (!request.seasonNumbering || request.seasonNumbering !== numbering) return false;
  try {
    const seasons: unknown = JSON.parse(request.seasons);
    return !Array.isArray(seasons) || seasons.length === 0 || seasons.includes(number);
  } catch { return true; }
}

export default function SeasonExplorer(props: Readonly<SeasonExplorerProps>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { features, loading } = useFeatures();
  const downloads = catalogDownloads(useDownloads(), props.media.id, props.catalog);
  const [selection, setSelection] = useState<{ number: number; requesting: boolean } | null>(null);
  const [submitted, setSubmitted] = useState<Record<number, SeasonRequestResult>>({});
  const requestAccess = !loading && features.requestsEnabled && !props.blocked && !!props.catalog;
  const seasons = props.seasons.map(season => {
    const complete = !props.catalog?.stale && isSeasonComplete(season);
    const followed = !props.catalog?.stale && season.monitored;
    const activeRequests = props.requests.filter(request => (ACTIVE_REQUEST_STATUSES as readonly string[]).includes(request.status) && coversSeason(request, season.seasonNumber, props.catalog?.numbering));
    const ownRequest = !!submitted[season.seasonNumber] || activeRequests.some(request => request.userId === user?.id);
    const takenQualityIds = new Set([
      ...activeRequests.map(request => request.qualityOptionId).filter((id): id is number => id !== null),
      // The configured profile also covers upcoming episodes of a followed season.
      ...((complete || followed) ? props.activeQualityOptionIds : []),
    ]);
    const defaultAllowed = !complete && !ownRequest && (!season.monitored || !!props.catalog?.stale);
    const canRequest = requestAccess && (defaultAllowed || props.qualityOptions.some(option => !takenQualityIds.has(option.id)));
    const downloading = !!props.catalog?.tracked && downloads.some(item => item.episode?.seasonNumber === season.seasonNumber);
    const status: SeasonCardStatus = seasonStatus(season, props.catalog?.tracked ?? null, ownRequest || activeRequests.length > 0, downloading, props.catalog?.stale);
    return { season, status, state: { complete, ownRequest, takenQualityIds, defaultAllowed, canRequest } };
  });
  const selected = seasons.find(item => item.season.seasonNumber === selection?.number);
  const close = () => setSelection(null);

  return <section id="season-explorer" className="season-explorer" aria-labelledby="season-explorer-title" tabIndex={-1}>
    <div className="season-explorer-heading">
      <div>
        <h2 id="season-explorer-title" className="text-xl font-bold">{t('media.explorer.title')}</h2>
        <p className="text-sm text-ndp-text-muted mt-1">{t('media.explorer.hint')}</p>
        <p className="text-xs text-ndp-text-muted mt-2">
          {props.catalog ? <><span className="inline-flex rounded-full bg-ndp-surface-light px-2 py-1">{props.catalog.source.serviceName}</span>{' · '}{t('media.explorer.native_numbering')}
            {props.catalog.stale && <span role="status">{' · '}{t('media.explorer.cached', { date: new Date(props.catalog.fetchedAt).toLocaleString() })}</span>}</>
            : t('media.explorer.metadata_only')}
        </p>
      </div>
    </div>
    <div className="season-cards">
      {seasons.map(({ season, state, status }) => {
        const label = t('media.season_label', { number: season.seasonNumber });
        const active = selection?.number === season.seasonNumber;
        const statusId = `season-${props.media.id}-${season.seasonNumber}-status`;
        return <article className="season-card" key={season.seasonNumber}>
          <div className="season-poster group" data-selected={active}>
            <button className="season-card-button" aria-label={`${label} — ${t('media.explorer.view_episodes')}`}
              aria-haspopup="dialog" aria-controls={active ? 'season-details' : undefined} aria-describedby={statusId}
              onClick={() => setSelection({ number: season.seasonNumber, requesting: false })}>
              <SeasonPoster posterPath={season.posterPath} seriesPosterPath={props.media.poster_path} blurred={props.blurred} />
              <SeasonStatusBadge id={statusId} status={status} />
            </button>
            {requestAccess && !state.complete && <SeasonQuickRequest media={props.media} seasonNumber={season.seasonNumber}
              seasonNumbering={props.catalog?.numbering}
              allowed={state.defaultAllowed} result={submitted[season.seasonNumber]} onRefresh={props.onRefresh}
              onRequested={result => setSubmitted(previous => ({ ...previous, [season.seasonNumber]: result }))} />}
          </div>
          <SeasonCardInfo season={season} />
        </article>;
      })}
    </div>
    {selected && selection && <SeasonDialog key={`${props.media.id}:${selection.number}`} {...props}
      season={selected.season} state={selected.state} requesting={selection.requesting}
      requestAccess={requestAccess} requestsEnabled={features.requestsEnabled}
      downloads={downloads.filter(item => item.episode?.seasonNumber === selection.number)}
      onClose={close} onRequest={() => setSelection({ ...selection, requesting: true })}
      onCancelRequest={() => setSelection({ ...selection, requesting: false })} />}
  </section>;
}
