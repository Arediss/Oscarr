import { useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout/legacy';
import { Pencil, Plus, RotateCcw, Save, X } from 'lucide-react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useDashboardLayout, type DashboardLayout, type DashboardTab, type LayoutItem } from './useDashboardLayout';
import { WidgetChrome } from './WidgetChrome';
import { WidgetPickerModal } from './WidgetPickerModal';
import { ResetDashboardConfirmModal } from './ResetDashboardConfirmModal';
import { WidgetEditModal } from './WidgetEditModal';
import { IconPicker } from './IconPicker';
import { getBuiltInWidget } from './builtInCatalog';
import { PluginWidget, parsePluginLayoutI } from './PluginWidget';
import { usePluginUI } from '@/plugins/usePlugins';
import { DynamicIcon } from '@/plugins/DynamicIcon';

const ResponsiveGridLayout = WidthProvider(Responsive);
const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };
const ROW_HEIGHT = 50;

interface RenderableItem extends LayoutItem {
  title: string;
  defaultIcon?: string;
  body: React.ReactNode;
  ghost: boolean;
}

function genTabId(existing: DashboardTab[]): string {
  const used = new Set(existing.map((t) => t.id));
  for (let i = 1; i < 1000; i++) {
    const id = `tab-${i}`;
    if (!used.has(id)) return id;
  }
  return `tab-${Date.now()}`;
}

export function DashboardGrid() {
  const { layout, loading, error, save, reset } = useDashboardLayout();
  const { contributions } = usePluginUI('admin.dashboard.widget');
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [editingItemI, setEditingItemI] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const current = editMode ? (draft ?? layout) : layout;

  // Pin the active tab to a real tab id whenever the layout shape changes (initial load,
  // tab deletion, save). Falls back to the first tab if the previous active id disappeared.
  useEffect(() => {
    if (!current || current.tabs.length === 0) return;
    if (!activeTabId || !current.tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(current.tabs[0].id);
    }
  }, [current, activeTabId]);

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  const activeTab = current?.tabs.find((t) => t.id === activeTabId) ?? current?.tabs[0] ?? null;

  const renderables = useMemo<RenderableItem[]>(() => {
    if (!activeTab) return [];
    return activeTab.items.map((item): RenderableItem => {
      const builtIn = getBuiltInWidget(item.i);
      if (builtIn) {
        const Body = builtIn.Component;
        return { ...item, title: builtIn.title, defaultIcon: builtIn.icon, body: <Body />, ghost: false };
      }
      const parsed = parsePluginLayoutI(item.i);
      if (parsed) {
        const contribution = contributions.find(
          (c) => c.pluginId === parsed.pluginId && (c.props as { id?: string })?.id === parsed.widgetId,
        );
        if (!contribution) {
          return {
            ...item,
            title: 'Widget unavailable',
            body: <p className="text-xs text-ndp-text-dim">Plugin disabled or removed.</p>,
            ghost: true,
          };
        }
        const props = contribution.props as { title: string; icon?: string };
        return {
          ...item,
          title: props.title,
          defaultIcon: props.icon,
          body: <PluginWidget pluginId={parsed.pluginId} widgetId={parsed.widgetId} contribution={contribution} />,
          ghost: false,
        };
      }
      return { ...item, title: item.i, body: <p className="text-xs text-ndp-text-dim">Unknown widget id</p>, ghost: true };
    });
  }, [activeTab, contributions]);

  const enterEdit = () => { setDraft(layout); setEditMode(true); };
  const cancel = () => { setDraft(null); setEditMode(false); setRenamingTabId(null); };

  const updateActiveTab = (transform: (tab: DashboardTab) => DashboardTab) => {
    if (!draft || !activeTab) return;
    setDraft({
      ...draft,
      tabs: draft.tabs.map((t) => (t.id === activeTab.id ? transform(t) : t)),
    });
  };

  // v2 renamed the types: `Layout` is the array, `LayoutItem` the element (v1 had it the
  // other way round). The local LayoutItem here is Oscarr's own, not RGL's.
  const onLayoutChange = (next: Layout) => {
    if (!editMode || !draft || !activeTab) return;
    const byI = new Map(activeTab.items.map((it) => [it.i, it]));
    const items: LayoutItem[] = next.map((l) => {
      const existing = byI.get(l.i);
      return {
        ...existing,
        i: l.i, x: l.x, y: l.y, w: l.w, h: l.h,
      } as LayoutItem;
    });
    updateActiveTab((t) => ({ ...t, items }));
  };

  const removeItem = (i: string) => {
    updateActiveTab((t) => ({ ...t, items: t.items.filter((it) => it.i !== i) }));
  };

  const updateItem = (i: string, patch: Partial<LayoutItem>) => {
    updateActiveTab((t) => ({
      ...t,
      items: t.items.map((it) => (it.i === i ? { ...it, ...patch } : it)),
    }));
  };

  const setTabIcon = (id: string, icon: string | undefined) => {
    if (!draft) return;
    setDraft({
      ...draft,
      tabs: draft.tabs.map((t) => (t.id === id ? { ...t, icon } : t)),
    });
  };

  const onSave = async () => {
    if (!draft) return;
    await save(draft);
    setDraft(null);
    setEditMode(false);
    setRenamingTabId(null);
  };

  const addPicked = (entry: { layoutI: string; defaultSize: { w: number; h: number }; minSize?: { w: number; h: number } }) => {
    updateActiveTab((t) => {
      const maxY = t.items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
      return {
        ...t,
        items: [...t.items, { i: entry.layoutI, x: 0, y: maxY, w: entry.defaultSize.w, h: entry.defaultSize.h }],
      };
    });
  };

  const onResetConfirmed = async () => {
    await reset();
    setDraft(null);
    setEditMode(false);
    setActiveTabId(null);
    setRenamingTabId(null);
  };

  const addTab = () => {
    if (!draft) return;
    const newId = genTabId(draft.tabs);
    setDraft({
      ...draft,
      tabs: [...draft.tabs, { id: newId, name: 'Untitled', items: [] }],
    });
    setActiveTabId(newId);
    setRenamingTabId(newId);
  };

  const renameTab = (id: string, name: string) => {
    if (!draft) return;
    const trimmed = name.trim() || 'Untitled';
    setDraft({
      ...draft,
      tabs: draft.tabs.map((t) => (t.id === id ? { ...t, name: trimmed.slice(0, 50) } : t)),
    });
    setRenamingTabId(null);
  };

  const removeTab = (id: string) => {
    if (!draft || draft.tabs.length <= 1) return;
    const next = draft.tabs.filter((t) => t.id !== id);
    setDraft({ ...draft, tabs: next });
    if (activeTabId === id) setActiveTabId(next[0].id);
  };

  if (loading) return <p className="text-sm text-ndp-text-dim">Loading dashboard…</p>;
  if (error) return <p className="text-sm text-ndp-danger">Failed to load layout: {error}</p>;
  if (!current || !activeTab) return null;

  // A widget is "already on the dashboard" if it lives on ANY tab — the picker disables those
  // entries to keep widget ids unique across the whole layout.
  const alreadyOnDashboard = new Set(current.tabs.flatMap((t) => t.items.map((it) => it.i)));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 border-b border-white/5 pb-2">
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {current.tabs.map((t) => {
            const active = t.id === activeTab.id;
            const isRenaming = renamingTabId === t.id;
            return (
              <div key={t.id} className="flex items-center">
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    defaultValue={t.name}
                    onBlur={(e) => renameTab(t.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameTab(t.id, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') setRenamingTabId(null);
                    }}
                    className="rounded-lg border border-ndp-accent/60 bg-ndp-surface-light px-4 py-1.5 text-sm font-medium text-ndp-text outline-none"
                    maxLength={50}
                  />
                ) : (
                  <button
                    onClick={() => setActiveTabId(t.id)}
                    onDoubleClick={() => editMode && setRenamingTabId(t.id)}
                    className={`inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-ndp-accent/10 text-ndp-accent'
                        : 'text-ndp-text-muted hover:text-ndp-text hover:bg-white/5'
                    }`}
                    title={editMode ? 'Double-click to rename' : t.name}
                  >
                    {t.icon && <DynamicIcon name={t.icon} className="h-4 w-4" />}
                    {t.name}
                  </button>
                )}
                {editMode && active && !isRenaming && (
                  <IconPicker
                    value={t.icon}
                    onChange={(next) => setTabIcon(t.id, next)}
                    trigger={
                      <button
                        className="ml-0.5 rounded p-1 text-ndp-text-dim hover:bg-white/5 hover:text-ndp-text"
                        title="Set icon"
                        aria-label={`Set icon for ${t.name}`}
                      >
                        {t.icon ? <DynamicIcon name={t.icon} className="h-3.5 w-3.5" /> : <Pencil className="h-3 w-3" />}
                      </button>
                    }
                  />
                )}
                {editMode && active && current.tabs.length > 1 && !isRenaming && (
                  <button
                    onClick={() => removeTab(t.id)}
                    className="ml-0.5 rounded p-0.5 text-ndp-text-dim hover:text-ndp-danger"
                    aria-label={`Remove ${t.name}`}
                    title="Remove tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
          {editMode && (
            <button
              onClick={addTab}
              className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-lg text-ndp-text-dim hover:bg-white/5 hover:text-ndp-text"
              title="Add tab"
              aria-label="Add tab"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {!editMode ? (
            <button
              onClick={enterEdit}
              className="p-2 rounded-lg text-ndp-text-muted hover:text-ndp-text hover:bg-white/5 transition-colors"
              title="Edit"
              aria-label="Edit"
            >
              <Pencil className="w-4 h-4" />
            </button>
          ) : (
            <>
              <button
                onClick={() => setPickerOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ndp-surface-light hover:bg-ndp-surface-hover px-3 py-1.5 text-xs font-medium text-ndp-text transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add widget
              </button>
              <button
                onClick={() => setResetOpen(true)}
                className="p-2 rounded-lg text-ndp-text-muted hover:text-ndp-danger hover:bg-ndp-danger/10 transition-colors"
                title="Reset to default"
                aria-label="Reset to default"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={cancel}
                className="p-2 rounded-lg text-ndp-text-muted hover:text-ndp-text hover:bg-white/5 transition-colors"
                title="Cancel"
                aria-label="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={onSave}
                className="p-2 rounded-lg text-ndp-accent hover:bg-ndp-accent/10 transition-colors"
                title="Save"
                aria-label="Save"
              >
                <Save className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      <ResponsiveGridLayout
        className="layout"
        layouts={{ lg: renderables, md: renderables, sm: renderables, xs: renderables, xxs: renderables }}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={ROW_HEIGHT}
        margin={[12, 12]}
        containerPadding={[0, 8]}
        isDraggable={editMode}
        isResizable={editMode}
        draggableHandle=".widget-drag-handle"
        onLayoutChange={onLayoutChange}
        compactType="vertical"
      >
        {renderables.map((r) => {
          const wantsHeader = !!r.customTitle || !!r.customIcon || r.showTitle === true;
          const headerTitle = wantsHeader ? (r.customTitle || r.title) : undefined;
          const headerIcon = wantsHeader ? (r.customIcon || r.defaultIcon) : undefined;
          return (
            <div key={r.i}>
              <WidgetChrome
                title={r.title}
                editMode={editMode}
                headerTitle={headerTitle}
                headerIcon={headerIcon}
                onRemove={editMode ? () => removeItem(r.i) : undefined}
                onEdit={editMode ? () => setEditingItemI(r.i) : undefined}
              >
                {r.body}
              </WidgetChrome>
            </div>
          );
        })}
      </ResponsiveGridLayout>

      <WidgetPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addPicked}
        alreadyOnDashboard={alreadyOnDashboard}
      />

      {resetOpen && (
        <ResetDashboardConfirmModal
          onConfirm={onResetConfirmed}
          onClose={() => setResetOpen(false)}
        />
      )}

      {editingItemI && (() => {
        const r = renderables.find((x) => x.i === editingItemI);
        if (!r) return null;
        return (
          <WidgetEditModal
            item={r}
            defaultTitle={r.title}
            onSave={(patch) => updateItem(r.i, patch)}
            onClose={() => setEditingItemI(null)}
          />
        );
      })()}
    </div>
  );
}
