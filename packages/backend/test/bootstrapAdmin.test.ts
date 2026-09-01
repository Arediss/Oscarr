import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { prisma } from '../src/utils/prisma.js';
import { loadMasterKeyOrExit } from '../src/utils/secrets.js';

loadMasterKeyOrExit();

const SETUP_SECRET = 'test-setup-secret-long-enough-to-be-real';
process.env.SETUP_SECRET = SETUP_SECRET;

// setup.ts reads SETUP_SECRET at module scope, so it has to be set before the import lands.
const { authRoutes } = await import('../src/routes/auth.js');
const { setupRoutes } = await import('../src/routes/setup.js');
const { updateProviderSettings } = await import('../src/providers/authSettings.js');

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(cookie);
  await app.register(jwt, { secret: process.env.JWT_SECRET as string, cookie: { cookieName: 'token', signed: false } });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.ready();
});

beforeEach(async () => {
  await prisma.userProvider.deleteMany();
  await prisma.user.deleteMany();
});

const account = { email: 'owner@test.local', password: 'correct horse battery', displayName: 'Owner' };

function register(body: Record<string, unknown> = account) {
  return app.inject({ method: 'POST', url: '/api/auth/register', payload: body });
}

function bootstrap(body: Record<string, unknown> = account, secret: string | null = SETUP_SECRET) {
  return app.inject({
    method: 'POST',
    url: '/api/setup/admin',
    payload: body,
    headers: secret === null ? {} : { 'x-setup-secret': secret },
  });
}

describe('first-admin bootstrap', () => {
  // The hole this closes: /api/auth/register is public and used to hand the `admin` role to
  // whoever created the first account. Anyone who could reach the port before the operator
  // finished the wizard owned the instance.
  it('refuses a public registration while the instance has no account', async () => {
    const res = await register();

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SETUP_REQUIRED');
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses to bootstrap without the setup secret', async () => {
    const res = await bootstrap(account, null);

    expect(res.statusCode).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it('refuses to bootstrap with the wrong setup secret', async () => {
    const res = await bootstrap(account, 'not-the-secret');

    expect(res.statusCode).toBe(401);
    expect(await prisma.user.count()).toBe(0);
  });

  it('creates the admin when the setup secret checks out', async () => {
    const res = await bootstrap();

    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1);
  });

  it('refuses a second bootstrap once an account exists', async () => {
    await bootstrap();
    const res = await bootstrap({ ...account, email: 'second@test.local' });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('ADMIN_EXISTS');
    expect(await prisma.user.count()).toBe(1);
  });

  // Single-flight: two callers racing on an empty instance must not both read "no users" and
  // both walk away with an admin account.
  it('creates exactly one admin under concurrent bootstrap calls', async () => {
    const results = await Promise.all([
      bootstrap({ ...account, email: 'a@test.local' }),
      bootstrap({ ...account, email: 'b@test.local' }),
      bootstrap({ ...account, email: 'c@test.local' }),
    ]);

    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1);
  });

  it('never grants admin through public registration', async () => {
    await bootstrap();
    await updateProviderSettings('email', { enabled: true, config: { allowSignup: true } });

    const res = await register({ email: 'member@test.local', password: 'correct horse battery', displayName: 'Member' });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('user');
  });

  it('still honours the email provider signup toggle', async () => {
    await bootstrap();
    await updateProviderSettings('email', { enabled: true, config: { allowSignup: false } });

    const res = await register({ email: 'member@test.local', password: 'correct horse battery', displayName: 'Member' });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('SIGNUP_NOT_ALLOWED');
  });
});
