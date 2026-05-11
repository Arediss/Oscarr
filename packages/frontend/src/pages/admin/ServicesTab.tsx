import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, Server, Trash2 } from 'lucide-react';
import { Spinner } from './Spinner';
import { AdminTabLayout } from './AdminTabLayout';
import { useServiceSchemas, type ServiceData } from '@/hooks/useServiceSchemas';
import { useServicesTab } from './services/useServicesTab';
import { ServiceRow } from './services/ServiceRow';
import { ServiceModal } from './services/ServiceModal';
import api from '@/lib/api';
import { SERVICE_SAVED_EVENT } from './EncryptionUpgradeBanner';

type FlagReason = 'plaintext' | 'undecryptable';

/**
 * Admin → Services. Lists every configured *arr / media server / downloader, with per-row test
 * badges, quick toggles, and a modal for create/edit. Data + mutations live in `useServicesTab`;
 * the row and the form are their own components. This file just composes the layout.
 */
export function ServicesTab() {
  const { schemas: SERVICE_SCHEMAS } = useServiceSchemas();
  const { t } = useTranslation();
  const {
    services, loading, testing, testResults, deleting,
    fetchServices, deleteService, toggleService, setDefaultService, testService,
  } = useServicesTab();

  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<ServiceData | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [flags, setFlags] = useState<Map<number, FlagReason>>(new Map());

  // Pull the security-flag map (plaintext / undecryptable per service) so each row can
  // show an inline warning. Same data source as the global banner; we listen for the
  // `oscarr:service-saved` event so it refreshes the second a row is re-saved.
  const refreshFlags = useCallback(async () => {
    try {
      const { data } = await api.get<{ services: Array<{ id: number; reason: FlagReason }> }>(
        '/admin/security/services-needing-reencryption',
      );
      const next = new Map<number, FlagReason>();
      for (const s of data.services ?? []) next.set(s.id, s.reason);
      setFlags(next);
    } catch {
      setFlags(new Map());
    }
  }, []);

  useEffect(() => {
    void refreshFlags();
    const onSaved = () => { void refreshFlags(); };
    window.addEventListener(SERVICE_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SERVICE_SAVED_EVENT, onSaved);
  }, [refreshFlags]);

  const handleDeleteConfirmed = async (id: number) => {
    // Only close the confirm modal on success — on error the toast explains what happened and
    // the admin can retry with the same selection still in view.
    if (await deleteService(id)) setConfirmDelete(null);
  };

  if (loading) return <Spinner />;

  return (
    <AdminTabLayout
      title={t('admin.tab.services')}
      count={services.length}
      actions={
        <button onClick={() => { setEditingService(null); setShowModal(true); }} className="btn-primary flex items-center gap-2 text-sm px-4 py-2 rounded-xl">
          <Plus className="w-4 h-4" /> {t('common.add')}
        </button>
      }
    >
      {services.length === 0 ? (
        <div className="card p-12 text-center">
          <Server className="w-12 h-12 text-ndp-text-dim mx-auto mb-4" />
          <p className="text-ndp-text-muted">{t('admin.services.no_services')}</p>
          <p className="text-sm text-ndp-text-dim mt-1">{t('admin.services.no_services_help')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((service) => (
            <ServiceRow
              key={service.id}
              service={service}
              schema={SERVICE_SCHEMAS[service.type]}
              testing={testing === service.id}
              result={testResults[service.id] || null}
              flagReason={flags.get(service.id) ?? null}
              onTest={testService}
              onEdit={(s) => { setEditingService(s); setShowModal(true); }}
              onToggle={toggleService}
              onSetDefault={setDefaultService}
              onDelete={setConfirmDelete}
            />
          ))}
        </div>
      )}

      {confirmDelete !== null && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="card p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-bold text-ndp-text mb-2">{t('admin.danger.confirm_title')}</h3>
            <p className="text-sm text-ndp-text-muted mb-6">
              {t('admin.services.confirm_delete', { name: services.find((s) => s.id === confirmDelete)?.name })}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm flex-1">
                {t('common.cancel')}
              </button>
              <button
                onClick={() => handleDeleteConfirmed(confirmDelete)}
                disabled={deleting}
                className="btn-danger text-sm flex-1 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showModal && (
        <ServiceModal
          service={editingService}
          onClose={() => { setShowModal(false); setEditingService(null); }}
          onSaved={() => { setShowModal(false); setEditingService(null); fetchServices(); }}
        />
      )}
    </AdminTabLayout>
  );
}
