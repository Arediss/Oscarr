import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, Plus, X } from 'lucide-react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useSeasonEpisodes } from '@/hooks/useSeasonEpisodes';
import type { DownloadItem } from '@/hooks/useDownloads';
import { nextEpisodeDate } from '@/utils/episodeStatus';
import type { SeriesSeason } from '@oscarr/shared';
import type { SeasonExplorerProps, SeasonRequestState } from './SeasonExplorer';
import { SeasonEpisodes } from './SeasonEpisodes';
import { SeasonRequestForm } from './SeasonRequestForm';

export function SeasonDialog(props: Readonly<SeasonExplorerProps & {
  season: SeriesSeason; state: SeasonRequestState; requesting: boolean;
  requestAccess: boolean; requestsEnabled: boolean; downloads: DownloadItem[];
  onClose: () => void; onRequest: () => void; onCancelRequest: () => void;
}>) {
  const { t, i18n } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const { episodes, loading, error, now, stale, retry } = useSeasonEpisodes(props.media.id, props.season.seasonNumber, true, props.catalog);
  const nextDate = episodes ? nextEpisodeDate(episodes, now) : null;
  useEffect(() => {
    if (props.requesting) panel.current?.querySelector<HTMLButtonElement>('form button:not([disabled])')?.focus({ preventScroll: true });
  }, [props.requesting]);

  return <Dialog id="season-details" open onClose={props.onClose} initialFocus={closeButton} className="season-dialog">
    <DialogBackdrop className="season-dialog-backdrop" />
    <div className="season-dialog-container">
      <DialogPanel ref={panel} tabIndex={-1} className="season-details">
        <div className="season-details-heading">
          <div className="season-details-intro">
            <p className="text-xs text-ndp-text-muted mb-1">{props.media.name || props.media.title}</p>
            <DialogTitle className="font-bold text-xl">{t('media.season_label', { number: props.season.seasonNumber })}</DialogTitle>
            <p className="text-xs text-ndp-text-muted mt-1">{t(!props.requestsEnabled ? 'media.explorer.disabled' : props.blocked ? 'media.blocked' : props.state.complete ? 'media.explorer.complete_hint' : props.state.ownRequest ? 'status.already_requested' : props.season.monitored ? 'media.explorer.monitored_hint' : 'media.explorer.request_hint', { service: props.catalog?.source.serviceName })}</p>
            {nextDate && <span className="season-next mt-2"><Calendar size={14} aria-hidden="true" />{t('media.explorer.next', { date: new Date(nextDate).toLocaleDateString(i18n.language) })}</span>}
          </div>
          <div className="season-details-actions">
            {!props.requesting && props.state.canRequest && <button type="button" className="btn-secondary text-sm flex items-center gap-2" onClick={props.onRequest}><Plus size={16} aria-hidden="true" />{t('media.explorer.request')}</button>}
            <button ref={closeButton} type="button" className="season-details-close" onClick={props.onClose} aria-label={t('common.close')}><X size={20} aria-hidden="true" /></button>
          </div>
        </div>
        <div className="season-details-body">
          {props.requestAccess && props.requesting && <div className="season-request">
            <SeasonRequestForm media={props.media} seasonNumber={props.season.seasonNumber} seasonNumbering={props.catalog?.numbering}
              qualityOptions={props.qualityOptions} takenQualityIds={props.state.takenQualityIds} defaultAllowed={props.state.defaultAllowed}
              onRefresh={props.onRefresh} onCancel={() => { props.onCancelRequest(); panel.current?.focus({ preventScroll: true }); }} />
          </div>}
          {loading && !episodes && <p className="py-5 text-sm text-ndp-text-muted" role="status">{t('common.loading')}</p>}
          {stale && <p className="py-3 text-xs text-ndp-text-muted" role="status">{t('media.explorer.cached_episodes')}</p>}
          {props.catalog && !props.catalog.tracked && !loading && !error && <p className="py-5 text-sm text-ndp-text-muted">{t('media.explorer.episodes_after_add')}</p>}
          {error && <div className="py-5 flex flex-wrap items-center gap-3">
            <p className="text-sm text-ndp-text-muted" role="status">{t('media.explorer.unavailable')}</p>
            <button type="button" className="btn-secondary text-sm" onClick={retry} disabled={loading}>{t('media.explorer.refresh')}</button>
          </div>}
          {episodes && <SeasonEpisodes episodes={episodes} now={now} downloads={props.downloads} />}
        </div>
      </DialogPanel>
    </div>
  </Dialog>;
}
