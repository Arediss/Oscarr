import type { FastifyInstance } from 'fastify';
import { getAppSettings, patchAppSettings } from '../../utils/appSettings.js';
import { logEvent } from '../../utils/logEvent.js';

const DEFAULT_LAYOUT = {
  version: 2,
  tabs: [{
    id: 'main',
    name: 'Main',
    items: [
      { i: 'builtin:stats-counters', x: 0, y: 0, w: 12, h: 2 },
      { i: 'builtin:service-health', x: 0, y: 2, w: 6,  h: 5 },
      { i: 'builtin:system',         x: 6, y: 2, w: 6,  h: 3 },
    ],
  }],
} as const;

const itemSchema = {
  type: 'object',
  required: ['i', 'x', 'y', 'w', 'h'],
  additionalProperties: false,
  properties: {
    i: { type: 'string', minLength: 1, maxLength: 200 },
    x: { type: 'integer', minimum: 0, maximum: 1000 },
    y: { type: 'integer', minimum: 0, maximum: 1000 },
    w: { type: 'integer', minimum: 1, maximum: 100 },
    h: { type: 'integer', minimum: 1, maximum: 100 },
    customTitle: { type: 'string', maxLength: 80 },
    customIcon: { type: 'string', maxLength: 30 },
    showTitle: { type: 'boolean' },
  },
} as const;

const layoutBodySchema = {
  type: 'object',
  required: ['version', 'tabs'],
  additionalProperties: false,
  properties: {
    version: { type: 'integer', const: 2 },
    tabs: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        required: ['id', 'name', 'items'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9-]+$', minLength: 1, maxLength: 50 },
          name: { type: 'string', minLength: 1, maxLength: 50 },
          icon: { type: 'string', maxLength: 30 },
          items: { type: 'array', maxItems: 100, items: itemSchema },
        },
      },
    },
  },
} as const;

interface LayoutItemV1 { i: string; x: number; y: number; w: number; h: number }
interface LayoutV1 { version: 1; items: LayoutItemV1[] }
interface LayoutV2 { version: 2; tabs: { id: string; name: string; items: LayoutItemV1[] }[] }

/** Wrap a v1 payload (single flat list) in a single 'main' tab so the frontend always sees v2. */
function migrate(stored: unknown): LayoutV2 {
  if (stored && typeof stored === 'object' && 'version' in stored) {
    const v = (stored as { version?: unknown }).version;
    if (v === 2) return stored as LayoutV2;
    if (v === 1) {
      const items = (stored as LayoutV1).items ?? [];
      return { version: 2, tabs: [{ id: 'main', name: 'Main', items }] };
    }
  }
  return DEFAULT_LAYOUT as unknown as LayoutV2;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard-layout', async () => {
    const settings = await getAppSettings();
    if (!settings?.adminDashboardLayout) return DEFAULT_LAYOUT;
    try {
      return migrate(JSON.parse(settings.adminDashboardLayout));
    } catch (err) {
      logEvent('warn', 'AdminDashboard', `Invalid adminDashboardLayout JSON, returning defaults: ${String(err)}`);
      return DEFAULT_LAYOUT;
    }
  });

  app.put('/dashboard-layout', { schema: { body: layoutBodySchema } }, async (request) => {
    const body = request.body as LayoutV2;
    await patchAppSettings({ adminDashboardLayout: JSON.stringify(body) });
    return { ok: true };
  });

  app.delete('/dashboard-layout', async () => {
    await patchAppSettings({ adminDashboardLayout: null });
    return { ok: true };
  });
}
