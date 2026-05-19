import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';
import { BARNABY_PERSONALITY } from '../../agent/personality.js';
import createCalendarExtension from './extensions/google-calendar.js';
import { createYnabExtension } from 'pi-extension-for-ynab';
import createTelegramExtension from './extensions/telegram.js';
import createMemoryExtension from './extensions/memory.js';
import createWeatherExtension from './extensions/weather.js';
import createGoogleDriveExtension from './extensions/google-drive.js';

export interface AgentServices {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<Api>;
  resourceLoader: DefaultResourceLoader;
}

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel('opencode-go', 'kimi-k2.5');

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: '/dev/null',
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      createCalendarExtension(fastify),
      createYnabExtension(),
      createTelegramExtension(fastify),
      createMemoryExtension(fastify),
      createWeatherExtension(fastify),
      createGoogleDriveExtension(fastify)
    ],
    appendSystemPrompt: [BARNABY_PERSONALITY]
  });
  await resourceLoader.reload();

  fastify.decorate('agent', { authStorage, modelRegistry, model, resourceLoader });
});
