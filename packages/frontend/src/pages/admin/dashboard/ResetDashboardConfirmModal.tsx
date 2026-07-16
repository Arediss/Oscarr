import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useModal } from '@/hooks/useModal';

interface Props {
  onConfirm: () => void;
  onClose: () => void;
}

export function ResetDashboardConfirmModal({ onConfirm, onClose }: Readonly<Props>) {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useModal({ open: true, onClose });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-md shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-2">
          <h2 id={titleId} className="text-base font-semibold text-ndp-text">{t('admin.dashboard.reset.title')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 -mt-1 -mr-1 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors"
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 pb-6">
          <p className="text-sm text-ndp-text-muted">
            {t('admin.dashboard.reset.body')}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/5 bg-ndp-surface-light px-3 py-1.5 text-xs font-medium text-ndp-text hover:bg-ndp-surface-hover"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={() => { onConfirm(); onClose(); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-ndp-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-ndp-danger/80"
            >
              {t('admin.dashboard.reset.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
