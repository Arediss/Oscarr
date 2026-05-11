import type { FastifyInstance } from 'fastify';
import { execute, preview, type UserDecision } from '../../importers/runner.js';
import {
  jellyseerrAdapter,
  overseerrAdapter,
  seerrAdapter,
} from '../../importers/seerr.js';
import type { ImportAdapter, ImportSource } from '../../importers/types.js';

function pickAdapter(source: ImportSource): ImportAdapter {
  switch (source) {
    case 'overseerr':
      return overseerrAdapter;
    case 'jellyseerr':
      return jellyseerrAdapter;
    case 'seerr':
      return seerrAdapter;
    case 'ombi':
      throw new Error('Ombi importer not implemented yet.');
    default: {
      const _exhaustive: never = source;
      void _exhaustive;
      throw new Error(`Unknown import source: ${String(source)}`);
    }
  }
}

const credsSchema = {
  type: 'object',
  required: ['source', 'url', 'apiKey'],
  properties: {
    source: { type: 'string', enum: ['overseerr', 'jellyseerr', 'seerr', 'ombi'] },
    url: { type: 'string', minLength: 1 },
    apiKey: { type: 'string', minLength: 1 },
  },
} as const;

interface CredsBody {
  source: ImportSource;
  url: string;
  apiKey: string;
}

interface ExecuteBody extends CredsBody {
  decisions: UserDecision[];
}

export async function importRoutes(app: FastifyInstance) {
  app.post('/import/preview', { schema: { body: credsSchema } }, async (request, reply) => {
    const { source, url, apiKey } = request.body as CredsBody;
    try {
      const adapter = pickAdapter(source);
      const result = await preview(adapter, { url, apiKey });
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: 'IMPORT_PREVIEW_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.post('/import/execute', {
    schema: {
      body: {
        ...credsSchema,
        required: [...credsSchema.required, 'decisions'],
        properties: {
          ...credsSchema.properties,
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['sourceId', 'action'],
              properties: {
                sourceId: { type: 'string' },
                action: { type: 'string', enum: ['link', 'create', 'skip'] },
                oscarrUserId: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { source, url, apiKey, decisions } = request.body as ExecuteBody;
    try {
      const adapter = pickAdapter(source);
      const result = await execute(adapter, { url, apiKey }, decisions);
      return result;
    } catch (err) {
      return reply.status(400).send({
        error: 'IMPORT_EXECUTE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
