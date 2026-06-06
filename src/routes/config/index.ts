import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BadRequestError } from '../../plugins/error-handler.js';
import { clearSessionStore } from '../../services/telegram/session-store.js';

export default async function configRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/config', async (_request, reply) => {
    const personalities = fastify.personalityRepository.findAll();
    const activePersonality = fastify.configRepository.get('personality')
      ?? fastify.personalityRepository.findDefault()?.id
      ?? 'yarnaby';

    return reply.view('config/index', {
      personalities,
      activePersonality
    });
  });

  fastify.post('/config', async (request: FastifyRequest<{ Body: { personality?: string } }>, reply) => {
    const personality = request.body.personality;
    if (!personality) {
      throw new BadRequestError('Personality is required');
    }

    const found = fastify.personalityRepository.findById(personality);
    if (!found) {
      throw new BadRequestError(`Unknown personality: ${personality}`);
    }

    fastify.configRepository.set('personality', personality);
    clearSessionStore();
    await fastify.agent.resourceLoader.reload();

    return reply.redirect('/config');
  });
}
