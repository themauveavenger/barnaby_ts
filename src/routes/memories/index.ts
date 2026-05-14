import type { FastifyInstance } from 'fastify';
import {
  createMemorySchema,
  updateMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
  createActionSchema,
  deleteActionSchema
} from './schemas.js';
import { createMemory, updateMemory, listMemories, deleteMemory, getContext, createAction, deleteAction } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/context', getContext);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.patch('/:id', { schema: updateMemorySchema }, updateMemory);
  fastify.post('/:id/actions', { schema: createActionSchema }, createAction);
  fastify.delete('/:id/actions/:actionId', { schema: deleteActionSchema }, deleteAction);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
