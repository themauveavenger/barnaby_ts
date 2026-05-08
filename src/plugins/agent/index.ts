import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { BARNABY_PERSONALITY } from "../../agent/personality.js";
import createCalendarExtension from "./extensions/google-calendar.js";
import createYnabExtension from "./extensions/ynab/index.js";
import createTelegramExtension from "./extensions/telegram.js";
import createMemoryExtension from "./extensions/memory.js";

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<any>;
  resourceLoader: DefaultResourceLoader;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel("opencode-go", "minimax-m2.7");

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: "/dev/null",
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      createCalendarExtension(fastify),
      createYnabExtension(fastify),
      createTelegramExtension(fastify),
      createMemoryExtension(fastify)
    ],
    systemPrompt: BARNABY_PERSONALITY,
  });
  await resourceLoader.reload();

  fastify.decorate("agent", { authStorage, modelRegistry, model, resourceLoader });
});
