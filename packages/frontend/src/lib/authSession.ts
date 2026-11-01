// A version separates requests from successive logins without exposing the httpOnly cookie.
let version = 0;
const expiryListeners = new Set<() => void>();

export function getAuthSessionVersion(): number { return version; }

export function advanceAuthSession(): number { return ++version; }

export function subscribeSessionExpired(listener: () => void): () => void {
  expiryListeners.add(listener);
  return () => { expiryListeners.delete(listener); };
}

export function expireAuthSession(requestVersion: number): void {
  // Concurrent failures expire once; a delayed response cannot invalidate a newer login.
  if (requestVersion !== version) return;
  advanceAuthSession();
  expiryListeners.forEach(listener => listener());
}
