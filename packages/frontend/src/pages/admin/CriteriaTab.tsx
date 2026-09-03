import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { toastApiError } from '@/utils/toast';

interface CriterionValue { id: number; label: string }
interface Criterion { id: number; name: string; showOnRequest: boolean; values: CriterionValue[] }

/**
 * Axes the admin defines to describe *how* a title is wanted: a language, an edition, a source.
 *
 * Separate from quality on purpose. A quality option maps to a Radarr/Sonarr profile; a criterion
 * only ever feeds a folder rule, which is how one instance sends French to one Radarr and
 * subtitled releases to another without the word "quality" having to mean language.
 */
export function CriteriaTab() {
  const { t } = useTranslation();
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState<Record<number, string>>({});

  const load = async () => {
    try {
      const { data } = await api.get<Criterion[]>('/admin/request-criteria');
      setCriteria(data);
    } catch (err) {
      toastApiError(err, t('common.error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const addCriterion = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await api.post('/admin/request-criteria', { name });
      setNewName('');
      await load();
    } catch (err) {
      toastApiError(err, t('admin.criteria.add_failed'));
    }
  };

  const removeCriterion = async (id: number) => {
    try {
      await api.delete(`/admin/request-criteria/${id}`);
      await load();
    } catch (err) {
      // The server names the rules still using it rather than breaking their routing silently.
      toastApiError(err, t('admin.criteria.delete_failed'));
    }
  };

  const toggleVisible = async (c: Criterion) => {
    try {
      await api.put(`/admin/request-criteria/${c.id}`, { showOnRequest: !c.showOnRequest });
      await load();
    } catch (err) {
      toastApiError(err, t('common.error'));
    }
  };

  const addValue = async (criterionId: number) => {
    const label = (newValue[criterionId] ?? '').trim();
    if (!label) return;
    try {
      await api.post(`/admin/request-criteria/${criterionId}/values`, { label });
      setNewValue((v) => ({ ...v, [criterionId]: '' }));
      await load();
    } catch (err) {
      toastApiError(err, t('admin.criteria.add_value_failed'));
    }
  };

  const removeValue = async (valueId: number) => {
    try {
      await api.delete(`/admin/request-criteria/values/${valueId}`);
      await load();
    } catch (err) {
      toastApiError(err, t('common.error'));
    }
  };

  if (loading) return null;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ndp-text">{t('admin.criteria.title')}</h2>
        <p className="mt-0.5 text-xs text-ndp-text-dim">{t('admin.criteria.help')}</p>
      </div>

      <div className="card flex gap-2 p-4">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addCriterion(); }}
          placeholder={t('admin.criteria.name_placeholder')}
          className="input flex-1 text-sm"
        />
        <button onClick={addCriterion} disabled={!newName.trim()} className="btn-primary text-sm disabled:opacity-50">
          <Plus className="mr-1 inline h-4 w-4" />
          {t('admin.criteria.add')}
        </button>
      </div>

      {criteria.length === 0 && (
        <p className="text-sm text-ndp-text-dim">{t('admin.criteria.empty')}</p>
      )}

      {criteria.map((c) => (
        <div key={c.id} className="card space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-ndp-text">{c.name}</p>
              <p className="font-mono text-xs text-ndp-text-dim">criterion:{c.id}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => toggleVisible(c)}
                title={c.showOnRequest ? t('admin.criteria.hide') : t('admin.criteria.show')}
                className="rounded-lg p-2 transition-colors hover:bg-white/5"
              >
                {c.showOnRequest
                  ? <Eye className="h-4 w-4 text-ndp-accent" />
                  : <EyeOff className="h-4 w-4 text-ndp-text-dim" />}
              </button>
              <button
                onClick={() => removeCriterion(c.id)}
                title={t('common.delete')}
                className="rounded-lg p-2 transition-colors hover:bg-ndp-danger/10"
              >
                <Trash2 className="h-4 w-4 text-ndp-danger" />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {c.values.map((v) => (
              <span key={v.id} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[13px] text-ndp-text">
                {v.label}
                <button onClick={() => removeValue(v.id)} aria-label={t('common.delete')} className="text-ndp-text-dim hover:text-ndp-danger">
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              value={newValue[c.id] ?? ''}
              onChange={(e) => setNewValue((s) => ({ ...s, [c.id]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void addValue(c.id); }}
              placeholder={t('admin.criteria.value_placeholder')}
              className="input w-40 text-sm"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
