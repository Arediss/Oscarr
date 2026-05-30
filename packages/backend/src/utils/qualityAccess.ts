import { logEvent } from './logEvent.js';

/** Whether a (non-admin) role may use a quality option. Callers handle the admin bypass.
 *  Corrupt allowedRoles JSON denies access (safe ACL default) and is logged. */
export function isQualityAllowedForRole(allowedRoles: string | null | undefined, role: string): boolean {
  if (!allowedRoles) return true;
  try {
    const roles = JSON.parse(allowedRoles) as string[];
    return roles.length === 0 || roles.includes(role);
  } catch (err) {
    logEvent('warn', 'Request', `Malformed allowedRoles JSON, denying access: ${allowedRoles.slice(0, 100)}`, err);
    return false;
  }
}
