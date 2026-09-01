import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { extractApiError } from '@/utils/toast';

interface Props {
  adminExists: boolean;
  onComplete: () => void;
}

export default function AdminStep({ adminExists, onComplete }: Readonly<Props>) {
  const { t, i18n } = useTranslation();
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError(t('register.password_mismatch')); return; }
    setSaving(true);
    setError('');
    try {
      // Bootstrap goes through the setup router, not the public /auth/register: creating the
      // account that owns the instance has to prove possession of SETUP_SECRET, which the api
      // interceptor attaches to every /setup/* call.
      const { data } = await api.post('/setup/admin', { email, password, displayName });
      await login('', data.user);
      const detectedLang = i18n.language.split('-')[0];
      if (detectedLang && detectedLang !== 'en') {
        api.put('/admin/settings', { instanceLanguages: [detectedLang] }).catch(() => {});
      }
      onComplete();
    } catch (err) {
      setError(extractApiError(err, t('login.error')));
    } finally { setSaving(false); }
  };

  const handleResume = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (data.user?.role !== 'admin') {
        setError(t('install.admin_required'));
        return;
      }
      await login('', data.user);
      onComplete();
    } catch (err) {
      setError(extractApiError(err, t('login.error')));
    } finally { setSaving(false); }
  };

  // User came back to this step after already creating + signing in as admin — skip the
  // re-auth and offer a one-click continue. Prevents the soft-lock where pressing Back
  // from the Path step lands on the register form and submitting it fails on "email exists".
  if (adminExists && user?.role === 'admin') {
    return (
      <div className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-ndp-text">{t('install.admin_title')}</h2>
          <p className="text-sm text-ndp-text-muted">{t('install.admin_already_signed_in', { name: user.displayName || user.email })}</p>
        </header>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-ndp-success/10 text-ndp-success text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">{user.email}</span>
        </div>
        <button type="button" onClick={onComplete} className="btn-primary w-full text-sm">
          {t('common.next')}
        </button>
      </div>
    );
  }

  if (adminExists) {
    return (
      <form onSubmit={handleResume} className="space-y-5">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold text-ndp-text">{t('install.resume_title')}</h2>
          <p className="text-sm text-ndp-text-muted">{t('install.resume_desc')}</p>
        </header>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('login.email_placeholder')}
          required
          className="input w-full"
          autoFocus
          autoComplete="email"
        />
        <PasswordInput
          value={password}
          onChange={setPassword}
          show={showPassword}
          onToggle={() => setShowPassword((s) => !s)}
          placeholder={t('login.password_placeholder')}
          autoComplete="current-password"
        />
        {error && <div className="text-xs px-3 py-2 rounded-lg bg-ndp-danger/10 text-ndp-danger">{error}</div>}
        <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {t('install.resume_login')}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleCreate} className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold text-ndp-text">{t('install.admin_title')}</h2>
        <p className="text-sm text-ndp-text-muted">{t('install.admin_desc')}</p>
      </header>
      <input
        type="text"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder={t('register.displayname')}
        required
        className="input w-full"
        autoFocus
        autoComplete="name"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('login.email_placeholder')}
        required
        className="input w-full"
        autoComplete="email"
      />
      <PasswordInput
        value={password}
        onChange={setPassword}
        show={showPassword}
        onToggle={() => setShowPassword((s) => !s)}
        placeholder={t('login.password_placeholder')}
        minLength={8}
        autoComplete="new-password"
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t('register.confirm_password')}
        required
        minLength={8}
        className="input w-full"
        autoComplete="new-password"
      />
      {error && <div className="text-xs px-3 py-2 rounded-lg bg-ndp-danger/10 text-ndp-danger">{error}</div>}
      <button type="submit" disabled={saving} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        {t('install.create_admin')}
      </button>
    </form>
  );
}

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  placeholder,
  minLength,
  autoComplete,
}: Readonly<{
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  placeholder: string;
  minLength?: number;
  autoComplete: string;
}>) {
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        minLength={minLength}
        className="input w-full pr-10"
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide' : 'Show'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-ndp-text-dim hover:text-ndp-text"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}
