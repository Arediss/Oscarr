import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { parseId } from '../../utils/params.js';
import { findRulesUsingQuality, renameQualityInRules } from '../../services/qualityRuleLinks.js';

export async function qualityRoutes(app: FastifyInstance) {
  // === QUALITY OPTIONS ===

  app.get('/quality-options', async (request, reply) => {

    return prisma.qualityOption.findMany({
      orderBy: { position: 'asc' },
      include: {
        mappings: {
          include: { service: { select: { id: true, name: true, type: true } } },
        },
      },
    });
  });

  app.post('/quality-options', {
    schema: {
      body: {
        type: 'object',
        required: ['label'],
        properties: {
          label: { type: 'string', description: 'Quality option label (e.g. SD, HD, 4K)' },
          position: { type: 'number', description: 'Display order position' },
        },
      },
    },
  }, async (request, reply) => {

    const { label, position } = request.body as { label: string; position?: number };
    if (!label) return reply.status(400).send({ error: 'Label required' });
    const maxPos = await prisma.qualityOption.aggregate({ _max: { position: true } });
    const option = await prisma.qualityOption.create({
      data: { label, position: position ?? (maxPos._max.position ?? 0) + 1 },
    });
    return reply.status(201).send(option);
  });

  app.put('/quality-options/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Quality option ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Quality option label' },
          position: { type: 'number', description: 'Display order position' },
          allowedRoles: { type: 'array', items: { type: 'string' }, nullable: true, description: 'Roles allowed to use this quality (null = all)' },
          approvalMode: { type: 'string', nullable: true, description: 'Approval override: null = inherit, "auto" = force auto, "manual" = force manual' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const optionId = parseId(id);
    if (!optionId) return reply.status(400).send({ error: 'Invalid ID' });
    const { label, position, allowedRoles, approvalMode } = request.body as {
      label?: string; position?: number; allowedRoles?: string[] | null; approvalMode?: string | null;
    };

    // Folder rules store the label, not the id. Capture the old one so a rename can carry the
    // rules with it instead of quietly orphaning them.
    const before = await prisma.qualityOption.findUnique({ where: { id: optionId }, select: { label: true } });
    if (!before) return reply.status(404).send({ error: 'Quality option not found' });

    const option = await prisma.qualityOption.update({
      where: { id: optionId },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(allowedRoles !== undefined ? { allowedRoles: allowedRoles && allowedRoles.length > 0 ? JSON.stringify(allowedRoles) : null } : {}),
        ...(approvalMode !== undefined ? { approvalMode: approvalMode === 'auto' || approvalMode === 'manual' ? approvalMode : null } : {}),
      },
    });

    const rulesUpdated = label !== undefined && label !== before.label
      ? await renameQualityInRules(before.label, label)
      : 0;
    return { ...option, rulesUpdated };
  });

  app.delete('/quality-options/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Quality option ID' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const optionId = parseId(id);
    if (!optionId) return reply.status(400).send({ error: 'Invalid ID' });

    const option = await prisma.qualityOption.findUnique({ where: { id: optionId }, select: { label: true } });
    if (!option) return reply.status(404).send({ error: 'Quality option not found' });

    // Refused rather than cascaded: unlike a rename, a delete has no obvious replacement, and
    // silently stripping the condition would change where those rules route media.
    const rules = await findRulesUsingQuality(option.label);
    if (rules.length > 0) {
      return reply.status(409).send({
        error: 'QUALITY_IN_USE_BY_RULES',
        rules: rules.map((r) => r.name),
      });
    }

    await prisma.qualityOption.delete({ where: { id: optionId } });
    return { ok: true };
  });

  // Seed default quality options
  app.post('/quality-options/seed', async (request, reply) => {

    const defaults = [
      { label: 'SD', position: 1 },
      { label: 'HD', position: 2 },
      { label: '4K', position: 3 },
      { label: '4K HDR', position: 4 },
    ];
    let created = 0;
    for (const d of defaults) {
      const exists = await prisma.qualityOption.findUnique({ where: { label: d.label } });
      if (!exists) {
        await prisma.qualityOption.create({ data: d });
        created++;
      }
    }
    return { created };
  });

  // Auto-map every available Radarr/Sonarr quality profile to one of the seeded Oscarr
  // tiers based on a simple name-matching heuristic. Idempotent — skips mappings that
  // already exist (same option/service/profile triplet). Used by the install wizard's
  // Defaults step to close the loop after seeding the quality tiers.
  app.post('/quality-mappings/auto', async (_request, reply) => {
    const { createArrClient } = await import('../../providers/index.js');
    const { parseServiceConfig } = await import('../../utils/services.js');

    const options = await prisma.qualityOption.findMany();
    if (options.length === 0) return { created: 0, scanned: 0, note: 'No quality options to map against — seed them first.' };
    const services = await prisma.service.findMany({
      where: { type: { in: ['radarr', 'sonarr'] }, enabled: true },
    });

    const labelMap = new Map<string, number>();
    for (const o of options) labelMap.set(o.label.toLowerCase(), o.id);

    /** Best-effort match from a Radarr/Sonarr profile name to one of the seeded tier labels.
     *  Order matters — check the most specific patterns first (HDR before plain 4K, UHD
     *  before HD). Unmatched profiles are skipped; the user can map them manually after. */
    function pickTier(profileName: string): number | undefined {
      const n = profileName.toLowerCase();
      if ((/4k|2160|uhd/.test(n)) && /hdr/.test(n)) return labelMap.get('4k hdr');
      if (/4k|2160|uhd/.test(n)) return labelMap.get('4k');
      if (/1080|720|hd/.test(n)) return labelMap.get('hd');
      if (/480|360|sd/.test(n)) return labelMap.get('sd');
      return undefined;
    }

    let created = 0;
    let scanned = 0;
    const failedServices: string[] = [];
    for (const svc of services) {
      let profiles: { id: number; name: string }[] = [];
      try {
        const config = parseServiceConfig(svc.config);
        const client = createArrClient(svc.type, config);
        profiles = await client.getQualityProfiles();
      } catch {
        failedServices.push(svc.name);
        continue;
      }
      for (const profile of profiles) {
        scanned++;
        const tierId = pickTier(profile.name);
        if (!tierId) continue;
        const exists = await prisma.qualityMapping.findFirst({
          where: { qualityOptionId: tierId, serviceId: svc.id, qualityProfileId: profile.id },
        });
        if (exists) continue;
        await prisma.qualityMapping.create({
          data: {
            qualityOptionId: tierId,
            serviceId: svc.id,
            qualityProfileId: profile.id,
            qualityProfileName: profile.name,
          },
        });
        created++;
      }
    }
    return reply.send({ created, scanned, failedServices });
  });

  // === QUALITY MAPPINGS ===

  app.get('/quality-mappings', async (request, reply) => {

    return prisma.qualityMapping.findMany({
      include: {
        qualityOption: true,
        service: { select: { id: true, name: true, type: true } },
      },
      orderBy: { qualityOptionId: 'asc' },
    });
  });

  app.post('/quality-mappings', {
    schema: {
      body: {
        type: 'object',
        required: ['qualityOptionId', 'serviceId', 'qualityProfileId', 'qualityProfileName'],
        properties: {
          qualityOptionId: { type: 'number', description: 'Quality option ID to map' },
          serviceId: { type: 'number', description: 'Service ID (Radarr/Sonarr) to map' },
          qualityProfileId: { type: 'number', description: 'Quality profile ID in the service' },
          qualityProfileName: { type: 'string', description: 'Quality profile display name in the service' },
        },
      },
    },
  }, async (request, reply) => {

    const { qualityOptionId, serviceId, qualityProfileId, qualityProfileName } = request.body as {
      qualityOptionId: number; serviceId: number; qualityProfileId: number; qualityProfileName: string;
    };
    if (!qualityOptionId || !serviceId || !qualityProfileId || !qualityProfileName) {
      return reply.status(400).send({ error: 'All fields are required' });
    }
    // Check for duplicate
    const existing = await prisma.qualityMapping.findFirst({
      where: { qualityOptionId, serviceId, qualityProfileId },
    });
    if (existing) {
      return reply.status(409).send({ error: 'This mapping already exists' });
    }
    const mapping = await prisma.qualityMapping.create({
      data: { qualityOptionId, serviceId, qualityProfileId, qualityProfileName },
      include: {
        qualityOption: true,
        service: { select: { id: true, name: true, type: true } },
      },
    });
    return reply.status(201).send(mapping);
  });

  app.delete('/quality-mappings/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Quality mapping ID' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const mappingId = parseId(id);
    if (!mappingId) return reply.status(400).send({ error: 'Invalid ID' });
    await prisma.qualityMapping.delete({ where: { id: mappingId } });
    return { ok: true };
  });
}
