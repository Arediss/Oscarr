import { z } from 'zod';
import { isVersionSupported, getSupportedVersions } from './context/index.js';
import { ALL_CAPABILITIES } from './types.js';

// Path guard for `entry` / `frontend`: no traversal, no absolute paths.
// `manifest.json` lives at `<pluginDir>/manifest.json`; these fields must resolve inside `<pluginDir>`.
const relativePath = z.string().refine(
  (v) => {
    const normalized = v.replaceAll(/\\/g, '/');
    return !normalized.startsWith('..') && !normalized.includes('/../') && !normalized.startsWith('/');
  },
  { message: 'path traversal or absolute path not allowed' }
);

const apiVersion = z.string().refine(isVersionSupported, {
  message: `unsupported apiVersion (supported: ${getSupportedVersions().join(', ')})`,
});

const settingDef = z.object({
  key: z.string().min(1),
  label: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'password']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
}).strict();

const jobDef = z.object({
  key: z.string().min(1),
  label: z.string(),
  cron: z.string().min(1),
}).strict();

const sizeSchema = z.object({
  w: z.number().int().positive(),
  h: z.number().int().positive(),
}).strict();

const dashboardWidgetPropsSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'must be lowercase alphanumeric + dashes'),
  title: z.string().min(1),
  icon: z.string().optional(),                    // Lucide icon name
  defaultSize: sizeSchema,
  minSize: sizeSchema.optional(),
  maxSize: sizeSchema.optional(),
}).strict();

const accountSectionPropsSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/, 'must be lowercase alphanumeric + dashes'),
  label: z.string().min(1),                       // i18n key or literal label
  icon: z.string().min(1),                        // Lucide icon name
  permission: z.string().optional(),              // RBAC gate (e.g. "subscription.view")
}).strict();

const uiContribution = z.object({
  hookPoint: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  order: z.number().optional(),
}).strict().superRefine((data, ctx) => {
  // Per-hook props validation so a malformed contribution is rejected at plugin load
  // instead of crashing the host at render time.
  const propsValidator = HOOK_POINT_PROPS_SCHEMAS[data.hookPoint];
  if (!propsValidator) return;
  const result = propsValidator.safeParse(data.props);
  if (!result.success) {
    for (const issue of result.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['props', ...issue.path],
        message: issue.message,
      });
    }
  }
});

const HOOK_POINT_PROPS_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'admin.dashboard.widget': dashboardWidgetPropsSchema,
  'account.section': accountSectionPropsSchema,
};

const routesDef = z.object({
  prefix: z.string().min(1).startsWith('/'),
}).strict();

const hooks = z.object({
  routes: routesDef.optional(),
  jobs: z.array(jobDef).optional(),
  ui: z.array(uiContribution).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
}).strict();

const capabilityEnum = z.enum(ALL_CAPABILITIES as unknown as [string, ...string[]]);

/** Strict format introduced in v0.8.0: `<owner>__<repo>`, lowercase, GitHub-aligned.
 *  - owner: matches GitHub username rules (alphanumeric + dashes, no underscores) so
 *    splitting at the first `__` is unambiguous.
 *  - repo: matches GitHub repo rules (alphanumeric + dot/underscore/dash).
 *  Required for plugins installed via the registry. Enforced at install/update endpoints,
 *  not at manifest parse time (legacy plugins must keep loading until the admin regularizes them). */
export const NEW_PLUGIN_ID_REGEX = /^[a-z0-9-]+__[a-z0-9._-]+$/;

/** Legacy format pre-v0.8.0: short kebab-case. Tolerated here so existing on-disk plugins
 *  keep loading after the v0.8.0 upgrade. The admin regularizes them via "Install from registry". */
const LEGACY_PLUGIN_ID_REGEX = /^[a-z0-9-]+$/;

const pluginManifestSchema = z.object({
  id: z.string().min(1).refine(
    (v) => NEW_PLUGIN_ID_REGEX.test(v) || LEGACY_PLUGIN_ID_REGEX.test(v),
    { message: 'must be `<owner>__<repo>` (new format) or lowercase alphanumeric+dashes (legacy)' },
  ),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion,
  description: z.string().optional(),
  author: z.string().optional(),
  entry: relativePath,
  frontend: relativePath.optional(),
  engines: z.object({
    oscarr: z.string().min(1),
    testedAgainst: z.array(z.string().min(1)).optional(),
  }).strict().optional(),
  services: z.array(z.string().min(1)).optional(),
  capabilities: z.array(capabilityEnum).optional(),
  capabilityReasons: z.partialRecord(capabilityEnum, z.string()).optional(),
  settings: z.array(settingDef).optional(),
  hooks: hooks.optional(),
}).strict();

type ParsedManifest = z.infer<typeof pluginManifestSchema>;

/** Parse + validate a manifest. Throws with a readable error including the field path on failure. */
export function parseManifest(data: unknown, dir: string): ParsedManifest {
  const result = pluginManifestSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `  ${path}: ${i.message}`;
    }).join('\n');
    throw new Error(`Invalid manifest in ${dir}:\n${issues}`);
  }
  return result.data;
}
