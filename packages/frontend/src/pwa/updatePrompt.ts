import i18n from '@/i18n';

/**
 * "A new version is available" banner.
 *
 * Replaces the old behaviour, where a service-worker takeover reloaded every open tab on its
 * own: an admin halfway through a service form, a plugin config or a long request list lost it
 * with no warning and no way to opt out. The new worker now waits, and the reload happens when
 * the person says so.
 *
 * Plain DOM on purpose — this runs from `main.tsx` before (and independently of) the React tree,
 * same as the toast helper in `utils/toast.ts`.
 */
const BANNER_ID = 'pwa-update-banner';

export function showUpdatePrompt(applyUpdate: () => void): void {
  if (document.getElementById(BANNER_ID)) return;

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  Object.assign(banner.style, {
    position: 'fixed',
    insetInlineStart: '50%',
    insetBlockEnd: '24px',
    transform: 'translateX(-50%)',
    zIndex: '9999',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: 'min(92vw, 520px)',
    padding: '12px 16px',
    borderRadius: '12px',
    background: 'rgba(10,14,23,0.96)',
    border: '1px solid rgba(99,102,241,0.35)',
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
    color: '#e6e8ee',
    font: '500 14px/1.4 Inter, system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);

  const message = document.createElement('span');
  message.style.flex = '1';
  message.textContent = i18n.t('pwa.update_available');

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = i18n.t('pwa.update_reload');
  Object.assign(reload.style, {
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    background: '#6366f1',
    color: '#fff',
    font: '600 13px/1 Inter, system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);
  reload.addEventListener('click', () => {
    reload.disabled = true;
    applyUpdate();
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = i18n.t('pwa.update_later');
  dismiss.setAttribute('aria-label', i18n.t('pwa.update_later'));
  Object.assign(dismiss.style, {
    padding: '6px 8px',
    borderRadius: '8px',
    border: 'none',
    cursor: 'pointer',
    background: 'transparent',
    color: '#9aa0ae',
    font: '500 13px/1 Inter, system-ui, sans-serif',
  } satisfies Partial<CSSStyleDeclaration>);
  // Dismiss only hides the banner: the waiting worker stays waiting, and the next full page
  // load picks the new build up on its own.
  dismiss.addEventListener('click', () => banner.remove());

  banner.append(message, reload, dismiss);
  document.body.appendChild(banner);
}
