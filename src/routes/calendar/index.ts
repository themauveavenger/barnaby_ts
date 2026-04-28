import type { FastifyInstance } from 'fastify';
import { calendarSchema } from './schemas.js';
import { calendarHandler } from './handlers.js';

export default async function calendarRoutes(fastify: FastifyInstance) {
  fastify.post('/events', { schema: calendarSchema }, calendarHandler);
}
