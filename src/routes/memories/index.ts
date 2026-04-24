import type { FastifyInstance } from 'fastify';
import {
  createMemorySchema,
  getMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
} from './schemas.js';
import { createMemory, getMemory, listMemories, deleteMemory, getContext } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/context', getContext);
  fastify.get('/:id', { schema: getMemorySchema }, getMemory);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
