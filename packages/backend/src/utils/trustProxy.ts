import Fastify from 'fastify';

/**
 * Fastify's `trustProxy`, resolved from the environment.
 *
 * Secure by default: with nothing declared, `X-Forwarded-*` is ignored. The default used to be
 * "trust everything", which on a directly-exposed instance — the shipped compose runs
 * `network_mode: host` — let any client forge `X-Forwarded-For` and hand itself a fresh bucket
 * for the register / login / password-reset rate limits on every request.
 *
 * Accepted values: `false` (default), `true` (any proxy — only safe when nothing but the proxy
 * can reach the port), a hop count, or a comma-separated IP/CIDR allow-list such as
 * `127.0.0.1,172.18.0.0/16`. The last form is the one to use behind a reverse proxy.
 *
 * Anything Fastify cannot compile falls back to `false` with a warning. Fastify parses this value
 * at construction and throws `invalid IP address`, so a `TRUST_PROXY=True` or a stray trailing
 * comma used to kill the process at boot — before the guidance printed further down index.ts could
 * ever be read, and on a `restart: unless-stopped` container that is a silent restart loop. A typo
 * should cost the operator a warning and the documented default.
 *
 * The check is a throwaway Fastify construction rather than a parser of our own: it is the same
 * code that will consume the value seconds later, so the two cannot disagree.
 */
export function resolveTrustProxy(raw: string | undefined): boolean | number | string {
  const value = raw?.trim();
  if (!value) return false;

  const lowered = value.toLowerCase();
  if (lowered === 'false') return false;
  if (lowered === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);

  try {
    Fastify({ logger: false, trustProxy: value }).close();
    return value;
  } catch {
    process.stderr.write(
      `[TRUST_PROXY] Ignoring "${value}": not true, false, a hop count, or an IP/CIDR list.\n`
      + '              Falling back to false — X-Forwarded-* headers will be ignored, so behind a\n'
      + '              reverse proxy every client shares one rate-limit bucket. Fix the value.\n',
    );
    return false;
  }
}
