import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentSession, ModelRuntime, ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

export interface CreateSessionOptions {
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  resourceLoader: ResourceLoader;
  tools: readonly string[];
}

/** Creates a live session. The caller is responsible for disposing it. */
export async function createSession(options: CreateSessionOptions): Promise<AgentSession> {
  const { model, modelRuntime, resourceLoader, tools } = options;
  const { session } = await createAgentSession({
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    tools: [...tools]
  });
  return session;
}
