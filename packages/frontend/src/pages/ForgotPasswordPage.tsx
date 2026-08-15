import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Mail, MailCheck } from 'lucide-react';
import api from '@/lib/api';
import { useFeatures } from '@/context/FeaturesContext';

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const { features } = useFeatures();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/password/forgot', { email });
    } catch {
      // Deliberately ignored: the server answers the same way whether or not the account exists,
      // and surfacing a network error here would let a caller probe for valid addresses.
    } finally {
      setLoading(false);
      setSent(true);
    }
  };

  if (!features.passwordResetEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <p className="text-ndp-text-dim mb-4">{t('reset.unavailable')}</p>
          <Link to="/login" className="text-ndp-accent hover:underline">{t('reset.back_to_login')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-ndp-text mb-2">{t('reset.forgot_title')}</h1>

        {sent ? (
          <div className="mt-6 rounded-lg border border-white/10 bg-ndp-surface p-5 text-center">
            <MailCheck className="w-8 h-8 mx-auto mb-3 text-ndp-success" />
            {/* Intentionally non-committal: confirming delivery would confirm the address exists. */}
            <p className="text-sm text-ndp-text">{t('reset.sent_body')}</p>
            <p className="text-xs text-ndp-text-dim mt-2">{t('reset.sent_hint')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-ndp-text-dim mb-6">{t('reset.forgot_body')}</p>
            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('login.email_placeholder')}
                required
                autoFocus
                className="input w-full"
              />
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading
                  ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Mail className="w-4 h-4" />}
                {t('reset.send_link')}
              </button>
            </form>
          </>
        )}

        <Link to="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm text-ndp-text-dim hover:text-ndp-text">
          <ArrowLeft className="w-4 h-4" />
          {t('reset.back_to_login')}
        </Link>
      </div>
    </div>
  );
}
