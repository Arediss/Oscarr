import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, X } from 'lucide-react';
import { useSeasonEpisodes } from '@/hooks/useSeasonEpisodes';
import type { DownloadItem } from '@/hooks/useDownloads';
import { nextEpisodeDate } from '@/utils/episodeStatus';
import type { TmdbSeason } from '@/types';
import type { SeasonExplorerProps, SeasonRequestState } from './SeasonExplorer';
import { SeasonEpisodes } from './SeasonEpisodes';
import { SeasonRequestForm } from './SeasonRequestForm';

export function SeasonPanel(props: Readonly<SeasonExplorerProps & {
  season: TmdbSeason; state: SeasonRequestState; requesting: boolean;
  requestAccess: boolean; requestsEnabled: boolean; downloads: DownloadItem[];
  onClose: () => void; onRequest: () => void; onCancelRequest: () => void;
}>) {
  const { t, i18n } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const { episodes, loading, error, now, retry } = useSeasonEpisodes(props.media.id, props.season.season_number, true);
  const nextDate = episodes ? nextEpisodeDate(episodes, now) : null;
  useEffect(() => {
    const element = panel.current;
    element?.focus({ preventScroll: true });
    element?.querySelector('.season-details-heading')?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, []);
  useEffect(() => {
    if (props.requesting) panel.current?.querySelector<HTMLButtonElement>('form button:not([disabled])')?.focus({ preventScroll: true });
  }, [props.requesting]);

  return <div id="season-details" ref={panel} tabIndex={-1} className="season-details" role="region" aria-labelledby="season-details-title">
    <div className="season-details-heading">
      <div className="season-details-intro">
        <h3 id="season-details-title" className="font-bold text-lg">{t('media.season_label', { number: props.season.season_number })}</h3>
        <p className="text-xs text-ndp-text-muted mt-1">{t(!props.requestsEnabled ? 'media.explorer.disabled' : props.blocked ? 'media.blocked' : props.state.complete ? 'media.explorer.complete_hint' : props.state.ownRequest ? 'status.already_requested' : 'media.explorer.request_hint')}</p>
        {nextDate && <span className="season-next mt-2"><Calendar size={14} aria-hidden="true" />{t('media.explorer.next', { date: new Date(nextDate).toLocaleDateString(i18n.language) })}</span>}
      </div>
      <div className="season-details-actions">
        {!props.requesting && props.state.canRequest && <button type="button" className="btn-secondary text-sm flex items-center gap-2" onClick={props.onRequest}><Plus size={16} aria-hidden="true" />{t('media.explorer.request')}</button>}
        <button type="button" className="season-details-close" onClick={props.onClose} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button>
      </div>
    </div>
    {props.requestAccess && props.requesting && <div className="season-request">
      <SeasonRequestForm media={props.media} seasonNumber={props.season.season_number}
        qualityOptions={props.qualityOptions} takenQualityIds={props.state.takenQualityIds} defaultAllowed={props.state.defaultAllowed}
        onRefresh={props.onRefresh} onCancel={() => { props.onCancelRequest(); panel.current?.focus({ preventScroll: true }); }} />
    </div>}
    {loading && !episodes && <p className="py-5 text-sm text-ndp-text-muted" role="status">{t('common.loading')}</p>}
    {error && <div className="py-5 flex flex-wrap items-center gap-3">
      <p className="text-sm text-ndp-text-muted" role="status">{t('media.explorer.unavailable')}</p>
      <button type="button" className="btn-secondary text-sm" onClick={retry} disabled={loading}>{t('media.explorer.refresh')}</button>
    </div>}
    {episodes && <SeasonEpisodes episodes={episodes} now={now} downloads={props.downloads} />}
  </div>;
}
