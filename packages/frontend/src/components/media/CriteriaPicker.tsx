import { useEffect, useState } from 'react';
import api from '@/lib/api';

export interface RequestCriterion {
  id: number;
  name: string;
  values: { id: number; label: string }[];
}

interface Props {
  selected: Record<number, number>;
  onSelect: (criterionId: number, valueId: number | null) => void;
}

/**
 * The admin-defined axes a requester picks from, next to the quality options.
 *
 * Deliberately not labelled "quality": these describe *how* a title is wanted — a language, an
 * edition, a source — and the admin names each axis. Only the ones marked visible come back from
 * the endpoint, so an axis that exists purely to drive folder rules never shows up here.
 *
 * Renders nothing when no criterion is configured, which is every instance until an admin creates
 * one. That is why it is safe to mount unconditionally.
 */
export default function CriteriaPicker({ selected, onSelect }: Readonly<Props>) {
  const [criteria, setCriteria] = useState<RequestCriterion[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.get<RequestCriterion[]>('/media/request-criteria')
      .then((res) => { if (!cancelled) setCriteria(res.data.filter((c) => c.values.length > 0)); })
      .catch(() => { /* an axis nobody can pick is better than a broken page */ });
    return () => { cancelled = true; };
  }, []);

  if (criteria.length === 0) return null;

  return (
    <div className="space-y-3">
      {criteria.map((criterion) => (
        <div key={criterion.id}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ndp-text-dim">
            {criterion.name}
          </p>
          <div className="flex flex-wrap gap-2">
            {criterion.values.map((value) => {
              const active = selected[criterion.id] === value.id;
              return (
                <button
                  key={value.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(criterion.id, active ? null : value.id)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-ndp-accent text-white'
                      : 'bg-white/[0.06] text-ndp-text-muted hover:bg-white/[0.12]'
                  }`}
                >
                  {value.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
