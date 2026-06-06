import type { FastifyInstance, FastifyRequest } from 'fastify';

export default async function configRoutes(fastify: FastifyInstance) {
  fastify.get('/config', async (_request, reply) => {
    const personalities = fastify.personalityRepository.findAll();
    const activePersonality = fastify.configRepository.get('personality') ?? 'yarnaby';

    return reply.view('config/index', {
      personalities,
      activePersonality
    });
  });

  fastify.post('/config', async (request: FastifyRequest<{ Body: { personality?: string } }>, reply) => {
    const personality = request.body.personality;
    if (personality) {
      fastify.configRepository.set('personality', personality);
      await fastify.agent.resourceLoader.reload();
    }
    return reply.redirect('/config');
  });
}
