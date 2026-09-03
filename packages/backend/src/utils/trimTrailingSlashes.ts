/**
 * Drop trailing slashes from a base URL.
 *
 * A backwards scan rather than `replace(/\/+$/, '')`: that regex backtracks polynomially on a long
 * run of trailing slashes, and every caller here feeds it a URL an admin typed or an importer read
 * from a foreign instance. The same fix was already written by hand in `importers/seerr.ts` and
 * `importers/seerrConfig.ts`, each with a note pointing at the other — a dozen copies of a
 * one-line loop is what this file replaces.
 */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}
