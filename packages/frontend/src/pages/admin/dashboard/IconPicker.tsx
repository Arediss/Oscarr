import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Ban, AlertTriangle } from 'lucide-react';
import { DynamicIcon } from '@/plugins/DynamicIcon';
import { DASHBOARD_ICONS } from './dashboardIcons';
import { BRAND_ICONS } from '@/icons/brandIcons';
import { LinkIcon } from '@/icons/LinkIcon';

type TabId = 'lucide' | 'brands' | 'url';

interface Props {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  trigger: React.ReactNode;
  /** Tabs to expose. Default `['lucide']` keeps the legacy dashboard behavior. */
  tabs?: TabId[];
}

const TAB_LABEL_KEYS: Record<TabId, string> = {
  lucide: 'admin.icon_picker.tab.lucide',
  brands: 'admin.icon_picker.tab.brands',
  url: 'admin.icon_picker.tab.url',
};

export function IconPicker({ value, onChange, trigger, tabs = ['lucide'] }: Readonly<Props>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(tabs[0]);
  const [urlDraft, setUrlDraft] = useState(value?.startsWith('https://') ? value : '');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popW = 288;
    const popH = tabs.length > 1 ? 340 : 280;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - 4;
    setPos({ top, left });
  }, [open, tabs.length]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  // When opening, jump to the tab matching the current value type so the user lands on the right
  // place (e.g. opening on a link with a brand icon shows the Brands tab pre-selected).
  useEffect(() => {
    if (!open || !value) return;
    if (value.startsWith('https://') && tabs.includes('url')) setActiveTab('url');
    else if (value.startsWith('brand:') && tabs.includes('brands')) setActiveTab('brands');
    else if (tabs.includes('lucide')) setActiveTab('lucide');
  }, [open, value, tabs]);

  const commit = (next: string | undefined) => {
    onChange(next);
    setOpen(false);
  };

  const urlValid = urlDraft === '' || /^https:\/\/\S+$/.test(urlDraft);

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setOpen((o) => !o)} className="inline-flex bg-transparent border-0 p-0 cursor-pointer">{trigger}</button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="fixed z-[60] w-72 rounded-lg border border-white/10 bg-ndp-surface shadow-xl shadow-black/50"
          style={{ top: pos.top, left: pos.left }}
        >
          {tabs.length > 1 && (
            <div className="flex items-center gap-1 p-1 border-b border-white/5">
              {tabs.map((t_) => (
                <button
                  key={t_}
                  onClick={() => setActiveTab(t_)}
                  className={`flex-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    activeTab === t_ ? 'bg-white/10 text-ndp-text' : 'text-ndp-text-dim hover:text-ndp-text hover:bg-white/5'
                  }`}
                >
                  {t(TAB_LABEL_KEYS[t_])}
                </button>
              ))}
            </div>
          )}

          <div className="p-2">
            {activeTab === 'lucide' && (
              <div className="grid grid-cols-7 gap-1 max-h-64 overflow-auto">
                <button
                  onClick={() => commit(undefined)}
                  className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 ${!value ? 'bg-ndp-accent/15 text-ndp-accent' : 'text-ndp-text-dim'}`}
                  title={t('admin.icon_picker.no_icon')}
                  aria-label={t('admin.icon_picker.no_icon')}
                >
                  <Ban className="h-3.5 w-3.5" />
                </button>
                {DASHBOARD_ICONS.map((name) => (
                  <button
                    key={name}
                    onClick={() => commit(name)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/5 ${value === name ? 'bg-ndp-accent/15 text-ndp-accent' : 'text-ndp-text-dim'}`}
                    title={name}
                    aria-label={name}
                  >
                    <DynamicIcon name={name} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}

            {activeTab === 'brands' && (
              <div className="grid grid-cols-5 gap-1 max-h-64 overflow-auto">
                {BRAND_ICONS.map((b) => {
                  const encoded = `brand:${b.id}`;
                  return (
                    <button
                      key={b.id}
                      onClick={() => commit(encoded)}
                      className={`flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/5 ${value === encoded ? 'bg-ndp-accent/15 ring-1 ring-ndp-accent/40' : ''}`}
                      title={b.title}
                      aria-label={b.title}
                    >
                      <LinkIcon value={encoded} className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === 'url' && (
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-wider font-semibold text-ndp-text-dim">
                  {t('admin.icon_picker.url_label')}
                </label>
                <input
                  type="url"
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://example.com/icon.png"
                  className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-ndp-text focus:outline-none focus:ring-2 focus:ring-ndp-accent/40"
                />
                {urlDraft && urlValid && (
                  <div className="flex items-center gap-2 p-2 rounded-md bg-white/5">
                    <img src={urlDraft} alt="" className="h-8 w-8 object-contain" />
                    <span className="text-xs text-ndp-text-dim flex-1 truncate">{urlDraft}</span>
                  </div>
                )}
                {urlDraft && !urlValid && (
                  <p className="flex items-center gap-1.5 text-[11px] text-ndp-warning">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {t('admin.icon_picker.https_warning')}
                  </p>
                )}
                <p className="text-[10px] text-ndp-text-dim">
                  {t('admin.icon_picker.ip_warning')}
                </p>
                <button
                  onClick={() => commit(urlDraft)}
                  disabled={!urlDraft || !urlValid}
                  className="w-full px-3 py-1.5 rounded-md text-xs font-medium bg-ndp-accent text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-ndp-accent/90 transition-colors"
                >
                  {t('admin.icon_picker.use_url')}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
