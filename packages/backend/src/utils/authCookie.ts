import type { FastifyInstance, FastifyReply } from 'fastify';

export const AUTH_TOKEN_TTL = '24h';
export const AUTH_COOKIE_MAX_AGE = 24 * 60 * 60; // seconds, matches AUTH_TOKEN_TTL

/**
 * Should the auth cookie carry the Secure flag?
 *
 * `COOKIE_SECURE` wins in both directions when set. Otherwise the cookie follows the request —
 * except behind a TLS-terminating proxy, where the internal hop reads as plain http: an admin who
 * declared FORCE_HTTPS=true has stated the deployment is HTTPS (it is what HSTS is sent on), so
 * that declaration counts here too. Without this, a proxied instance quietly issued a
 * non-Secure session cookie.
 */
export function isSecureCookie(protocol: string): boolean {
  const declared = process.env.COOKIE_SECURE;
  if (declared === 'true') return true;
  if (declared === 'false') return false;
  return protocol === 'https' || process.env.FORCE_HTTPS === 'true';
}

/** Sign the auth JWT and set the `token` cookie. Returns the reply for chaining (.send/.redirect). */
export function setAuthCookie(
  reply: FastifyReply,
  app: FastifyInstance,
  user: { id: number; email: string; role: string },
): FastifyReply {
  const token = app.jwt.sign({ id: user.id, email: user.email, role: user.role }, { expiresIn: AUTH_TOKEN_TTL });
  return reply.setCookie('token', token, {
    path: '/',
    httpOnly: true,
    secure: isSecureCookie(reply.request.protocol),
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
}
