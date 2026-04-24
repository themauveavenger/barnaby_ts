import type { FastifyInstance } from 'fastify';
import { chatSchema } from './schemas.js';
import { chatHandler } from './handlers.js';

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/', { schema: chatSchema }, chatHandler);
}
