import type { FastifyInstance } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { parseId } from '../../utils/params.js';
import { findRulesUsingCriterion } from '../../services/criterionRuleLinks.js';

/**
 * Admin-defined axes that describe *how* a title is wanted, and the values each one offers.
 *
 * Quality deliberately stays its own thing: it maps to a Radarr/Sonarr profile, where a criterion
 * only ever feeds a folder rule. An instance that routes French to one Radarr and subtitled
 * releases to another expresses that here, without the word "quality" having to mean language.
 */
export async function requestCriteriaRoutes(app: FastifyInstance) {
  app.get('/request-criteria', async () => prisma.requestCriterion.findMany({
    orderBy: { position: 'asc' },
    include: { values: { orderBy: { position: 'asc' } } },
  }));

  app.post('/request-criteria', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Criterion name, e.g. "Langue"' },
          showOnRequest: { type: 'boolean', description: 'Offer it as a picker when requesting' },
        },
      },
    },
  }, async (request, reply) => {
    const { name, showOnRequest } = request.body as { name: string; showOnRequest?: boolean };
    const trimmed = name.trim();
    if (!trimmed) return reply.status(400).send({ error: 'NAME_REQUIRED' });

    const clash = await prisma.requestCriterion.findUnique({ where: { name: trimmed } });
    if (clash) return reply.status(409).send({ error: 'NAME_TAKEN' });

    const maxPos = await prisma.requestCriterion.aggregate({ _max: { position: true } });
    const created = await prisma.requestCriterion.create({
      data: {
        name: trimmed,
        showOnRequest: showOnRequest ?? true,
        position: (maxPos._max.position ?? 0) + 1,
      },
      include: { values: true },
    });
    return reply.status(201).send(created);
  });

  app.put('/request-criteria/:id', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          showOnRequest: { type: 'boolean' },
          position: { type: 'number' },
        },
      },
    },
  }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (id === null) return reply.status(400).send({ error: 'INVALID_ID' });
    const patch = request.body as { name?: string; showOnRequest?: boolean; position?: number };

    const existing = await prisma.requestCriterion.findUnique({ where: { id } });
    if (!existing) return reply.status(404).send({ error: 'NOT_FOUND' });

    const name = patch.name?.trim();
    if (name && name !== existing.name) {
      const clash = await prisma.requestCriterion.findUnique({ where: { name } });
      if (clash) return reply.status(409).send({ error: 'NAME_TAKEN' });
      // Rules address a criterion by id, not by name, so renaming cannot orphan one. Kept explicit
      // because the quality options next door do have to rewrite their rules on rename.
    }

    return prisma.requestCriterion.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(patch.showOnRequest !== undefined ? { showOnRequest: patch.showOnRequest } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
      },
      include: { values: { orderBy: { position: 'asc' } } },
    });
  });

  app.delete('/request-criteria/:id', {
    schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const id = parseId((request.params as { id: string }).id);
    if (id === null) return reply.status(400).send({ error: 'INVALID_ID' });

    // A rule still pointing at this criterion would silently stop matching, and the admin would
    // hunt for why requests stopped being routed. Name the rules instead and let them decide.
    const rules = await findRulesUsingCriterion(id);
    if (rules.length > 0) {
      return reply.status(409).send({ error: 'CRITERION_IN_USE', rules: rules.map((r) => r.name) });
    }

    await prisma.requestCriterion.delete({ where: { id } });
    return { ok: true };
  });

  // === VALUES ===

  app.post('/request-criteria/:id/values', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['label'],
        properties: { label: { type: 'string', description: 'Value label, e.g. "VOSTFR"' } },
      },
    },
  }, async (request, reply) => {
    const criterionId = parseId((request.params as { id: string }).id);
    if (criterionId === null) return reply.status(400).send({ error: 'INVALID_ID' });
    const label = (request.body as { label: string }).label.trim();
    if (!label) return reply.status(400).send({ error: 'LABEL_REQUIRED' });

    const criterion = await prisma.requestCriterion.findUnique({ where: { id: criterionId } });
    if (!criterion) return reply.status(404).send({ error: 'NOT_FOUND' });

    const clash = await prisma.requestCriterionValue.findUnique({
      where: { criterionId_label: { criterionId, label } },
    });
    if (clash) return reply.status(409).send({ error: 'LABEL_TAKEN' });

    const maxPos = await prisma.requestCriterionValue.aggregate({
      where: { criterionId }, _max: { position: true },
    });
    const created = await prisma.requestCriterionValue.create({
      data: { criterionId, label, position: (maxPos._max.position ?? 0) + 1 },
    });
    return reply.status(201).send(created);
  });

  app.delete('/request-criteria/values/:valueId', {
    schema: { params: { type: 'object', required: ['valueId'], properties: { valueId: { type: 'string' } } } },
  }, async (request, reply) => {
    const valueId = parseId((request.params as { valueId: string }).valueId);
    if (valueId === null) return reply.status(400).send({ error: 'INVALID_ID' });

    // Requests that asked for it keep their history: the join row goes, the request stays. Refusing
    // while any active request holds it would leave the admin unable to retire a value until every
    // one of them is closed, which is not a trade worth making for a label.
    const active = await prisma.mediaRequestCriterion.count({ where: { valueId } });
    await prisma.requestCriterionValue.delete({ where: { id: valueId } });
    return { ok: true, detachedFromRequests: active };
  });
}
