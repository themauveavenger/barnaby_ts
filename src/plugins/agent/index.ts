import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import createCalendarExtension from "./extensions/google-calendar.js";

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
    extensionFactories: [createCalendarExtension(fastify)],
    systemPrompt:
      "You are a helpful assistant for casual conversation and general questions. " +
      "Answer clearly, concisely, and in plain language. " +
      "Do not write or explain code unless the user explicitly asks for it.",
  });
  await resourceLoader.reload();

  fastify.decorate("agent", { authStorage, modelRegistry, model, resourceLoader });
});
