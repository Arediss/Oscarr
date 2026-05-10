import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useModal } from '@/hooks/useModal';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useModal({ open, onClose });

  if (!open) return null;

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in p-4"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card relative p-6 w-full max-w-sm border border-white/10 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className={clsx(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              tone === 'danger' ? 'bg-ndp-danger/15 text-ndp-danger' : 'bg-ndp-accent/15 text-ndp-accent',
            )}
          >
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ndp-text">{title}</h2>
            {description && (
              <p className="text-xs text-ndp-text-muted mt-1">{description}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary !py-1.5 !px-3 !text-sm"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            className={clsx(
              '!py-1.5 !px-3 !text-sm',
              tone === 'danger' ? 'btn-danger' : 'btn-primary',
            )}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute top-3 right-3 p-1.5 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
