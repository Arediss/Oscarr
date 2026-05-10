import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { AdminTabLayout } from './AdminTabLayout';
import api from '@/lib/api';
import { showToast, toastApiError } from '@/utils/toast';
import { copyToClipboard } from '@/utils/clipboard';
import { ConfirmModal } from '@/components/ConfirmModal';

interface ApiKeyRow {
  id: number;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}

interface CreatedKey {
  id: number;
  name: string;
  prefix: string;
  /** Plain key — only present right after creation, never returned again. */
  key: string;
}

export function ApiKeysTab() {
  const { t, i18n } = useTranslation();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [reveal, setReveal] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const formatDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<ApiKeyRow[]>('/admin/api-keys');
      setKeys(data);
    } catch (err) {
      toastApiError(err, t('admin.api_keys.load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const { data } = await api.post<CreatedKey>('/admin/api-keys', { name });
      setReveal(data);
      setNewName('');
      setShowForm(false);
      setCopied(false);
      await load();
    } catch (err) {
      toastApiError(err, t('admin.api_keys.create_failed'));
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!reveal) return;
    const ok = await copyToClipboard(reveal.key);
    if (ok) {
      setCopied(true);
      showToast(t('admin.api_keys.copied'), 'success');
    }
  };

  const confirmRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await api.delete(`/admin/api-keys/${revokeTarget.id}`);
      await load();
    } catch (err) {
      toastApiError(err, t('admin.api_keys.revoke_failed'));
    }
  };

  const lastUsedLabel = (iso: string | null) => {
    const formatted = formatDate(iso);
    return formatted
      ? t('admin.api_keys.last_used', { date: formatted })
      : t('admin.api_keys.never_used');
  };

  return (
    <AdminTabLayout
      count={keys.length}
      actions={
        !showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="btn-primary inline-flex items-center gap-2">
            <Plus size={16} className="-ml-0.5" />
            {t('admin.api_keys.new_button')}
          </button>
        )
      }
    >
      {reveal && (
        <div className="card border border-amber-500/30 bg-amber-500/5 p-4 mb-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-amber-200 mb-1">
                {t('admin.api_keys.created_warning_title', { name: reveal.name })}
              </p>
              <p className="text-xs text-amber-100/80 mb-3">
                {t('admin.api_keys.created_warning')}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 min-w-0 truncate font-mono text-xs bg-black/40 px-3 py-2 rounded border border-white/10 text-ndp-text">
                  {reveal.key}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="btn-secondary inline-flex items-center gap-1.5 !px-3 !py-2 text-xs"
                >
                  <Copy size={14} />
                  {copied ? t('admin.api_keys.copied') : t('admin.api_keys.copy')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setReveal(null)}
                className="mt-3 text-xs text-amber-200 hover:text-amber-100 underline"
              >
                {t('admin.api_keys.dismiss_reveal')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card p-4 mb-4 flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <label htmlFor="api-key-name" className="text-xs uppercase tracking-wider font-semibold text-ndp-text-dim mb-1.5 block">
              {t('admin.api_keys.new_label')}
            </label>
            <input
              id="api-key-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              autoFocus
              placeholder={t('admin.api_keys.new_placeholder')}
              className="input w-full"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? t('admin.api_keys.creating') : t('admin.api_keys.create_submit')}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setNewName(''); }}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {!loading && keys.length === 0 && !reveal && (
        <div className="card p-8 text-center">
          <KeyRound className="w-10 h-10 text-ndp-text-dim mx-auto mb-3" />
          <p className="text-sm text-ndp-text-muted">{t('admin.api_keys.empty')}</p>
        </div>
      )}

      {keys.length > 0 && (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="card p-4 flex items-center gap-4">
              <KeyRound className="w-4 h-4 text-ndp-text-dim flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-ndp-text truncate">{k.name}</p>
                <p className="text-xs text-ndp-text-dim font-mono truncate">{k.prefix}…</p>
              </div>
              <div className="hidden sm:block text-right flex-shrink-0">
                <p className="text-xs text-ndp-text-muted">{lastUsedLabel(k.lastUsedAt)}</p>
                <p className="text-[10px] text-ndp-text-dim">
                  {t('admin.api_keys.created', { date: formatDate(k.createdAt) ?? '' })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRevokeTarget(k)}
                className="text-ndp-text-dim hover:text-ndp-danger hover:bg-ndp-danger/10 p-2 rounded-lg transition-colors"
                aria-label={t('admin.api_keys.revoke')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={revokeTarget !== null}
        title={t('admin.api_keys.revoke_title')}
        description={revokeTarget ? t('admin.api_keys.revoke_confirm', { name: revokeTarget.name }) : ''}
        confirmLabel={t('admin.api_keys.revoke')}
        tone="danger"
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </AdminTabLayout>
  );
}
