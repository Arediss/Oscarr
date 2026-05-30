import type { FastifyInstance, FastifyReply } from 'fastify';

export const AUTH_TOKEN_TTL = '24h';
export const AUTH_COOKIE_MAX_AGE = 24 * 60 * 60; // seconds, matches AUTH_TOKEN_TTL

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
    secure: process.env.COOKIE_SECURE === 'true'
      || (process.env.COOKIE_SECURE !== 'false' && reply.request.protocol === 'https'),
    sameSite: 'lax',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
}
