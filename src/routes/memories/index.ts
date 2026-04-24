import type { FastifyInstance } from 'fastify';
import basicAuth from '@fastify/basic-auth';
import {
  createMemorySchema,
  getMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
} from './schemas.js';
import { createMemory, getMemory, listMemories, deleteMemory, getContext } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  await fastify.register(basicAuth, {
    validate: async (username, password) => {
      const expectedUser = process.env.BASIC_AUTH_USERNAME;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'barnaby' },
  });

  fastify.addHook('onRequest', fastify.basicAuth);

  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/context', getContext);
  fastify.get('/:id', { schema: getMemorySchema }, getMemory);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
