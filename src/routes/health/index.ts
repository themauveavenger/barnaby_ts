import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    request.server.db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });
}