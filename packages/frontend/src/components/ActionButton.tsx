import { Check, Plus, Loader2, Clock, ShieldAlert } from 'lucide-react';
import type { ButtonState } from '@/utils/resolveButtonState';

interface ActionButtonProps {
  state: ButtonState;
  requesting: boolean;
  justRequested: boolean;
  download?: { progress: number; timeLeft?: string } | null;
  searchMissingError?: string;
  blacklistReason?: string;
  onRequest: () => void;
  onSearchMissing: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function ActionButton({
  state,
  requesting,
  justRequested,
  download,
  searchMissingError,
  blacklistReason,
  onRequest,
  onSearchMissing,
  t,
}: ActionButtonProps) {
  switch (state) {
    case 'available':
      return (
        <button disabled className="btn-success flex items-center gap-2 cursor-default">
          <Check className="w-4 h-4" />
          {t('status.available')}
        </button>
      );

    case 'can_request_quality':
      return (
        <button
          onClick={onRequest}
          disabled={requesting}
          className="btn-primary flex items-center gap-2"
        >
          {requesting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {t('media.request')}
        </button>
      );

    case 'downloading':
      return (
        <button disabled className="relative overflow-hidden rounded-xl px-5 py-2.5 text-sm font-medium text-white cursor-default min-w-[180px]">
          <div
            className="absolute inset-0 bg-ndp-accent/80 transition-all duration-1000 ease-out"
            style={{ width: `${download?.progress ?? 0}%` }}
          />
          <div className="absolute inset-0 bg-white/5" />
          <div className="relative flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{Math.round(download?.progress ?? 0)}%</span>
            {download?.timeLeft && download.timeLeft !== '00:00:00' && (
              <span className="text-xs opacity-70">— {download.timeLeft.replace(/^0+:?/, '')}</span>
            )}
          </div>
        </button>
      );

    case 'upcoming':
      return (
        <button disabled className="btn-secondary flex items-center gap-2 cursor-default opacity-60">
          <Clock className="w-4 h-4" />
          {t('status.upcoming')}
        </button>
      );

    case 'searching':
      return (
        <button disabled className="btn-secondary flex items-center gap-2 cursor-default opacity-60">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('status.searching_long')}
        </button>
      );

    case 'already_requested':
      return (
        <button disabled className="btn-success flex items-center gap-2 cursor-default">
          <Check className="w-4 h-4" />
          {justRequested ? t('status.request_sent') : t('status.already_requested')}
        </button>
      );

    case 'partially_searching':
      return (
        <button disabled className="btn-success flex items-center gap-2 cursor-default">
          <Loader2 className="w-4 h-4 animate-spin" />
          {t('media.search_missing_in_progress')}
        </button>
      );

    case 'partially_error':
      return (
        <button disabled className="btn-danger flex items-center gap-2 cursor-default text-sm">
          {searchMissingError || t('common.error')}
        </button>
      );

    case 'partially_available':
      return (
        <button
          onClick={onSearchMissing}
          disabled={requesting}
          className="btn-primary flex items-center gap-2"
        >
          {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t('media.request_rest')}
        </button>
      );

    case 'blocked':
      return (
        <button disabled className="btn-secondary flex items-center gap-2 cursor-not-allowed opacity-60" title={blacklistReason || undefined}>
          <ShieldAlert className="w-4 h-4 text-ndp-danger" />
          {t('media.blocked')}
        </button>
      );

    case 'can_request_seasons':
      return (
        <button
          onClick={onRequest}
          disabled={requesting}
          className="btn-primary flex items-center gap-2"
        >
          {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t('media.request_more_seasons')}
        </button>
      );

    case 'can_request':
      return (
        <button
          onClick={onRequest}
          disabled={requesting}
          className="btn-primary flex items-center gap-2"
        >
          {requesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t('media.request')}
        </button>
      );
  }
}
