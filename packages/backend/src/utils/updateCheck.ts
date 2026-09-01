import semver from 'semver';

/**
 * Is `latest` (as published in version.json) actually newer than what this instance runs?
 *
 * This used to be `latest !== current`, which reports "update available" for any difference —
 * including a version.json left behind, which pointed running instances at an older build.
 * Anything unparseable is treated as "no update": a prompt invented from a malformed file is
 * worse than a missed one.
 */
export function isUpdateAvailable(latest: string | undefined | null, current: string): boolean {
  const a = semver.valid(semver.coerce(latest ?? '') ?? '');
  const b = semver.valid(current);
  if (!a || !b) return false;
  return semver.gt(a, b);
}
