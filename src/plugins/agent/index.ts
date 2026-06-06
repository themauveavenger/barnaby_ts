import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { getModel } from '@earendil-works/pi-ai';
import type { Api, Model } from '@earendil-works/pi-ai';

import createCalendarExtension from './extensions/google-calendar.js';
import { createYnabExtension } from 'pi-extension-for-ynab';
import createTelegramExtension from './extensions/telegram.js';
import createMemoryExtension from './extensions/memory.js';
import createWeatherExtension from './extensions/weather.js';
import createGoogleDriveExtension from './extensions/google-drive.js';
import createWolframAlphaExtension from './extensions/wolfram-alpha.js';

export interface AgentServices {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<Api>;
  resourceLoader: DefaultResourceLoader;
}

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel('opencode-go', 'kimi-k2.6');

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
      createGoogleDriveExtension(fastify),
      createWolframAlphaExtension(fastify)
    ],
    appendSystemPromptOverride: (base: string[]): string[] => {
      const activeId = fastify.configRepository.get('personality')
        ?? fastify.personalityRepository.findDefault()?.id
        ?? 'yarnaby';
      const personality = fastify.personalityRepository.findById(activeId);
      if (!personality) {
        return base;
      }
      const lines = [personality.prompt];
      if (personality.examples) {
        lines.push(`\nHere are examples of how ${personality.name} speaks:\n${personality.examples}`);
      }
      return [...base, ...lines];
    }
  });
  await resourceLoader.reload();

  fastify.decorate('agent', { authStorage, modelRegistry, model, resourceLoader });
});
