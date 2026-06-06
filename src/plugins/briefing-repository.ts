import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createBriefingRepository } from './repositories/briefing.js';

export type {
  Briefing,
  CreateBriefingBody,
  ListBriefingsQuery,
  BriefingRepository
} from './repositories/briefing.js';

export { createBriefingRepository } from './repositories/briefing.js';

export default fp(async function briefingRepositoryPlugin(fastify: FastifyInstance) {
  const repo = createBriefingRepository(fastify.db);
  fastify.decorate('briefingRepository', repo);
});
