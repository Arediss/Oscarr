import type { FastifyInstance } from 'fastify';
import { buildStatusResponse } from '../adapters/status.js';

export async function statusRoutes(app: FastifyInstance) {
  app.get('/status', async () => buildStatusResponse());
}
