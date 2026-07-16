import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { parseId } from '../../utils/params.js';
import { checkRuleService } from '../../services/folderRules.js';
import { validateRulePayload } from '../../services/folderRuleValidation.js';

export async function folderRulesRoutes(app: FastifyInstance) {
  // === FOLDER RULES ===

  app.get('/folder-rules', async (request, reply) => {
    // Annotate each rule with its service health so the panel can flag non-functional rules (H1):
    // 'missing' | 'disabled' | 'wrong-type' → "La règle ne fonctionnera pas."
    const rules = await prisma.folderRule.findMany({ orderBy: { priority: 'asc' } });
    return Promise.all(rules.map(async (r) => ({ ...r, serviceStatus: await checkRuleService(r.serviceId, r.mediaType) })));
  });

  app.post('/folder-rules', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'mediaType', 'conditions', 'folderPath'],
        properties: {
          name: { type: 'string', description: 'Rule display name' },
          mediaType: { type: 'string', description: 'Media type this rule applies to (movie, tv)' },
          conditions: { type: 'array', description: 'Array of condition objects for matching' },
          folderPath: { type: 'string', description: 'Target root folder path' },
          seriesType: { type: 'string', description: 'Series type filter (e.g. anime)' },
          priority: { type: 'number', description: 'Rule priority (lower = higher priority)' },
          serviceId: { type: 'number', description: 'Associated service ID' },
        },
      },
    },
  }, async (request, reply) => {

    const { name, mediaType, conditions, folderPath, seriesType, priority, serviceId } = request.body as {
      name: string; mediaType: string; conditions: unknown[]; folderPath: string; seriesType?: string; priority?: number; serviceId?: number;
    };
    if (!name || !mediaType || !conditions || !folderPath) {
      return reply.status(400).send({ error: 'All fields are required' });
    }
    const validationError = await validateRulePayload({ mediaType, conditions, seriesType, serviceId });
    if (validationError) return reply.status(400).send({ error: validationError });
    const rule = await prisma.folderRule.create({
      data: {
        name,
        mediaType,
        conditions: JSON.stringify(conditions),
        folderPath,
        seriesType: seriesType || null,
        priority: priority ?? 0,
        serviceId: serviceId ?? null,
      },
    });
    return reply.status(201).send(rule);
  });

  app.put('/folder-rules/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Folder rule ID' },
        },
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Rule display name' },
          mediaType: { type: 'string', description: 'Media type this rule applies to' },
          conditions: { type: 'array', description: 'Array of condition objects for matching' },
          folderPath: { type: 'string', description: 'Target root folder path' },
          seriesType: { type: 'string', description: 'Series type filter (e.g. anime)' },
          priority: { type: 'number', description: 'Rule priority (lower = higher priority)' },
          serviceId: { type: ['number', 'null'], description: 'Associated service ID, or null to unset' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const ruleId = parseId(id);
    if (!ruleId) return reply.status(400).send({ error: 'Invalid ID' });
    const { name, mediaType, conditions, folderPath, seriesType, priority, serviceId } = request.body as {
      name?: string; mediaType?: string; conditions?: unknown[]; folderPath?: string; seriesType?: string; priority?: number; serviceId?: number | null;
    };
    // Validate the EFFECTIVE payload (provided fields merged over the stored rule), so a partial
    // update can't leave a rule in a never-fires / wrong-service state.
    const existing = await prisma.folderRule.findUnique({ where: { id: ruleId } });
    if (!existing) return reply.status(404).send({ error: 'Rule not found' });
    let effConditions: unknown = conditions;
    if (effConditions === undefined) {
      try { effConditions = JSON.parse(existing.conditions); } catch { effConditions = existing.conditions; }
    }
    // Only re-validate a cross-field concern when the field it depends on is actually changing (a
    // mediaType change re-enables both). Otherwise an unrelated edit (rename, folderPath) can't be
    // blocked by a pre-existing service/condition problem the admin may be trying to repair.
    const mediaTypeChanged = mediaType !== undefined && mediaType !== existing.mediaType;
    const validationError = await validateRulePayload(
      {
        mediaType: mediaType ?? existing.mediaType,
        conditions: effConditions,
        seriesType: seriesType !== undefined ? (seriesType || null) : existing.seriesType,
        serviceId: serviceId !== undefined ? serviceId : existing.serviceId,
      },
      {
        skipConditions: conditions === undefined && !mediaTypeChanged,
        skipService: serviceId === undefined && !mediaTypeChanged,
      },
    );
    if (validationError) return reply.status(400).send({ error: validationError });
    const rule = await prisma.folderRule.update({
      where: { id: ruleId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(mediaType !== undefined ? { mediaType } : {}),
        ...(conditions !== undefined ? { conditions: JSON.stringify(conditions) } : {}),
        ...(folderPath !== undefined ? { folderPath } : {}),
        ...(seriesType !== undefined ? { seriesType: seriesType || null } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(serviceId !== undefined ? { serviceId } : {}),
      },
    });
    return reply.send(rule);
  });

  app.delete('/folder-rules/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'Folder rule ID' },
        },
      },
    },
  }, async (request, reply) => {

    const { id } = request.params as { id: string };
    const ruleId = parseId(id);
    if (!ruleId) return reply.status(400).send({ error: 'Invalid ID' });
    await prisma.folderRule.delete({ where: { id: ruleId } });
    return reply.send({ ok: true });
  });

  // Reorder folder rules
  app.put('/folder-rules/reorder', {
    schema: {
      body: {
        type: 'object',
        required: ['ids'],
        properties: {
          ids: { type: 'array', items: { type: 'number' }, description: 'Rule IDs in desired order' },
        },
      },
    },
  }, async (request, reply) => {
    const { ids } = request.body as { ids: number[] };
    await Promise.all(ids.map((id, i) => prisma.folderRule.update({ where: { id }, data: { priority: i } })));
    return reply.send({ ok: true });
  });

  // Toggle folder rule enabled/disabled
  app.patch('/folder-rules/:id/toggle', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ruleId = parseId(id);
    if (!ruleId) return reply.status(400).send({ error: 'Invalid ID' });
    const rule = await prisma.folderRule.findUnique({ where: { id: ruleId } });
    if (!rule) return reply.status(404).send({ error: 'Rule not found' });
    const updated = await prisma.folderRule.update({ where: { id: ruleId }, data: { enabled: !rule.enabled } });
    return reply.send(updated);
  });

  // Duplicate a folder rule
  app.post('/folder-rules/:id/duplicate', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const ruleId = parseId(id);
    if (!ruleId) return reply.status(400).send({ error: 'Invalid ID' });
    const rule = await prisma.folderRule.findUnique({ where: { id: ruleId } });
    if (!rule) return reply.status(404).send({ error: 'Rule not found' });
    const count = await prisma.folderRule.count();
    const copy = await prisma.folderRule.create({
      data: {
        name: `${rule.name} (2)`,
        priority: count,
        mediaType: rule.mediaType,
        conditions: rule.conditions,
        folderPath: rule.folderPath,
        seriesType: rule.seriesType,
        serviceId: rule.serviceId,
        enabled: false,
      },
    });
    return reply.status(201).send(copy);
  });
}
