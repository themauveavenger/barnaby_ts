import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';
import type { AgentServices } from '../plugins/agent.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
    agent: AgentServices;
  }
}
