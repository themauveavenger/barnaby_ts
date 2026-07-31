import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({}))
  }
}));

import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ModelRuntime, ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';
import { createSession } from '../../src/agent/session-factory.js';
import { MEMORY_TOOLS } from '../../src/agent/session-runner.js';

const agent = {
  modelRuntime: {} as unknown as ModelRuntime,
  model: {} as unknown as Model<Api>,
  resourceLoader: {} as unknown as ResourceLoader
};

describe('createSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a session with the supplied tools', async () => {
    const session = { dispose: vi.fn() };
    vi.mocked(createAgentSession).mockResolvedValue({ session } as never);

    const result = await createSession({ ...agent, tools: MEMORY_TOOLS });

    expect(result).toBe(session);
    expect(createAgentSession).toHaveBeenCalledWith({
      model: agent.model,
      modelRuntime: agent.modelRuntime,
      resourceLoader: agent.resourceLoader,
      sessionManager: expect.anything(),
      tools: MEMORY_TOOLS
    });
    expect(SessionManager.inMemory).toHaveBeenCalled();
  });
});
