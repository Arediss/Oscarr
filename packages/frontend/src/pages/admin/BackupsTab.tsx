import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { Loader2, CheckCircle, AlertTriangle, Trash2, Download, Upload, Archive, X } from 'lucide-react';
import api from '@/lib/api';
import { showToast } from '@/utils/toast';
import { AdminTabLayout } from './AdminTabLayout';
import { useModal } from '@/hooks/useModal';

/**
 * Download / upload an Oscarr archive — lives in the System group. Handles the full create +
 * restore flow, including manifest validation against the current build before applying any DB.
 */
export function BackupsTab() {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [restoreModal, setRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreManifest, setRestoreManifest] = useState<{ version: string; createdAt: string; stats: Record<string, number> } | null>(null);
  const [restoreValidation, setRestoreValidation] = useState<{ compatible: boolean; needsMigration: boolean; error?: string } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [includeCache, setIncludeCache] = useState(false);
  const [savedBackups, setSavedBackups] = useState<{ filename: string; size: number; createdAt: string }[]>([]);
  const [restorePassword, setRestorePassword] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreModalA11y = useModal({ open: restoreModal, onClose: () => setRestoreModal(false) });

  useEffect(() => {
    api.get('/admin/backup/list')
      .then(({ data }) => setSavedBackups(data))
      .catch((err) => {
        console.error('BackupsTab list load failed', err);
        showToast(t('admin.backup.list_failed'), 'error');
      });
  }, [t]);

  const handleBackup = async () => {
    setDownloading(true);
    try {
      const { data } = await api.get(`/admin/backup/create?includeCache=${includeCache}`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `oscarr-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('BackupsTab create failed', err);
      showToast(t('admin.backup.create_failed'), 'error');
    } finally { setDownloading(false); }
  };

  const handleFileSelect = async (file: File) => {
    setRestoreFile(file);
    setRestoreManifest(null);
    setRestoreValidation(null);
    setRestoreError(null);
    setRestoreResult(null);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) { setRestoreError(t('admin.backup.invalid_archive')); return; }

      const manifest = JSON.parse(await manifestFile.async('text'));
      setRestoreManifest(manifest);

      const { data } = await api.post('/admin/backup/validate', { manifest });
      setRestoreValidation(data);
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (msg === 'BACKUP_TOO_NEW') setRestoreError(t('admin.backup.too_new'));
      else setRestoreError(msg || t('admin.backup.validation_failed'));
    }
  };

  const handleRestore = async () => {
    if (!restoreFile || !restoreManifest) return;
    setRestoring(true);
    setRestoreError(null);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(restoreFile);
      const dbFile = zip.file('oscarr.db');
      if (!dbFile) { setRestoreError(t('admin.backup.no_db')); setRestoring(false); return; }

      const dbBase64 = await dbFile.async('base64');

      // Plugin-owned data (KV files, per-plugin SQLite) travels in the archive under `plugins/`.
      // Restore used to apply oscarr.db alone, so a restored instance came back with core data
      // from the backup and plugin data from whenever. The backend re-checks every path.
      const pluginFiles = zip.file(/^plugins\//);
      const plugins = await Promise.all(
        pluginFiles
          .filter((entry) => !entry.dir)
          .map(async (entry) => ({ path: entry.name, data: await entry.async('base64') })),
      );

      const { data } = await api.post('/admin/backup/restore', {
        db: dbBase64,
        manifest: restoreManifest,
        password: restorePassword,
        plugins,
      });

      setRestoreResult(data.message);
      setRestorePassword('');
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      const mapped = (() => {
        switch (code) {
          case 'PASSWORD_REQUIRED': return t('admin.backup.password_required');
          case 'INVALID_PASSWORD': return t('admin.backup.invalid_password');
          case 'BACKUP_SIGNATURE_INVALID': return t('admin.backup.signature_invalid');
          case 'BACKUP_UNSIGNED': return t('admin.backup.unsigned');
          case 'ADMIN_HAS_NO_PASSWORD': return t('admin.backup.admin_no_password');
          default: return code || t('admin.backup.restore_failed');
        }
      })();
      setRestoreError(mapped);
    } finally { setRestoring(false); }
  };

  return (
    <AdminTabLayout>
      <div className="mt-6">
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-ndp-text">{t('admin.backup.title')}</h3>

          <div className="flex gap-3">
            <button
              onClick={handleBackup}
              disabled={downloading}
              className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
            >
              {downloading ? <Loader2 className="w-5 h-5 text-ndp-accent animate-spin" /> : <Download className="w-5 h-5 text-ndp-accent" />}
              <div className="text-left">
                <p className="text-sm font-medium text-ndp-text">{t('admin.backup.create')}</p>
                <p className="text-xs text-ndp-text-dim">{t('admin.backup.create_desc')}</p>
              </div>
            </button>

            <button
              onClick={() => { setRestoreModal(true); setRestoreFile(null); setRestoreManifest(null); setRestoreValidation(null); setRestoreError(null); setRestoreResult(null); }}
              className="flex-1 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
            >
              <Upload className="w-5 h-5 text-ndp-text-dim" />
              <div className="text-left">
                <p className="text-sm font-medium text-ndp-text">{t('admin.backup.restore')}</p>
                <p className="text-xs text-ndp-text-dim">{t('admin.backup.restore_desc')}</p>
              </div>
            </button>
          </div>

          <button
            onClick={() => setIncludeCache(!includeCache)}
            className={clsx('w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left text-sm', includeCache ? 'bg-ndp-accent/10 text-ndp-text' : 'text-ndp-text-muted hover:bg-white/5')}
          >
            <div className={clsx('w-4 h-4 rounded border flex items-center justify-center flex-shrink-0', includeCache ? 'bg-ndp-accent border-ndp-accent' : 'border-white/20')}>
              {includeCache && <CheckCircle className="w-3 h-3 text-white" />}
            </div>
            {t('admin.backup.include_cache')}
          </button>

          {savedBackups.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs text-ndp-text-dim uppercase tracking-wider font-semibold">{t('admin.backup.saved_backups')}</h4>
              {savedBackups.map(b => (
                <div key={b.filename} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02]">
                  <Archive className="w-4 h-4 text-ndp-text-dim flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ndp-text truncate">{b.filename}</p>
                    <p className="text-[10px] text-ndp-text-dim">{new Date(b.createdAt).toLocaleString()} · {(b.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { data } = await api.get(`/admin/backup/download/${b.filename}`, { responseType: 'blob' });
                        const url = URL.createObjectURL(data);
                        const a = document.createElement('a');
                        a.href = url; a.download = b.filename; a.click();
                        URL.revokeObjectURL(url);
                      } catch (err) {
                        console.error('BackupsTab download failed', err);
                        showToast(t('admin.backup.download_failed'), 'error');
                      }
                    }}
                    className="p-1.5 text-ndp-text-dim hover:text-ndp-accent hover:bg-white/5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api.delete(`/admin/backup/${b.filename}`);
                        setSavedBackups(prev => prev.filter(x => x.filename !== b.filename));
                      } catch (err) {
                        console.error('BackupsTab delete failed', err);
                        showToast(t('admin.backup.delete_failed'), 'error');
                      }
                    }}
                    className="p-1.5 text-ndp-text-dim hover:text-ndp-danger hover:bg-ndp-danger/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {restoreModal && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setRestoreModal(false)}>
            <div
              ref={restoreModalA11y.dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={restoreModalA11y.titleId}
              className="card p-6 max-w-md w-full mx-4 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-ndp-accent" />
                  <h3 id={restoreModalA11y.titleId} className="text-lg font-bold text-ndp-text">{t('admin.backup.restore')}</h3>
                </div>
                <button onClick={() => setRestoreModal(false)} aria-label={t('common.close')} className="p-1 rounded-lg hover:bg-white/5 text-ndp-text-dim">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!restoreResult && !restoreFile && !restoreError && (
                <div
                  onClick={() => fileRef.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
                  role="button"
                  tabIndex={0}
                  className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:border-ndp-accent/30 transition-colors cursor-pointer"
                >
                  <Upload className="w-8 h-8 text-ndp-text-dim mx-auto mb-2" />
                  <p className="text-sm text-ndp-text-muted">{t('admin.backup.drop_file')}</p>
                  <p className="text-xs text-ndp-text-dim mt-1">.zip</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={e => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  />
                </div>
              )}

              {!restoreResult && restoreManifest && restoreValidation && !restoreError && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-white/[0.03] p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-ndp-text-dim">{t('admin.backup.version')}</span>
                      <span className="text-ndp-text font-medium">{restoreManifest.version}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ndp-text-dim">{t('admin.backup.date')}</span>
                      <span className="text-ndp-text font-medium">{new Date(restoreManifest.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-ndp-text-dim">{t('admin.backup.stats')}</span>
                      <span className="text-ndp-text font-medium">
                        {t('admin.backup.stats_detail', { users: restoreManifest.stats.users, media: restoreManifest.stats.media, requests: restoreManifest.stats.requests })}
                      </span>
                    </div>
                    {restoreValidation.needsMigration && (
                      <div className="flex items-center gap-2 text-xs text-ndp-warning mt-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t('admin.backup.needs_migration')}
                      </div>
                    )}
                  </div>

                  <div className="p-3 rounded-xl bg-ndp-warning/10 border border-ndp-warning/20 text-ndp-warning text-xs">
                    <AlertTriangle className="w-4 h-4 inline mr-1.5" />
                    {t('admin.backup.restore_warning')}
                  </div>

                  <div>
                    <label htmlFor="restore-password" className="text-sm text-ndp-text mb-1.5 block">
                      {t('admin.backup.confirm_password')}
                    </label>
                    <input
                      id="restore-password"
                      type="password"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      placeholder={t('admin.backup.confirm_password_placeholder')}
                      className="input w-full"
                      autoComplete="current-password"
                    />
                    <p className="text-xs text-ndp-text-dim mt-1">
                      {t('admin.backup.confirm_password_help')}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => { setRestoreFile(null); setRestoreManifest(null); setRestoreValidation(null); setRestorePassword(''); }} className="btn-secondary text-sm flex-1">
                      {t('common.cancel')}
                    </button>
                    <button onClick={handleRestore} disabled={restoring || !restorePassword} className="btn-danger text-sm flex-1 flex items-center justify-center gap-2">
                      {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      {t('admin.backup.confirm_restore')}
                    </button>
                  </div>
                </div>
              )}

              {restoreResult && (
                <div className="space-y-4">
                  <div className="p-6 rounded-xl bg-ndp-success/10 border border-ndp-success/20 text-center">
                    <CheckCircle className="w-8 h-8 text-ndp-success mx-auto mb-3" />
                    <p className="text-base text-ndp-success font-semibold">{t('admin.backup.restore_success')}</p>
                    <p className="text-sm text-ndp-text-dim mt-2">{t('admin.backup.reload_hint')}</p>
                  </div>
                  <button onClick={() => setRestoreModal(false)} className="btn-primary w-full text-sm">
                    {t('common.close')}
                  </button>
                </div>
              )}

              {restoreError && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-ndp-danger/10 border border-ndp-danger/20 text-center">
                    <AlertTriangle className="w-6 h-6 text-ndp-danger mx-auto mb-2" />
                    <p className="text-sm text-ndp-danger font-medium">{restoreError}</p>
                  </div>
                  <button onClick={() => { setRestoreError(null); setRestoreFile(null); setRestoreManifest(null); setRestoreValidation(null); }} className="btn-secondary w-full text-sm">
                    {t('admin.backup.try_again')}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>
    </AdminTabLayout>
  );
}
