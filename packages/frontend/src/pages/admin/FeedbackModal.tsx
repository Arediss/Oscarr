import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { X, Bug, MessageSquare, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useModal } from '@/hooks/useModal';
import api from '@/lib/api';

/** Public, permanent URL of the Cloudflare Worker that creates the GitHub issue.
 *  The subdomain (`arediss.workers.dev`) is locked to the maintainer's CF account and the
 *  Worker name (`oscarr-feedback`) is final — no reason for any Oscarr instance to override
 *  this. If the maintainer ever migrates the Worker, that's a code change here, not an
 *  env-var knob for self-hosters to fiddle with. */
const FEEDBACK_ENDPOINT = 'https://oscarr-feedback.arediss.workers.dev/submit';

type FeedbackType = 'bug' | 'feedback';

interface MetadataResponse {
  tech?: { oscarrVersion: string; nodeVersion: string; platform: string; arch: string };
  plugins?: Array<{ id: string; version: string; enabled: boolean }>;
  logs?: Array<{ createdAt: string; level: string; label: string; body: string }>;
}

interface SubmitResponse {
  ok: true;
  issueNumber: number;
  issueUrl: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FeedbackModal({ open, onClose }: Readonly<Props>) {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useModal({ open, onClose });

  const [type, setType] = useState<FeedbackType>('feedback');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [repro, setRepro] = useState('');
  const [includeTech, setIncludeTech] = useState(false);
  const [includePlugins, setIncludePlugins] = useState(false);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [metadata, setMetadata] = useState<MetadataResponse | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ number: number; url: string } | null>(null);
  // Honeypot — bots auto-fill this hidden field, server rejects when non-empty.
  const [honeypot, setHoneypot] = useState('');

  // Reset on close so the next open starts clean.
  useEffect(() => {
    if (open) return;
    setType('feedback');
    setTitle('');
    setBody('');
    setRepro('');
    setIncludeTech(false);
    setIncludePlugins(false);
    setIncludeLogs(false);
    setShowPreview(false);
    setMetadata(null);
    setValidationError(null);
    setSubmitting(false);
    setSubmitError(null);
    setSuccess(null);
    setHoneypot('');
  }, [open]);

  // Fetch metadata preview when sections change (debounced via the dependency list).
  useEffect(() => {
    if (!open) return;
    const sections = [
      includeTech ? 'tech' : null,
      includePlugins ? 'plugins' : null,
      includeLogs ? 'logs' : null,
    ].filter(Boolean).join(',');
    if (!sections) {
      setMetadata(null);
      return;
    }
    let cancelled = false;
    setMetadataLoading(true);
    api.get<MetadataResponse>(`/admin/feedback/metadata?include=${sections}`)
      .then((res) => { if (!cancelled) setMetadata(res.data); })
      .catch(() => { if (!cancelled) setMetadata(null); })
      .finally(() => { if (!cancelled) setMetadataLoading(false); });
    return () => { cancelled = true; };
  }, [open, includeTech, includePlugins, includeLogs]);

  if (!open) return null;

  const validate = (): boolean => {
    if (title.trim().length === 0) {
      setValidationError(t('admin.feedback.validation.title_required'));
      return false;
    }
    if (body.trim().length < 10) {
      setValidationError(t('admin.feedback.validation.body_required'));
      return false;
    }
    setValidationError(null);
    return true;
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          body: body.trim(),
          repro: type === 'bug' ? repro.trim() : undefined,
          metadata: metadata ?? {},
          honeypot,
          userAgent: navigator.userAgent,
        }),
      });
      if (res.status === 429) {
        setSubmitError(t('admin.feedback.error_rate_limited'));
        return;
      }
      if (res.status === 400) {
        setSubmitError(t('admin.feedback.error_validation'));
        return;
      }
      if (!res.ok) throw new Error(`Worker returned ${res.status}`);
      const data = await res.json() as SubmitResponse;
      setSuccess({ number: data.issueNumber, url: data.issueUrl });
    } catch {
      setSubmitError(t('admin.feedback.error_generic', { url: 'https://github.com/arediss/Oscarr/issues/new' }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card w-full max-w-xl flex flex-col shadow-2xl shadow-black/50 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 flex-shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ndp-text">{t('admin.feedback.modal.title')}</h2>
            <p className="text-xs text-ndp-text-dim mt-0.5">{t('admin.feedback.modal.intro')}</p>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            className="p-1.5 -mt-1 -mr-1 rounded-lg text-ndp-text-dim hover:text-ndp-text hover:bg-white/5 transition-colors flex-shrink-0"
            aria-label={t('admin.feedback.cancel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="px-6 pb-6 space-y-4">
            <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 text-emerald-300">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">{t('admin.feedback.success', { number: success.number })}</p>
                <a href={success.url} target="_blank" rel="noopener noreferrer" className="text-xs underline hover:no-underline mt-1 inline-block">
                  {success.url}
                </a>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm font-medium text-ndp-text transition-colors"
            >
              {t('admin.feedback.cancel')}
            </button>
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-4">
            {/* Type toggle */}
            <div className="grid grid-cols-2 gap-2">
              <TypeButton active={type === 'feedback'} onClick={() => setType('feedback')} icon={<MessageSquare className="w-4 h-4" />} label={t('admin.feedback.type.feedback')} />
              <TypeButton active={type === 'bug'} onClick={() => setType('bug')} icon={<Bug className="w-4 h-4" />} label={t('admin.feedback.type.bug')} />
            </div>

            {/* Title */}
            <Field label={t('admin.feedback.title_label')}>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('admin.feedback.title_placeholder')}
                maxLength={120}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/10 rounded-lg text-sm text-ndp-text placeholder-ndp-text-dim focus:outline-none focus:ring-1 focus:ring-ndp-accent/40"
              />
            </Field>

            {/* Body */}
            <Field label={t('admin.feedback.body_label')}>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('admin.feedback.body_placeholder')}
                rows={4}
                maxLength={4000}
                className="w-full px-3 py-2 bg-white/[0.03] border border-white/10 rounded-lg text-sm text-ndp-text placeholder-ndp-text-dim focus:outline-none focus:ring-1 focus:ring-ndp-accent/40 resize-none"
              />
            </Field>

            {/* Bug-only: how to reproduce */}
            {type === 'bug' && (
              <Field label={t('admin.feedback.repro_label')}>
                <textarea
                  value={repro}
                  onChange={(e) => setRepro(e.target.value)}
                  placeholder={t('admin.feedback.repro_placeholder')}
                  rows={3}
                  maxLength={2000}
                  className="w-full px-3 py-2 bg-white/[0.03] border border-white/10 rounded-lg text-sm text-ndp-text placeholder-ndp-text-dim focus:outline-none focus:ring-1 focus:ring-ndp-accent/40 resize-none"
                />
              </Field>
            )}

            {/* Opt-in metadata */}
            <section className="space-y-2 pt-2 border-t border-white/5">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-ndp-text-dim">{t('admin.feedback.include_heading')}</p>
                <p className="text-xs text-ndp-text-muted mt-1">{t('admin.feedback.include_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <CheckboxRow checked={includeTech} onChange={setIncludeTech} label={t('admin.feedback.include.tech')} />
                <CheckboxRow checked={includePlugins} onChange={setIncludePlugins} label={t('admin.feedback.include.plugins')} />
                <CheckboxRow checked={includeLogs} onChange={setIncludeLogs} label={t('admin.feedback.include.logs')} />
              </div>
              {(includeTech || includePlugins || includeLogs) && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="text-xs text-ndp-accent hover:underline"
                  >
                    {showPreview ? t('admin.feedback.preview_hide') : t('admin.feedback.preview_show')}
                  </button>
                  {showPreview && (
                    <pre className="mt-2 max-h-48 overflow-auto px-3 py-2 bg-black/30 border border-white/5 rounded-lg text-[11px] text-ndp-text-muted whitespace-pre-wrap break-all">
                      {metadataLoading ? t('admin.feedback.preview_loading') : (metadata ? JSON.stringify(metadata, null, 2) : '∅')}
                    </pre>
                  )}
                </div>
              )}
            </section>

            {/* Honeypot (visually hidden, accessible to bots) */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              className="absolute -left-[9999px] top-0 opacity-0 pointer-events-none"
              aria-hidden="true"
            />

            {/* Inline error */}
            {(validationError || submitError) && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-ndp-danger/10 ring-1 ring-ndp-danger/20 text-ndp-danger text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{validationError ?? submitError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm text-ndp-text-dim hover:text-ndp-text rounded-lg transition-colors disabled:opacity-50"
              >
                {t('admin.feedback.cancel')}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2',
                  'bg-ndp-accent hover:bg-ndp-accent/90 text-white',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                )}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? t('admin.feedback.submitting') : t('admin.feedback.submit')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TypeButton({ active, onClick, icon, label }: Readonly<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        active
          ? 'bg-ndp-accent/15 ring-1 ring-ndp-accent/40 text-ndp-accent'
          : 'bg-white/[0.03] ring-1 ring-white/5 text-ndp-text-muted hover:text-ndp-text',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs text-ndp-text-dim">{label}</span>
      {children}
    </label>
  );
}

function CheckboxRow({ checked, onChange, label }: Readonly<{ checked: boolean; onChange: (v: boolean) => void; label: string }>) {
  return (
    <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-white/20 bg-white/[0.05] text-ndp-accent focus:ring-1 focus:ring-ndp-accent/40"
      />
      <span className="text-sm text-ndp-text">{label}</span>
    </label>
  );
}
