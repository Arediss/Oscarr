import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMediaRequestActions } from '@/hooks/useMediaRequestActions';
import { QualityPicker } from './QualityPicker';
import CriteriaPicker from './CriteriaPicker';
import type { TmdbMedia } from '@/types';

export function SeasonRequestForm({ media, seasonNumber, seasonNumbering, qualityOptions, takenQualityIds, defaultAllowed, onCancel, onRefresh }: Readonly<{
  media: TmdbMedia; seasonNumber: number; qualityOptions: { id: number; label: string }[];
  seasonNumbering?: string;
  takenQualityIds: Set<number>; defaultAllowed: boolean; onCancel: () => void; onRefresh: () => Promise<void>;
}>) {
  const { t } = useTranslation();
  const actions = useMediaRequestActions(media, String(media.id), 'tv', onRefresh, seasonNumbering);
  const [submitted, setSubmitted] = useState<'sent' | 'queued' | null>(null);
  const canSubmit = actions.selectedQuality !== null
    ? !takenQualityIds.has(actions.selectedQuality) : defaultAllowed;
  if (submitted) return <p className={`text-sm ${submitted === 'sent' ? 'text-ndp-success' : 'text-ndp-warning'}`} role="status">
    {t(submitted === 'sent' ? 'status.request_sent' : 'status.request_send_failed')}
  </p>;
  return <form className="w-full space-y-4" onSubmit={async event => {
    event.preventDefault();
    if (!canSubmit) return;
    const result = await actions.handleSeasonRequest(seasonNumber);
    if (result) setSubmitted(result);
  }}>
    <fieldset disabled={actions.requesting} className="space-y-4">
      <legend className="font-semibold text-sm">{t('media.explorer.confirm_title', { number: seasonNumber })}</legend>
      <p className="text-xs text-ndp-text-muted">{t('media.explorer.confirm_hint')}</p>
      <QualityPicker options={qualityOptions} takenIds={takenQualityIds} selected={actions.selectedQuality} onSelect={actions.setSelectedQuality} />
      <CriteriaPicker selected={actions.selectedCriteria} onSelect={(criterionId, valueId) => actions.setSelectedCriteria(prev => {
        const next = { ...prev };
        if (valueId === null) delete next[criterionId]; else next[criterionId] = valueId;
        return next;
      })} />
      {!defaultAllowed && !actions.selectedQuality && <p className="text-xs text-ndp-text-muted">{t('media.explorer.choose_quality')}</p>}
      {actions.requestError && <p role="alert" className="text-sm text-ndp-danger">{actions.requestError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="submit" className="btn-primary text-sm disabled:opacity-50" disabled={!canSubmit || actions.requesting}>
          {actions.requesting ? t('common.loading') : t('media.explorer.confirm')}
        </button>
      </div>
    </fieldset>
  </form>;
}
