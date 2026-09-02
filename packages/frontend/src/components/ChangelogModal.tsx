import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bug, ChevronRight, Plus, Wrench, X, Zap } from 'lucide-react';
import ReleaseNoteBody from '@/components/ReleaseNoteBody';
import api from '@/lib/api';
import { useModal } from '@/hooks/useModal';

interface Entry {
  type: string;
  title: string;
  description: string | null;
}

interface Release {
  version: string;
  type: string;
  title: string;
  date: string;
  /** Long-form note. When present it replaces the entry list — see ReleaseNoteBody. */
  body?: string | null;
  entries: Entry[];
}

interface ChangelogData {
  current: string;
  releases: Release[];
}

const ENTRY_ICONS: Record<string, { icon: typeof Plus; color: string }> = {
  feat: { icon: Plus, color: 'text-ndp-success' },
  fix: { icon: Bug, color: 'text-ndp-warning' },
  perf: { icon: Zap, color: 'text-ndp-accent' },
  other: { icon: Wrench, color: 'text-ndp-text-dim' },
};

// ─── Modal ──────────────────────────────────────────────────────────

/** Pre-body releases: type glyph + title + description. */
function EntryList({ entries }: Readonly<{ entries: Entry[] }>) {
  return (
    <ul className="space-y-2.5">
      {entries.map((entry) => {
        const iconDef = ENTRY_ICONS[entry.type] || ENTRY_ICONS.other;
        const EntryIcon = iconDef.icon;
        return (
          <li key={`${entry.type}-${entry.title}`} className="flex items-start gap-2.5">
            <EntryIcon aria-hidden="true" className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${iconDef.color}`} />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ndp-text leading-snug">{entry.title}</p>
              {entry.description && (
                <p className="text-[13px] text-ndp-text-muted leading-[1.7] mt-1 max-w-[64ch]">{entry.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function ChangelogModal({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const { t } = useTranslation();
  const [data, setData] = useState<ChangelogData | null>(null);
  const [loading, setLoading] = useState(false);
  const { dialogRef, titleId } = useModal({ open, onClose });

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    api.get('/app/changelog')
      .then(({ data: d }) => setData(d))
      .catch((err) => console.warn("[ChangelogModal] failed to fetch changelog", err))
      .finally(() => setLoading(false));
  }, [open, data]);

  // Newest first, as the feed returns them. Only the first is open: the dialog serves fifteen
  // releases, about 20 000 characters in one scroll, and someone opening it after an update wants
  // the top of the list, not the history under it.
  const releases = data?.releases ?? [];
  const [expanded, setExpanded] = useState<string | null>(null);
  const openVersion = expanded ?? releases[0]?.version ?? null;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-ndp-bg rounded-2xl w-full max-w-3xl max-h-[85vh] mx-4 shadow-2xl shadow-black/60 overflow-hidden flex flex-col border border-white/5"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 flex items-center justify-between">
          <div>
            <h2 id={titleId} className="text-lg font-bold text-ndp-text">{t('changelog.title')}</h2>
            <p className="text-[11px] text-ndp-text-muted mt-0.5">{t('changelog.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="p-2 rounded-xl hover:bg-white/5 transition-colors">
            <X className="w-5 h-5 text-ndp-text-dim" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-ndp-accent/30 border-t-ndp-accent rounded-full animate-spin" />
            </div>
          ) : !data || data.releases.length === 0 ? (
            <p className="text-center text-[13px] text-ndp-text-muted py-16">{t('changelog.empty')}</p>
          ) : (
            <ol className="divide-y divide-white/[0.06]">
              {releases.map((release) => {
                const isOpen = openVersion === release.version;
                const isCurrent = release.version.replace(/^v/, '') === data.current.replace(/^v/, '');
                return (
                  <li key={release.version}>
                    <h3>
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? '' : release.version)}
                        aria-expanded={isOpen}
                        className="w-full flex items-baseline gap-3 py-3.5 text-left rounded-lg px-1 -mx-1 hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ndp-accent/50 transition-colors"
                      >
                        <span
                          className={`font-mono text-[13px] tabular-nums flex-shrink-0 w-12 ${
                            isCurrent ? 'text-ndp-accent font-semibold' : 'text-ndp-text-muted'
                          }`}
                        >
                          {release.version.replace(/^v/, '')}
                        </span>
                        <span className={`flex-1 min-w-0 text-[13px] ${isOpen ? 'font-semibold text-ndp-text' : 'text-ndp-text-muted'}`}>
                          {release.title}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] uppercase tracking-[0.16em] text-ndp-accent flex-shrink-0">
                            {t('changelog.installed')}
                          </span>
                        )}
                        <ChevronRight
                          aria-hidden="true"
                          className={`w-3.5 h-3.5 flex-shrink-0 text-ndp-text-muted/70 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                        />
                      </button>
                    </h3>
                    {isOpen && (
                      <div className="pb-6 pt-1 pl-[3.75rem] pr-1">
                        {release.body ? <ReleaseNoteBody body={release.body} /> : <EntryList entries={release.entries} />}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
