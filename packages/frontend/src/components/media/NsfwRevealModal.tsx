import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

interface Props {
  contentRating: string;
  /** Reveal this title only. */
  onRevealOnce: () => void;
  /** Turn the blur off everywhere, for this user. */
  onRevealAlways: () => void;
  onClose: () => void;
}

export function NsfwRevealModal({ contentRating, onRevealOnce, onRevealAlways, onClose }: Readonly<Props>) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-ndp-bg rounded-2xl w-full max-w-sm mx-4 shadow-2xl shadow-black/60 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-orange-500/10 rounded-xl">
            <ShieldAlert className="w-5 h-5 text-orange-400" />
          </div>
          <h3 className="text-lg font-semibold text-ndp-text">{t('nsfw.modal.title')}</h3>
        </div>

        <p className="text-sm text-ndp-text-muted mb-6">
          {t('nsfw.modal.description', { rating: contentRating })}
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={onRevealOnce}
            className="w-full px-4 py-2.5 bg-white/5 hover:bg-white/10 text-ndp-text text-sm font-medium rounded-xl transition-colors"
          >
            {t('nsfw.modal.show_once')}
          </button>
          <button
            onClick={onRevealAlways}
            className="w-full px-4 py-2.5 bg-orange-600/10 hover:bg-orange-600/20 text-orange-400 text-sm font-medium rounded-xl transition-colors"
          >
            {t('nsfw.modal.show_always')}
          </button>
        </div>
      </div>
    </div>
  );
}
