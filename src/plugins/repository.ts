import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { createMemoryRepository } from './repositories/memory.js';
import { createMemoryActionRepository } from './repositories/memory-action.js';
import { createEntityRepository } from './repositories/entity.js';

export type {
  Memory,
  CreateMemoryBody,
  UpdateMemoryBody,
  ListMemoriesQuery,
  ResolvedMemory,
  MemoryRepository
} from './repositories/memory.js';

export type {
  MemoryActionType,
  MemoryAction,
  MemoryActionRepository
} from './repositories/memory-action.js';

export type {
  Entity,
  EntityAlias,
  EntityKind,
  EntityRepository
} from './repositories/entity.js';

export { createMemoryRepository } from './repositories/memory.js';
export { createMemoryActionRepository } from './repositories/memory-action.js';
export { createEntityRepository, extractEntities } from './repositories/entity.js';

/**
 * Fastify plugin that wires up the entity, memory and memory-action
 * repositories and decorates the Fastify instance with them.
 *
 * Repositories are created once at startup and reused for the lifetime
 * of the application so that prepared statements are cached by
 * better-sqlite3.
 */
export default fp(async function repositoryPlugin(fastify: FastifyInstance) {
  const entityRepo = createEntityRepository(fastify.db);
  const repo = createMemoryRepository(fastify.db, entityRepo);
  const actionRepo = createMemoryActionRepository(fastify.db);
  fastify.decorate('entityRepository', entityRepo);
  fastify.decorate('memoryRepository', repo);
  fastify.decorate('memoryActionRepository', actionRepo);
});
