import type { FastifyInstance } from 'fastify';
import { briefingTriggerSchema, afternoonUpdateTriggerSchema, listBriefingsSchema, deleteBriefingSchema } from './schemas.js';
import { briefingTriggerHandler, afternoonUpdateTriggerHandler, listBriefings, deleteBriefing } from './handlers.js';

export default async function briefingRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listBriefingsSchema }, listBriefings);
  fastify.post('/', { schema: briefingTriggerSchema }, briefingTriggerHandler);
  fastify.post('/afternoon', { schema: afternoonUpdateTriggerSchema }, afternoonUpdateTriggerHandler);
  fastify.delete('/:id', { schema: deleteBriefingSchema }, deleteBriefing);
}
