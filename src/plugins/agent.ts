import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  fastify.decorate('agent', { authStorage, modelRegistry });
});
