import { useState, useEffect, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, XCircle, Pencil, Copy, Power, GripVertical, AlertTriangle } from 'lucide-react';
import { RULE_FIELDS, operatorsForField, isRuleField } from '@oscarr/shared';
import api from '@/lib/api';
import { Spinner } from './Spinner';
import type { RootFolder } from '@/types';

interface FolderRule {
  id: number; name: string; priority: number; mediaType: string;
  conditions: string; folderPath: string; seriesType: string | null; serviceId: number | null;
  enabled: boolean;
  serviceStatus?: string; // 'ok' | 'no-service' | 'missing' | 'disabled' | 'wrong-type' (from GET)
}
interface RuleCondition { field: string; operator: string; value: string; }
interface UserOption { id: number; displayName: string | null; email: string; }
interface RoleOption { id: number; name: string; }
interface ServiceOption { id: number; name: string; type: string; config?: { url?: string }; }

// Key → TMDB English genre name (the stored value the backend matches against). TMDB uses different
// genre sets for movies vs TV, so the picker must offer the set matching the rule's media type (H6).
const MOVIE_GENRES: Record<string, string> = {
  action: 'Action', adventure: 'Adventure', animation: 'Animation',
  comedy: 'Comedy', crime: 'Crime', documentary: 'Documentary',
  drama: 'Drama', family: 'Family', fantasy: 'Fantasy', history: 'History',
  horror: 'Horror', music: 'Music', mystery: 'Mystery', romance: 'Romance',
  science_fiction: 'Science Fiction', thriller: 'Thriller', war: 'War', western: 'Western',
};
const TV_GENRES: Record<string, string> = {
  action_adventure: 'Action & Adventure', animation: 'Animation', comedy: 'Comedy',
  crime: 'Crime', documentary: 'Documentary', drama: 'Drama', family: 'Family',
  kids: 'Kids', mystery: 'Mystery', news: 'News', reality: 'Reality',
  scifi_fantasy: 'Sci-Fi & Fantasy', soap: 'Soap', talk: 'Talk',
  war_politics: 'War & Politics', western: 'Western',
};

const BROKEN_SERVICE_STATUSES = new Set(['missing', 'disabled', 'wrong-type']);

async function fetchRootFolders(arrServices: ServiceOption[]) {
  const folders: { path: string; label: string; serviceId: number | null }[] = [];
  const failed: string[] = [];
  const folderResults = await Promise.all(
    arrServices.map(s => api.get(`/admin/services/${s.id}/rootfolders`).catch(() => ({ data: [], _failed: true })))
  );
  arrServices.forEach((svc, i) => {
    const res = folderResults[i] as { data: RootFolder[]; _failed?: boolean };
    if (res._failed || res.data.length === 0) {
      failed.push(svc.name);
      return;
    }
    const url = svc.config?.url || '';
    for (const f of res.data) {
      folders.push({ path: f.path, label: `${f.path} — ${svc.name}${url ? ` (${url})` : ''}`, serviceId: svc.id });
    }
  });
  return { folders, failed };
}

export function RoutingRulesTab() {
  const { t } = useTranslation();
  const fieldId = useId();
  const [rules, setRules] = useState<FolderRule[]>([]);
  const [labeledFolders, setLabeledFolders] = useState<{ path: string; label: string; serviceId: number | null }[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [qualityOptions, setQualityOptions] = useState<{ id: number; label: string }[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [defaultAnimeFolder, setDefaultAnimeFolder] = useState('');
  const [defaultMovieFolder, setDefaultMovieFolder] = useState('');
  const [defaultTvFolder, setDefaultTvFolder] = useState('');
  const [loading, setLoading] = useState(true);
  const [unreachableServices, setUnreachableServices] = useState<string[]>([]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Rule form (create + edit)
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newName, setNewName] = useState('');
  const [newMediaType, setNewMediaType] = useState('tv');
  const [newFolder, setNewFolder] = useState('');
  const [newSeriesType, setNewSeriesType] = useState('');
  const [newServiceId, setNewServiceId] = useState('');
  const [newConditions, setNewConditions] = useState<RuleCondition[]>([{ field: 'genre', operator: 'contains', value: '' }]);

  useEffect(() => {
    async function load() {
      try {
        const [settingsRes, rulesRes, usersRes, rolesRes, keywordsRes, servicesRes, qualityRes] = await Promise.all([
          api.get('/admin/settings'),
          api.get('/admin/folder-rules').catch(() => ({ data: [] })),
          api.get('/admin/users').catch(() => ({ data: [] })),
          api.get('/admin/roles').catch(() => ({ data: [] })),
          api.get('/admin/keywords').catch(() => ({ data: [] })),
          api.get('/admin/services').catch(() => ({ data: [] })),
          api.get('/app/quality-options').catch(() => ({ data: [] })),
        ]);
        setDefaultAnimeFolder(settingsRes.data.defaultAnimeFolder || '');
        setDefaultMovieFolder(settingsRes.data.defaultMovieFolder || '');
        setDefaultTvFolder(settingsRes.data.defaultTvFolder || '');
        setRules(rulesRes.data);
        setUsers(usersRes.data);
        setRoles(rolesRes.data);
        const uniqueTags = [...new Set(
          (keywordsRes.data as { tag: string | null }[])
            .map(k => k.tag)
            .filter((t): t is string => !!t)
        )];
        setTags(uniqueTags);
        const arrServices: ServiceOption[] = servicesRes.data.filter((s: ServiceOption) => s.type === 'radarr' || s.type === 'sonarr');
        setServices(arrServices);
        setQualityOptions(qualityRes.data);

        const { folders, failed } = await fetchRootFolders(arrServices);
        setLabeledFolders(folders);
        setUnreachableServices(failed);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const resetForm = () => {
    setShowForm(false); setEditingId(null);
    setNewName(''); setNewFolder(''); setNewSeriesType(''); setNewServiceId('');
    setNewMediaType('tv');
    setNewConditions([{ field: 'genre', operator: 'contains', value: '' }]);
  };

  const startEdit = (rule: FolderRule) => {
    let conds: RuleCondition[];
    try { conds = JSON.parse(rule.conditions); } catch { conds = []; }
    setEditingId(rule.id);
    setNewName(rule.name);
    setNewMediaType(rule.mediaType);
    setNewFolder(rule.folderPath);
    setNewSeriesType(rule.seriesType || '');
    setNewServiceId(rule.serviceId?.toString() || '');
    setNewConditions(conds.length > 0 ? conds : [{ field: 'genre', operator: 'contains', value: '' }]);
    setShowForm(true);
  };

  const saveRule = async () => {
    if (!newName || newConditions.some(c => !c.value)) return;
    const payload = {
      name: newName, mediaType: newMediaType, folderPath: newFolder,
      seriesType: newSeriesType || null,
      serviceId: newServiceId ? Number.parseInt(newServiceId) : null,
      conditions: newConditions,
    };
    try {
      if (editingId) {
        const { data } = await api.put(`/admin/folder-rules/${editingId}`, payload);
        setRules(prev => prev.map(r => r.id === editingId ? data : r));
      } else {
        const { data } = await api.post('/admin/folder-rules', { ...payload, priority: rules.length });
        setRules(prev => [...prev, data]);
      }
      resetForm();
    } catch (err) { console.error(err); }
  };

  const deleteRule = async (id: number) => {
    try { await api.delete(`/admin/folder-rules/${id}`); setRules(prev => prev.filter(r => r.id !== id)); }
    catch (err) { console.error(err); }
    finally { setConfirmDeleteId(null); }
  };

  const toggleRule = async (id: number) => {
    try {
      const { data } = await api.patch(`/admin/folder-rules/${id}/toggle`);
      setRules(prev => prev.map(r => r.id === id ? data : r));
    } catch (err) { console.error(err); }
  };

  const duplicateRule = async (id: number) => {
    try {
      const { data } = await api.post(`/admin/folder-rules/${id}/duplicate`);
      setRules(prev => [...prev, data]);
    } catch (err) { console.error(err); }
  };

  const updateConditionField = (index: number, field: string) => {
    const c = [...newConditions];
    c[index] = { field, operator: getDefaultOperator(field), value: '' };
    setNewConditions(c);
  };


  // Drag and drop reorder
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => { dragOverItem.current = index; };
  const handleDragEnd = async () => {
    if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) return;
    const reordered = [...rules];
    const [dragged] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOverItem.current, 0, dragged);
    setRules(reordered);
    dragItem.current = null;
    dragOverItem.current = null;
    try {
      await api.put('/admin/folder-rules/reorder', { ids: reordered.map(r => r.id) });
    } catch (err) { console.error(err); }
  };


  const handleFolderChange = (path: string) => {
    setNewFolder(path);
    const folder = labeledFolders.find(f => f.path === path);
    setNewServiceId(folder?.serviceId?.toString() || '');
  };

  const renderConditionRow = (cond: RuleCondition, i: number) => (
    <div key={`cond-${i}`} className="flex items-center gap-2">
      <select value={cond.field} onChange={(e) => updateConditionField(i, e.target.value)} className="input text-sm py-1.5 w-36">
        {RULE_FIELDS.map(f => (
          <option key={f} value={f}>{t(`admin.paths.${f}`)}</option>
        ))}
      </select>
      <select value={cond.operator} onChange={(e) => { const c = [...newConditions]; c[i].operator = e.target.value; setNewConditions(c); }} className="input text-sm py-1.5 w-32">
        {getOperatorsForField(cond.field).map(op => (
          <option key={op} value={op}>{t(`admin.paths.${op}`)}</option>
        ))}
      </select>
      {renderValueInput(cond, i)}
      {newConditions.length > 1 && (
        <button onClick={() => setNewConditions(prev => prev.filter((_, j) => j !== i))} className="text-ndp-text-dim hover:text-ndp-danger"><XCircle className="w-4 h-4" /></button>
      )}
    </div>
  );

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-ndp-text">{t('admin.paths.routing_rules')} ({rules.length})</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary text-sm flex items-center gap-2 px-4 py-2">
          <Plus className="w-4 h-4" /> {t('admin.paths.new_rule')}
        </button>
      </div>
      <p className="text-xs text-ndp-text-dim mb-4">{t('admin.paths.rules_help')}</p>

      {unreachableServices.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-ndp-warning/10 border border-ndp-warning/20 mb-4">
          <AlertTriangle className="w-4 h-4 text-ndp-warning flex-shrink-0" />
          <p className="text-sm text-ndp-warning">
            {t('admin.paths.services_unreachable', { services: unreachableServices.join(', ') })}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {/* Rules */}
        {rules.map((rule, index) => {
          let conds: RuleCondition[];
          try { conds = JSON.parse(rule.conditions); } catch { conds = []; }
          const service = services.find(s => s.id === rule.serviceId);
          return (
            <div key={rule.id} className={`flex items-center gap-3 transition-opacity ${!rule.enabled ? 'opacity-40' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-ndp-text-muted">{index + 1}</div>
              <div className="card flex-1 cursor-grab active:cursor-grabbing"
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragEnter={() => handleDragEnter(index)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => e.preventDefault()}
              >
              <div className="flex items-center gap-3 p-4">
                <GripVertical className="w-4 h-4 text-ndp-text-dim flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-ndp-text">{rule.name}</span>
                    <span className="text-[10px] bg-ndp-accent/10 text-ndp-accent px-1.5 py-0.5 rounded">{rule.mediaType === 'movie' ? t('common.movie') : rule.mediaType === 'tv' ? t('common.series') : t('common.all')}</span>
                    {rule.seriesType && <span className="text-[10px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded">{rule.seriesType}</span>}
                    {service && <span className="text-[10px] bg-blue-500/10 text-blue-400 px-1.5 py-0.5 rounded">{service.name}{service.config?.url ? ` · ${service.config.url}` : ''}</span>}
                    {rule.enabled && rule.serviceStatus && BROKEN_SERVICE_STATUSES.has(rule.serviceStatus) && (
                      <span className="text-[10px] bg-ndp-danger/10 text-ndp-danger px-1.5 py-0.5 rounded inline-flex items-center gap-1" title={t(`admin.paths.rule_broken_reason.${rule.serviceStatus}`)}>
                        <AlertTriangle className="w-3 h-3" /> {t('admin.paths.rule_broken')}
                      </span>
                    )}
                    {!rule.enabled && <span className="text-[10px] bg-ndp-text-dim/10 text-ndp-text-dim px-1.5 py-0.5 rounded">{t('admin.paths.disabled')}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {conds.map((c, i) => (
                      <span key={`tag-${i}`} className="text-xs text-ndp-text-dim">
                        {formatConditionLabel(c, users, roles)} {i < conds.length - 1 && ' +'}
                      </span>
                    ))}
                    <span className="text-xs text-ndp-text-dim">→ {rule.folderPath || (rule.seriesType === 'anime' ? defaultAnimeFolder : rule.mediaType === 'tv' ? defaultTvFolder : defaultMovieFolder) || <span className="italic">{t('admin.paths.defaults_title')}</span>}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleRule(rule.id)} className={`p-1.5 rounded-lg transition-colors ${rule.enabled ? 'text-ndp-success hover:bg-ndp-success/10' : 'text-ndp-text-dim hover:bg-white/5'}`} title={rule.enabled ? t('admin.paths.disable') : t('admin.paths.enable')}>
                    <Power className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => startEdit(rule)} className="p-1.5 text-ndp-text-dim hover:text-ndp-accent hover:bg-ndp-accent/10 rounded-lg transition-colors" title={t('common.edit')}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => duplicateRule(rule.id)} className="p-1.5 text-ndp-text-dim hover:text-ndp-accent hover:bg-ndp-accent/10 rounded-lg transition-colors" title={t('admin.paths.duplicate')}>
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setConfirmDeleteId(rule.id)} className="p-1.5 text-ndp-text-dim hover:text-ndp-danger hover:bg-ndp-danger/10 rounded-lg transition-colors" title={t('common.delete')}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* New rule form */}
      {showForm && (
        <div className="card p-5 mt-4 border border-ndp-accent/20 space-y-4 animate-fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor={`${fieldId}-name`} className="text-xs text-ndp-text-dim block mb-1">{t('common.name')}</label>
              <input id={`${fieldId}-name`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('admin.paths.rule_name_placeholder')} className="input text-sm w-full" />
            </div>
            <div>
              <label htmlFor={`${fieldId}-type`} className="text-xs text-ndp-text-dim block mb-1">{t('common.type')}</label>
              <select id={`${fieldId}-type`} value={newMediaType} onChange={(e) => { setNewMediaType(e.target.value); setNewFolder(''); setNewServiceId(''); }} className="input text-sm w-full">
                <option value="tv">{t('common.series')}</option><option value="movie">{t('common.movie')}</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-sonarr-type`} className="text-xs text-ndp-text-dim block mb-1">{t('admin.paths.sonarr_type')}</label>
              <select id={`${fieldId}-sonarr-type`} value={newSeriesType} onChange={(e) => setNewSeriesType(e.target.value)} className="input text-sm w-full">
                <option value="">{t('admin.paths.standard')}</option><option value="anime">{t('admin.paths.anime_rule')}</option><option value="daily">{t('admin.paths.daily')}</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-folder`} className="text-xs text-ndp-text-dim block mb-1">{t('admin.paths.target_folder')}</label>
            <select id={`${fieldId}-folder`} value={newFolder} onChange={(e) => handleFolderChange(e.target.value)} className="input text-sm w-full">
              <option value="">{t('common.choose')}</option>
              {labeledFolders
                .filter(f => {
                  if (!f.serviceId) return true;
                  const svc = services.find(s => s.id === f.serviceId);
                  return svc ? (newMediaType === 'movie' ? svc.type === 'radarr' : svc.type === 'sonarr') : true;
                })
                .map(f => <option key={f.path} value={f.path}>{f.label}</option>)}
            </select>
          </div>

          {/* Conditions — not a single input, so label the group via aria-labelledby. */}
          <div role="group" aria-labelledby={`${fieldId}-conditions`}>
            <span id={`${fieldId}-conditions`} className="text-xs text-ndp-text-dim block mb-2">{t('admin.paths.conditions_help')}</span>
            <div className="space-y-2">
              {newConditions.map((cond, i) => renderConditionRow(cond, i))}
            </div>
            <button onClick={() => setNewConditions(prev => [...prev, { field: 'genre', operator: 'contains', value: '' }])} className="text-xs text-ndp-accent hover:text-ndp-accent-hover mt-2 flex items-center gap-1">
              <Plus className="w-3 h-3" /> {t('admin.paths.add_condition')}
            </button>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={saveRule} disabled={!newName || newConditions.some(c => !c.value)} className="btn-primary text-sm">{editingId ? t('common.save') : t('admin.paths.create_rule')}</button>
            <button onClick={resetForm} className="btn-secondary text-sm">{t('common.cancel')}</button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={() => setConfirmDeleteId(null)}>
          <div className="bg-ndp-bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-ndp-text">{t('admin.paths.confirm_delete_title')}</h3>
            <p className="text-sm text-ndp-text-muted">{t('admin.paths.confirm_delete_desc')}</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDeleteId(null)} className="btn-secondary text-sm">{t('common.cancel')}</button>
              <button onClick={() => deleteRule(confirmDeleteId)} className="px-4 py-2 bg-ndp-danger/10 text-ndp-danger hover:bg-ndp-danger/20 rounded-xl text-sm font-medium transition-colors">{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function renderValueInput(cond: RuleCondition, i: number) {
    const setValue = (val: string) => {
      const c = [...newConditions]; c[i].value = val; setNewConditions(c);
    };

    switch (cond.field) {
      case 'genre':
        return (
          <select value={cond.value} onChange={(e) => setValue(e.target.value)} className="input text-sm py-1.5 flex-1">
            <option value="">{t('common.choose')}</option>
            {Object.entries(newMediaType === 'movie' ? MOVIE_GENRES : TV_GENRES).map(([key, tmdbName]) => <option key={key} value={tmdbName}>{t(`genre.${key}`)}</option>)}
          </select>
        );
      case 'user':
        return (
          <select value={cond.value} onChange={(e) => setValue(e.target.value)} className="input text-sm py-1.5 flex-1">
            <option value="">{t('admin.paths.select_user')}</option>
            {users.map(u => <option key={u.id} value={u.id.toString()}>{u.displayName || u.email}</option>)}
          </select>
        );
      case 'role':
        return (
          <select value={cond.value} onChange={(e) => setValue(e.target.value)} className="input text-sm py-1.5 flex-1">
            <option value="">{t('admin.paths.select_role')}</option>
            {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
          </select>
        );
      case 'tag':
        return (
          <select value={cond.value} onChange={(e) => setValue(e.target.value)} className="input text-sm py-1.5 flex-1">
            <option value="">{t('admin.paths.select_tag')}</option>
            {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        );
      case 'quality':
        return (
          <select value={cond.value} onChange={(e) => setValue(e.target.value)} className="input text-sm py-1.5 flex-1">
            <option value="">{t('admin.paths.select_quality')}</option>
            {qualityOptions.map(q => <option key={q.id} value={q.label.toLowerCase()}>{q.label}</option>)}
          </select>
        );
      default:
        return (
          <input value={cond.value} onChange={(e) => setValue(e.target.value)}
            placeholder={cond.field === 'language' ? 'ja, ko, zh' : 'JP, KR, CN'}
            className="input text-sm py-1.5 flex-1" />
        );
    }
  }
}

// Operators come from the shared field×operator matrix (@oscarr/shared) — the same source the
// backend matcher and validator use, so the UI can no longer offer a dead combo nor hide a valid
// one (e.g. role/quality "in" are now selectable, matching the backend).
function getDefaultOperator(field: string): string {
  return isRuleField(field) ? operatorsForField(field)[0] : 'contains';
}

function getOperatorsForField(field: string): readonly string[] {
  return isRuleField(field) ? operatorsForField(field) : ['contains'];
}

function formatConditionLabel(
  c: RuleCondition,
  users: UserOption[],
  roles: RoleOption[],
): string {
  let displayValue = c.value;
  if (c.field === 'user') {
    const user = users.find(u => u.id.toString() === c.value);
    if (user) displayValue = user.displayName || user.email;
  } else if (c.field === 'role') {
    const role = roles.find(r => r.name === c.value);
    if (role) displayValue = role.name;
  }
  return `${c.field} ${c.operator} ${displayValue}`;
}
