import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { WizardShell, type WizardStep } from './install/WizardShell';
import SecretStep from './install/steps/SecretStep';
import AdminStep from './install/steps/AdminStep';
import PathStep, { type InstallPath } from './install/steps/PathStep';
import ServicesStep from './install/steps/ServicesStep';
import DefaultsStep from './install/steps/DefaultsStep';
import MigrateSourceStep, { type DerivedConfig, type SeerrCreds } from './install/steps/MigrateSourceStep';
import MigrateApplyStep from './install/steps/MigrateApplyStep';
import SyncStep from './install/steps/SyncStep';
import DoneStep from './install/steps/DoneStep';
import { useBackend } from '@/context/BackendGate';

/**
 * Install wizard — 7-step state machine with a Fresh / Migrate fork.
 *
 *  Fresh path:    Secret → Admin → Path → Services → Defaults → Sync → Done
 *  Migrate path:  Secret → Admin → Path → Source  → Apply    → Done  (skips Sync; the
 *                 config-execute endpoint seeds services/folders/quality in one shot)
 *
 * State here is intentionally minimal — each step owns its local form state and only
 * surfaces the bare result (e.g. probed creds, derived config) back up so the next
 * step can consume it.
 */

const FRESH_LABELS_KEYS = ['secret', 'admin', 'path', 'services', 'defaults', 'sync', 'done'] as const;
const MIGRATE_LABELS_KEYS = ['secret', 'admin', 'path', 'source', 'apply', 'done'] as const;

export default function InstallPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { markInstalled } = useBackend();
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [secretValid, setSecretValid] = useState(false);
  const [adminExists, setAdminExists] = useState(false);
  const [path, setPath] = useState<InstallPath | null>(null);
  const [migrateCreds, setMigrateCreds] = useState<SeerrCreds | null>(null);
  const [migrateDerived, setMigrateDerived] = useState<DerivedConfig | null>(null);

  useEffect(() => {
    api.get('/setup/install-status')
      .then(({ data }) => {
        if (data.installed) navigate('/login', { replace: true });
        else setChecking(false);
      })
      .catch(() => setChecking(false));
  }, [navigate]);

  if (checking) {
    return (
      <div className="min-h-dvh bg-ndp-bg flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-ndp-accent animate-spin" />
      </div>
    );
  }

  const stepperLabels: WizardStep[] = path === 'migration'
    ? MIGRATE_LABELS_KEYS.map((k) => ({
        label: t(`install.step.${k}`),
        hint: t(`install.step.${k}_hint`, ''),
      }))
    : FRESH_LABELS_KEYS.map((k) => ({
        label: t(`install.step.${k}`),
        hint: t(`install.step.${k}_hint`, ''),
      }));

  // Migrate path skips Sync (step index 5 in fresh). Done lives at step=6 but maps to
  // stepper index 5 in the migrate label array.
  const stepperIndex = path === 'migration' && step === 6 ? 5 : step;

  return (
    <WizardShell
      steps={stepperLabels}
      currentStep={stepperIndex}
      brandTagline={t('install.brand_tagline')}
    >
      {step === 0 && (
        <SecretStep
          onValidated={(adminThere) => {
            setSecretValid(true);
            setAdminExists(adminThere);
            setStep(1);
          }}
        />
      )}

      {step === 1 && secretValid && (
        <AdminStep
          adminExists={adminExists}
          onComplete={() => { setAdminExists(true); setStep(2); }}
        />
      )}

      {step === 2 && (
        <PathStep
          onSelect={(p) => { setPath(p); setStep(3); }}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && path === 'fresh' && (
        <ServicesStep
          onNext={() => setStep(4)}
          onBack={() => { setPath(null); setStep(2); }}
        />
      )}

      {step === 3 && path === 'migration' && (
        <MigrateSourceStep
          onProbed={(creds, derived) => {
            setMigrateCreds(creds);
            setMigrateDerived(derived);
            setStep(4);
          }}
          onBack={() => { setPath(null); setStep(2); }}
        />
      )}

      {step === 4 && path === 'fresh' && (
        <DefaultsStep
          onNext={() => setStep(5)}
          onBack={() => setStep(3)}
        />
      )}

      {step === 4 && path === 'migration' && migrateCreds && migrateDerived && (
        <MigrateApplyStep
          creds={migrateCreds}
          derived={migrateDerived}
          onComplete={() => setStep(6)}
          onBack={() => setStep(3)}
        />
      )}

      {step === 5 && path === 'fresh' && (
        <SyncStep onComplete={() => setStep(6)} />
      )}

      {step === 6 && (
        <DoneStep onGo={() => { markInstalled(); navigate('/', { replace: true }); }} />
      )}
    </WizardShell>
  );
}
