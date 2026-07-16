import type { FastifyInstance, FastifyReply } from 'fastify';
import { execute, preview, type UserDecision } from '../../importers/runner.js';
import {
  jellyseerrAdapter,
  overseerrAdapter,
  seerrAdapter,
} from '../../importers/seerr.js';
import type { ImportAdapter, ImportSource } from '../../importers/types.js';
import { deriveConfigFromSeerr } from '../../importers/seerrConfig.js';
import { applyDerivedConfig } from '../../importers/seerrConfigExecutor.js';
import { assertPublicUrl, SsrfBlockedError } from '../../utils/ssrfGuard.js';
import { markInstalled, isInstalled } from '../../utils/install.js';
import { initScheduler } from '../../services/scheduler.js';

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

/** Assert `url` is public; on an SSRF-guard block, send the 400 and return true so the caller bails.
 *  Re-throws anything else. Single owner for the 4 import endpoints that probe a user-supplied URL. */
async function ssrfBlocked(url: string, reply: FastifyReply): Promise<boolean> {
  try {
    await assertPublicUrl(url);
    return false;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      await reply.status(400).send({ error: 'URL_BLOCKED_BY_SSRF_GUARD', detail: err.message });
      return true;
    }
    throw err;
  }
}

export async function importRoutes(app: FastifyInstance) {
  app.post('/import/preview', { schema: { body: credsSchema } }, async (request, reply) => {
    const { source, url, apiKey } = request.body as CredsBody;
    if (await ssrfBlocked(url, reply)) return;
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
    if (await ssrfBlocked(url, reply)) return;
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

  // Migration-driven config import — used by the install wizard's Migrate path to
  // bootstrap Oscarr with the source's services, default folders and locale.
  const configCredsSchema = {
    type: 'object',
    required: ['source', 'url', 'apiKey'],
    properties: {
      source: { type: 'string', enum: ['overseerr', 'jellyseerr', 'seerr'] },
      url: { type: 'string', minLength: 1 },
      apiKey: { type: 'string', minLength: 1 },
    },
  } as const;

  app.post('/import/config-probe', { schema: { body: configCredsSchema } }, async (request, reply) => {
    const { url, apiKey } = request.body as { source: ImportSource; url: string; apiKey: string };
    if (await ssrfBlocked(url, reply)) return;
    try {
      return await deriveConfigFromSeerr({ url, apiKey });
    } catch (err) {
      return reply.status(400).send({
        error: 'CONFIG_PROBE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  app.post('/import/config-execute', { schema: { body: configCredsSchema } }, async (request, reply) => {
    const { url, apiKey } = request.body as { source: ImportSource; url: string; apiKey: string };
    if (await ssrfBlocked(url, reply)) return;
    try {
      const derived = await deriveConfigFromSeerr({ url, apiKey });
      if (!derived.reachable) {
        return reply.status(400).send({ error: 'SOURCE_UNREACHABLE', message: 'Source unreachable or API key invalid.' });
      }
      const result = await applyDerivedConfig(derived);
      // Mirror what /setup/sync does on the Fresh path: flip the install flag and arm the
      // scheduler. Without this, the SPA keeps redirecting to /install on every reload
      // because /setup/install-status still reports installed:false, and cron jobs stay
      // dormant until the next backend restart.
      if (!isInstalled()) {
        markInstalled();
        await initScheduler();
      }
      return { derived, result };
    } catch (err) {
      return reply.status(400).send({
        error: 'CONFIG_EXECUTE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
