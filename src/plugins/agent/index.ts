import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { ModelRuntime, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

import createCalendarExtension from './extensions/google-calendar.js';
import { createYnabExtension } from 'pi-extension-for-ynab';
import createTelegramExtension from './extensions/telegram.js';
import createMemoryExtension from './extensions/memory.js';
import createWeatherExtension from './extensions/weather.js';
import createGoogleDriveExtension from './extensions/google-drive.js';
import createWolframAlphaExtension from './extensions/wolfram-alpha.js';
import createKagiExtension from './extensions/kagi.js';

const DEFAULT_AGENT_PROVIDER = 'opencode-go';
const DEFAULT_AGENT_MODEL = 'kimi-k2.6';

/** Thrown at startup when the configured provider/model pair cannot be resolved. */
export class ConfiguredModelUnavailableError extends Error {
  constructor(provider: string, modelId: string) {
    super(`Configured model ${provider}/${modelId} is not available`);
    this.name = 'ConfiguredModelUnavailableError';
  }
}

export interface AgentServices {
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  resourceLoader: DefaultResourceLoader;
}

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const modelRuntime = await ModelRuntime.create({});
  const provider = process.env.AGENT_PROVIDER || DEFAULT_AGENT_PROVIDER;
  const modelId = process.env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
  const model = modelRuntime.getModel(provider, modelId);
  if (!model) {
    throw new ConfiguredModelUnavailableError(provider, modelId);
  }

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
      createWolframAlphaExtension(fastify),
      createKagiExtension(fastify)
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

  fastify.decorate('agent', { modelRuntime, model, resourceLoader });
});
