import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
  }
}
