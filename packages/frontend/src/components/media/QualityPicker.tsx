import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

interface QualityOption {
  id: number;
  label: string;
}

interface Props {
  options: QualityOption[];
  /** Already requested, or already covered by the *arr profile — not askable again. */
  takenIds: Set<number>;
  selected: number | null;
  onSelect: (updater: (prev: number | null) => number | null) => void;
}

export function QualityPicker({ options, takenIds, selected, onSelect }: Readonly<Props>) {
  const { t } = useTranslation();
  if (options.length === 0) return null;

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-ndp-text-muted uppercase tracking-wider mb-3">{t('media.quality')}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((q) => {
          const taken = takenIds.has(q.id);
          const isSelected = selected === q.id;
          return (
            <button
              key={q.id}
              onClick={() => !taken && onSelect((prev) => (prev === q.id ? null : q.id))}
              className={clsx(
                'px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5',
                taken && 'bg-ndp-success/10 text-ndp-success border border-ndp-success/20 cursor-default',
                !taken && isSelected && 'bg-ndp-accent text-white',
                !taken && !isSelected && 'bg-white/5 text-ndp-text-muted hover:bg-white/10',
              )}
            >
              {taken && <Check className="w-3.5 h-3.5" />}
              {q.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
