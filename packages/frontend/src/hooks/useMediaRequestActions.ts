import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { invalidateMediaStatus } from '@/hooks/useMediaStatus';
import type { TmdbMedia } from '@/types';
import { extractApiError } from '@/utils/toast';

export function useMediaRequestActions(
  media: TmdbMedia | null,
  id: string | undefined,
  type: 'movie' | 'tv',
  refreshDbData: () => Promise<void>,
) {
  const { t } = useTranslation();
  const [requesting, setRequesting] = useState(false);
  const [justRequested, setJustRequested] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [selectedSeasons, setSelectedSeasons] = useState<number[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number | null>(null);
  // Criterion id → chosen value id. One value per criterion: a title cannot be wanted in French
  // *and* subtitled at once, and the backend refuses the pair rather than picking for you.
  const [selectedCriteria, setSelectedCriteria] = useState<Record<number, number>>({});
  const [searchMissingState, setSearchMissingState] = useState<'idle' | 'searching' | 'error'>('idle');
  const [searchMissingError, setSearchMissingError] = useState('');

  const submitting = useRef(false);
  const submitRequest = async (seasons: number[]) => {
    if (!media || submitting.current) return false;
    submitting.current = true;
    setRequesting(true);
    setRequestError('');
    try {
      const body: Record<string, unknown> = { tmdbId: media.id, mediaType: type };
      if (type === 'tv' && seasons.length > 0) {
        body.seasons = seasons;
      }
      if (selectedQuality) {
        body.qualityOptionId = selectedQuality;
      }
      const criterionValueIds = Object.values(selectedCriteria);
      if (criterionValueIds.length > 0) {
        body.criterionValueIds = criterionValueIds;
      }
      const { data: reqData } = await api.post('/requests', body);
      if (reqData.sendError) {
        setRequestError(t('status.request_send_failed', 'Request created but could not be sent to the service. It will be retried automatically.'));
        setTimeout(() => setRequestError(''), 8000);
      } else {
        setJustRequested(true);
      }
      invalidateMediaStatus(media.id, type);
      await refreshDbData();
      return reqData.sendError ? 'queued' as const : 'sent' as const;
    } catch (err: unknown) {
      setRequestError(extractApiError(err, err instanceof Error ? err.message : t('common.error')));
      setTimeout(() => setRequestError(''), 5000);
      return false;
    } finally {
      submitting.current = false;
      setRequesting(false);
    }
  };

  const handleRequest = () => submitRequest(selectedSeasons);
  const handleSeasonRequest = (seasonNumber: number) => submitRequest([seasonNumber]);

  const handleSearchMissing = async () => {
    if (!media) return;
    setRequesting(true);
    setSearchMissingError('');
    try {
      await api.post('/requests/search-missing', { tmdbId: media.id, mediaType: type });
      setSearchMissingState('searching');
    } catch (err: unknown) {
      setSearchMissingError(extractApiError(err, t('common.error')));
      setSearchMissingState('error');
      setTimeout(() => { setSearchMissingState('idle'); setSearchMissingError(''); }, 5000);
    } finally {
      setRequesting(false);
    }
  };

  const resetOnNavigation = () => {
    setSelectedSeasons([]);
    setSelectedQuality(null);
    // Navigating to another title must not carry the previous one's choices over.
    setSelectedCriteria({});
    setJustRequested(false);
  };

  return {
    requesting,
    justRequested,
    requestError,
    selectedSeasons,
    setSelectedSeasons,
    selectedQuality,
    setSelectedQuality,
    selectedCriteria,
    setSelectedCriteria,
    searchMissingState,
    searchMissingError,
    handleRequest,
    handleSeasonRequest,
    handleSearchMissing,
    resetOnNavigation,
  };
}
