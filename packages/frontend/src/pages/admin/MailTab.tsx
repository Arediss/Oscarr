import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Mail, Send } from 'lucide-react';
import api from '@/lib/api';

interface MailView {
  enabled: boolean;
  transport: 'smtp' | 'resend';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromEnv: boolean;
  hasPassword: boolean;
  hasApiKey: boolean;
  configured: boolean;
}

const EMPTY: MailView = {
  enabled: false, transport: 'smtp', host: '', port: 587, secure: false,
  user: '', fromEmail: '', fromEnv: false, hasPassword: false, hasApiKey: false, configured: false,
};

export function MailTab() {
  const { t } = useTranslation();
  const [mail, setMail] = useState<MailView>(EMPTY);
  const [resetEnabled, setResetEnabled] = useState(false);
  // The reset link's host comes from siteUrl and nothing else, so an unset siteUrl blocks the feature.
  const [hasSiteUrl, setHasSiteUrl] = useState(false);
  // Secrets are never returned by the API, so they live outside `mail`: blank means "keep stored".
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testTo, setTestTo] = useState('');
  const [flash, setFlash] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ data: mailData }, { data: settings }] = await Promise.all([
        api.get('/admin/mail'),
        api.get('/admin/settings'),
      ]);
      setMail(mailData);
      setResetEnabled(Boolean(settings.passwordResetEnabled));
      setHasSiteUrl(Boolean(settings.siteUrl?.trim()));
    } catch (err) {
      setFlash({ text: (err as Error).message, kind: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setFlash(null);
    try {
      const { data } = await api.put('/admin/mail', {
        enabled: mail.enabled,
        transport: mail.transport,
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        user: mail.user,
        fromEmail: mail.fromEmail,
        ...(password ? { password } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
      setMail(data);
      setPassword('');
      setApiKey('');
      setFlash({ text: t('common.saved'), kind: 'ok' });
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setFlash({ text: code === 'MAIL_CONFIGURED_BY_ENV' ? t('admin.mail.env_locked') : (err as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setFlash(null);
    try {
      await api.post('/admin/mail/test', {
        to: testTo,
        transport: mail.transport,
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        user: mail.user,
        fromEmail: mail.fromEmail,
        ...(password ? { password } : {}),
        ...(apiKey ? { apiKey } : {}),
      });
      setFlash({ text: t('admin.mail.test_ok'), kind: 'ok' });
    } catch (err) {
      const body = (err as { response?: { data?: { message?: string } } }).response?.data;
      setFlash({ text: body?.message ?? (err as Error).message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleReset = async (value: boolean) => {
    setResetEnabled(value);
    try {
      await api.put('/admin/settings', { passwordResetEnabled: value });
    } catch (err) {
      setResetEnabled(!value);
      setFlash({ text: (err as Error).message, kind: 'error' });
    }
  };

  if (loading) return <p className="text-ndp-text-dim">…</p>;

  const locked = mail.fromEnv;

  return (
    <div className="space-y-6 max-w-2xl">
      <header>
        <h2 className="text-lg font-semibold text-ndp-text flex items-center gap-2">
          <Mail className="w-5 h-5" /> {t('admin.mail.title')}
        </h2>
        <p className="text-sm text-ndp-text-dim mt-1">{t('admin.mail.desc')}</p>
        <p className="text-xs text-ndp-text-dim mt-1">{t('admin.mail.shared_note')}</p>
      </header>

      {locked && (
        <p className="flex items-start gap-2 rounded-lg border border-ndp-accent/30 bg-ndp-accent/10 px-3 py-2 text-sm text-ndp-text">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {t('admin.mail.env_locked')}
        </p>
      )}

      {flash && (
        <p className={`rounded-lg px-3 py-2 text-sm ${flash.kind === 'ok' ? 'bg-ndp-success/10 text-ndp-success' : 'bg-ndp-danger/10 text-ndp-danger'}`}>
          {flash.text}
        </p>
      )}

      <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={mail.enabled} onChange={(e) => setMail({ ...mail, enabled: e.target.checked })} />
          <span className="text-sm text-ndp-text">{t('admin.mail.enabled')}</span>
        </label>

        <div>
          <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.transport')}</label>
          <select
            value={mail.transport}
            onChange={(e) => setMail({ ...mail, transport: e.target.value as MailView['transport'] })}
            className="input w-full"
          >
            <option value="smtp">{t('admin.mail.smtp')}</option>
            <option value="resend">{t('admin.mail.resend')}</option>
          </select>
        </div>

        {mail.transport === 'smtp' ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.host')}</label>
                <input value={mail.host} onChange={(e) => setMail({ ...mail, host: e.target.value })} className="input w-full" placeholder="smtp.example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.port')}</label>
                <input type="number" value={mail.port} onChange={(e) => setMail({ ...mail, port: Number(e.target.value) || 587 })} className="input w-full" />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={mail.secure} onChange={(e) => setMail({ ...mail, secure: e.target.checked })} />
              <span className="text-sm text-ndp-text">{t('admin.mail.secure')}</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.user')}</label>
              <input value={mail.user} onChange={(e) => setMail({ ...mail, user: e.target.value })} className="input w-full" autoComplete="off" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.password')}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                autoComplete="new-password"
                placeholder={mail.hasPassword ? t('admin.mail.secret_kept') : ''}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.apiKey')}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="input w-full"
              autoComplete="new-password"
              placeholder={mail.hasApiKey ? t('admin.mail.secret_kept') : 're_...'}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-ndp-text mb-1.5">{t('admin.mail.from')}</label>
          <input value={mail.fromEmail} onChange={(e) => setMail({ ...mail, fromEmail: e.target.value })} className="input w-full" placeholder="Oscarr &lt;no-reply@example.com&gt;" />
        </div>

        <button type="button" onClick={save} disabled={busy} className="btn-primary">{t('common.save')}</button>
      </fieldset>

      <div className="border-t border-white/10 pt-5 space-y-3">
        <label className="block text-sm font-medium text-ndp-text">{t('admin.mail.test')}</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder={t('admin.mail.test_to')}
            className="input flex-1"
          />
          <button type="button" onClick={sendTest} disabled={busy || !testTo} className="btn-secondary flex items-center gap-1.5">
            <Send className="w-4 h-4" /> {t('admin.mail.test')}
          </button>
        </div>
      </div>

      <div className="border-t border-white/10 pt-5">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={resetEnabled}
            disabled={!mail.configured || !mail.enabled || !hasSiteUrl}
            onChange={(e) => toggleReset(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="block text-sm text-ndp-text">{t('admin.mail.reset_toggle')}</span>
            <span className="block text-xs text-ndp-text-dim mt-0.5">
              {!mail.configured || !mail.enabled
                ? t('admin.mail.reset_needs_mail')
                : !hasSiteUrl ? t('admin.mail.reset_needs_siteurl') : t('admin.mail.reset_hint')}
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
