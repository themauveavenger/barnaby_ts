import Fastify from 'fastify';
import agentPlugin, { ConfiguredModelUnavailableError } from '../../src/plugins/agent/index.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, mockGetModel, mockReload } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockGetModel: vi.fn(),
  mockReload: vi.fn()
}));

vi.mock('@earendil-works/pi-coding-agent', () => ({
  ModelRuntime: {
    create: mockCreate
  },
  DefaultResourceLoader: class {
    reload = mockReload;
  }
}));

interface AppWithAgent {
  agent: {
    model: { id: string };
    modelRuntime: unknown;
    resourceLoader: unknown;
  };
}

describe('agent plugin model selection', () => {
  const originalProvider = process.env.AGENT_PROVIDER;
  const originalModel = process.env.AGENT_MODEL;

  beforeEach(() => {
    mockCreate.mockReset();
    mockGetModel.mockReset();
    mockReload.mockReset();
    mockCreate.mockResolvedValue({ getModel: mockGetModel });
    mockReload.mockResolvedValue(undefined);
    delete process.env.AGENT_PROVIDER;
    delete process.env.AGENT_MODEL;
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.AGENT_PROVIDER;
    } else {
      process.env.AGENT_PROVIDER = originalProvider;
    }
    if (originalModel === undefined) {
      delete process.env.AGENT_MODEL;
    } else {
      process.env.AGENT_MODEL = originalModel;
    }
  });

  it('uses opencode-go/kimi-k2.6 when AGENT_PROVIDER and AGENT_MODEL are unset', async () => {
    const model = { id: 'kimi-k2.6' };
    mockGetModel.mockReturnValue(model);

    const app = Fastify({ logger: false });
    await app.register(agentPlugin);
    await app.ready();

    expect(mockGetModel).toHaveBeenCalledWith('opencode-go', 'kimi-k2.6');
    expect((app as unknown as AppWithAgent).agent.model).toBe(model);

    await app.close();
  });

  it('treats empty AGENT_PROVIDER and AGENT_MODEL values as unset', async () => {
    process.env.AGENT_PROVIDER = '';
    process.env.AGENT_MODEL = '';
    const model = { id: 'kimi-k2.6' };
    mockGetModel.mockReturnValue(model);

    const app = Fastify({ logger: false });
    await app.register(agentPlugin);
    await app.ready();

    expect(mockGetModel).toHaveBeenCalledWith('opencode-go', 'kimi-k2.6');
    expect((app as unknown as AppWithAgent).agent.model).toBe(model);

    await app.close();
  });

  it('forwards a configured AGENT_PROVIDER/AGENT_MODEL pair to getModel', async () => {
    process.env.AGENT_PROVIDER = 'test-provider';
    process.env.AGENT_MODEL = 'test-model';
    const model = { id: 'test-model' };
    mockGetModel.mockReturnValue(model);

    const app = Fastify({ logger: false });
    await app.register(agentPlugin);
    await app.ready();

    expect(mockGetModel).toHaveBeenCalledWith('test-provider', 'test-model');
    expect((app as unknown as AppWithAgent).agent.model).toBe(model);

    await app.close();
  });

  it('fails startup with a typed error when the configured model is unavailable', async () => {
    process.env.AGENT_PROVIDER = 'test-provider';
    process.env.AGENT_MODEL = 'test-model';
    mockGetModel.mockReturnValue(undefined);

    const app = Fastify({ logger: false });
    const error = await app.register(agentPlugin).then(
      () => undefined,
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ConfiguredModelUnavailableError);
    expect((error as Error).message).toBe(
      'Configured model test-provider/test-model is not available'
    );
  });
});
