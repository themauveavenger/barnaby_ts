import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<any>;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel('opencode-go', 'kimi-k2.5');

  fastify.decorate('agent', { authStorage, modelRegistry, model });
});
