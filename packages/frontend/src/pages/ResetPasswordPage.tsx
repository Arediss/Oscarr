import { useState, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound } from 'lucide-react';
import api from '@/lib/api';

const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(t('register.password_mismatch'));
    if (password.length < MIN_LENGTH) return setError(t('errors.PASSWORD_TOO_SHORT'));

    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
      // Long enough to read the confirmation, short enough not to feel stuck.
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      const code = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(t(`reset.error.${code ?? 'GENERIC'}`, { defaultValue: t('reset.error.GENERIC') }));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <p className="text-ndp-text-dim mb-4">{t('reset.error.INVALID_TOKEN')}</p>
          <Link to="/forgot-password" className="text-ndp-accent hover:underline">{t('reset.request_new')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-ndp-text mb-2">{t('reset.choose_title')}</h1>

        {done ? (
          <div className="mt-6 rounded-lg border border-white/10 bg-ndp-surface p-5 text-center">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-3 text-ndp-success" />
            <p className="text-sm text-ndp-text">{t('reset.done_body')}</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-ndp-text-dim mb-6">{t('reset.choose_body', { min: MIN_LENGTH })}</p>
            <form onSubmit={submit} className="space-y-3">
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  required
                  autoFocus
                  className="input w-full pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? t('common.hide') : t('common.show')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text"
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('register.password_confirm')}
                required
                className="input w-full"
              />
              {error && <p className="text-sm text-ndp-danger">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2">
                {loading
                  ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <KeyRound className="w-4 h-4" />}
                {t('reset.submit')}
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
