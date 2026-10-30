import { useEffect } from 'react';
import { Check, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaRequestActions } from '@/hooks/useMediaRequestActions';
import { showToast } from '@/utils/toast';
import type { TmdbMedia } from '@/types';
import { PosterRequestButton } from '../PosterRequestButton';

export type SeasonRequestResult = 'sent' | 'queued';

export function SeasonQuickRequest({ media, seasonNumber, seasonNumbering, allowed, result, onRequested, onRefresh }: Readonly<{
  media: TmdbMedia;
  seasonNumber: number;
  seasonNumbering?: string;
  allowed: boolean;
  result?: SeasonRequestResult;
  onRequested: (result: SeasonRequestResult) => void;
  onRefresh: () => Promise<void>;
}>) {
  const { t } = useTranslation();
  const actions = useMediaRequestActions(media, String(media.id), 'tv', onRefresh, seasonNumbering);
  const label = t('media.season_label', { number: seasonNumber });
  useEffect(() => {
    if (actions.requestError) showToast(`${label} — ${actions.requestError}`, 'error');
  }, [actions.requestError, label]);

  if (result) {
    const message = t(result === 'sent' ? 'status.request_sent' : 'status.request_send_failed');
    return <span role="status" title={message}
      className={`absolute top-2 right-2 p-1.5 rounded-full shadow-lg z-10 ${result === 'sent' ? 'bg-ndp-success' : 'bg-ndp-warning'}`}>
      {result === 'sent' ? <Check className="w-4 h-4 text-white" aria-hidden="true" /> : <Clock className="w-4 h-4 text-black" aria-hidden="true" />}
      <span className="sr-only">{label} — {message}</span>
    </span>;
  }
  if (!allowed) return null;
  return <PosterRequestButton label={`${t('media.explorer.request')} — ${label}`} loading={actions.requesting}
    onClick={async event => {
      event.preventDefault();
      event.stopPropagation();
      const outcome = await actions.handleSeasonRequest(seasonNumber);
      if (!outcome) return;
      onRequested(outcome);
      if (outcome === 'sent') showToast(`${label} — ${t('status.request_sent')}`, 'success');
    }} />;
}
