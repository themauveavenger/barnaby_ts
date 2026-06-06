import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createMemoryRepository, createMemoryActionRepository } from './repositories/memory.js';

export type {
  MemoryActionType,
  Memory,
  MemoryAction,
  CreateMemoryBody,
  UpdateMemoryBody,
  ListMemoriesQuery,
  ResolvedMemory,
  MemoryRepository,
  MemoryActionRepository
} from './repositories/memory.js';

export { createMemoryRepository, createMemoryActionRepository } from './repositories/memory.js';

export default fp(async function repositoryPlugin(fastify: FastifyInstance) {
  const repo = createMemoryRepository(fastify.db);
  const actionRepo = createMemoryActionRepository(fastify.db);
  fastify.decorate('memoryRepository', repo);
  fastify.decorate('memoryActionRepository', actionRepo);
});
