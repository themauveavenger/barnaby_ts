import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createConfigRepository } from './repositories/config.js';
import { createPersonalityRepository } from './repositories/personality.js';

export default fp(async function configRepositoryPlugin(fastify: FastifyInstance) {
  const configRepository = createConfigRepository(fastify.db);
  const personalityRepository = createPersonalityRepository(fastify.db);
  fastify.decorate('configRepository', configRepository);
  fastify.decorate('personalityRepository', personalityRepository);
});
