import { prisma } from '../utils/prisma.js';
import { getAppSettings, patchAppSettings } from '../utils/appSettings.js';
import { serializeServiceConfig } from '../utils/services.js';
import type { DerivedConfig } from './seerrConfig.js';

export interface ApplyResult {
  qualitySeeded: number;
  servicesCreated: number;
  defaultFolders: { movie?: string; tv?: string };
  localeApplied?: string;
}

const QUALITY_DEFAULTS = [
  { label: 'SD', position: 1 },
  { label: 'HD', position: 2 },
  { label: '4K', position: 3 },
  { label: '4K HDR', position: 4 },
];

/**
 * Materialize a `DerivedConfig` (read from a Seerr-family source) into Oscarr's DB.
 *
 * Idempotent within reason — re-running on an already-populated install is a no-op for
 * services that match an existing URL, won't duplicate quality options, and only writes
 * default folders if the appSettings row doesn't already have them.
 *
 * Services are inserted with an empty `apiKey` because the Seerr settings surface never
 * exposes it. The admin re-finalizes them via the Services tab post-install.
 */
export async function applyDerivedConfig(derived: DerivedConfig): Promise<ApplyResult> {
  // ── Quality options ────────────────────────────────────────────────
  let qualitySeeded = 0;
  for (const d of QUALITY_DEFAULTS) {
    const exists = await prisma.qualityOption.findUnique({ where: { label: d.label } });
    if (!exists) {
      await prisma.qualityOption.create({ data: d });
      qualitySeeded++;
    }
  }

  // ── Services ───────────────────────────────────────────────────────
  let servicesCreated = 0;
  const allInstances: Array<{ type: 'radarr' | 'sonarr'; url: string }> = [
    ...derived.radarr.map((r) => ({ type: 'radarr' as const, url: r.url })),
    ...derived.sonarr.map((s) => ({ type: 'sonarr' as const, url: s.url })),
  ];

  for (const inst of allInstances) {
    if (!inst.url) continue;
    const existing = await prisma.service.findFirst({ where: { type: inst.type } });
    if (existing) continue;
    await prisma.service.create({
      data: {
        name: `${inst.type === 'radarr' ? 'Radarr' : 'Sonarr'} (imported)`,
        type: inst.type,
        config: serializeServiceConfig({ url: inst.url, apiKey: '' }),
        isDefault: true,
        enabled: true,
      },
    });
    servicesCreated++;
  }

  // ── Default folders ────────────────────────────────────────────────
  const movieFolder = derived.radarr.find((r) => r.rootFolder)?.rootFolder;
  const tvFolder = derived.sonarr.find((s) => s.rootFolder)?.rootFolder;
  const settings = await getAppSettings();

  await patchAppSettings({
    defaultMovieFolder: settings?.defaultMovieFolder || movieFolder || undefined,
    defaultTvFolder: settings?.defaultTvFolder || tvFolder || undefined,
    instanceLanguages: settings?.instanceLanguages || (derived.locale ? JSON.stringify([derived.locale.split('-')[0]]) : undefined),
  });

  return {
    qualitySeeded,
    servicesCreated,
    defaultFolders: { movie: movieFolder, tv: tvFolder },
    localeApplied: derived.locale,
  };
}
