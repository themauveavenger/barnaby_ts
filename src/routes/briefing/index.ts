import type { FastifyInstance } from 'fastify';
import { briefingTriggerSchema, listBriefingsSchema, deleteBriefingSchema } from './schemas.js';
import { briefingTriggerHandler, listBriefings, deleteBriefing } from './handlers.js';

export default async function briefingRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listBriefingsSchema }, listBriefings);
  fastify.post('/', { schema: briefingTriggerSchema }, briefingTriggerHandler);
  fastify.delete('/:id', { schema: deleteBriefingSchema }, deleteBriefing);
}