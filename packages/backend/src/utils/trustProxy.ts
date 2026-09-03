import Fastify, { type FastifyServerOptions } from 'fastify';

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
export function resolveTrustProxy(raw: string | undefined): FastifyServerOptions['trustProxy'] {
  const value = raw?.trim();
  if (!value) return false;

  const lowered = value.toLowerCase();
  if (lowered === 'false') return false;
  if (lowered === 'true') return true;
  // A hop count stays a number. Fastify 5.12 dropped `number` from the declared type but still
  // forwards it to proxy-addr, so it keeps working; removing the branch would send an existing
  // TRUST_PROXY=2 down the IP-list path, fail validation, and silently fall back to false, which
  // puts every client back in one rate-limit bucket. Both forms go through the same check below,
  // so the day Fastify does drop it, this degrades to a warning rather than a boot crash.
  const candidate: unknown = /^\d+$/.test(value) ? Number(value) : value;

  try {
    Fastify({ logger: false, trustProxy: candidate as string }).close();
    return candidate as FastifyServerOptions['trustProxy'];
  } catch {
    process.stderr.write(
      `[TRUST_PROXY] Ignoring "${value}": not true, false, a hop count, or an IP/CIDR list.\n`
      + '              Falling back to false — X-Forwarded-* headers will be ignored, so behind a\n'
      + '              reverse proxy every client shares one rate-limit bucket. Fix the value.\n',
    );
    return false;
  }
}
