import type { FastifyInstance } from 'fastify';
import { briefingTriggerSchema } from './schemas.js';
import { briefingTriggerHandler } from './handlers.js';

export default async function briefingRoutes(fastify: FastifyInstance) {
  fastify.post('/', { schema: briefingTriggerSchema }, briefingTriggerHandler);
}
