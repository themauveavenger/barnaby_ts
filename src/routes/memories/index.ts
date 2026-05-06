import type { FastifyInstance } from 'fastify';
import {
  createMemorySchema,
  getMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
  createActionSchema,
  deleteActionSchema,
} from './schemas.js';
import { createMemory, getMemory, listMemories, deleteMemory, getContext, createAction, deleteAction } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/context', getContext);
  fastify.get('/:id', { schema: getMemorySchema }, getMemory);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.post('/:id/actions', { schema: createActionSchema }, createAction);
  fastify.delete('/:id/actions/:actionId', { schema: deleteActionSchema }, deleteAction);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
