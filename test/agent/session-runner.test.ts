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
import {
  runAgentSession,
  EmptyResponseError,
  SessionTimeoutError,
  ALL_TOOLS,
  MEMORY_TOOLS
} from '../../src/agent/session-runner.js';

function createMockSession(text: string | null | undefined = 'Hello!') {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue(text),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function createPendingMockSession() {
  let rejectPrompt: ((reason?: unknown) => void) | undefined;
  let isAborted = false;

  const session = {
    prompt: vi.fn().mockImplementation(() => {
      if (isAborted) {
        return Promise.reject(new Error('Aborted'));
      }
      return new Promise<undefined>((_, reject) => {
        rejectPrompt = reject;
      });
    }),
    getLastAssistantText: vi.fn().mockReturnValue('Hello!'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    abort: vi.fn().mockImplementation(() => {
      isAborted = true;
      rejectPrompt?.(new Error('Aborted'));
      return Promise.resolve();
    })
  };

  return session;
}

const agent = {
  modelRuntime: {} as unknown as ModelRuntime,
  model: {} as unknown as Model<Api>,
  resourceLoader: {} as unknown as ResourceLoader
};

describe('runAgentSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates an agent session with the supplied tools', async () => {
    const session = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    await runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        model: agent.model,
        modelRuntime: agent.modelRuntime,
        resourceLoader: agent.resourceLoader,
        sessionManager: expect.anything(),
        tools: MEMORY_TOOLS
      })
    );
    expect(SessionManager.inMemory).toHaveBeenCalled();
  });

  it('activates activeTools when provided', async () => {
    const session = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    await runAgentSession({
      ...agent,
      tools: ALL_TOOLS,
      activeTools: ['calendar_list'],
      prompt: 'test'
    });

    expect(session.setActiveToolsByName).toHaveBeenCalledWith(['calendar_list']);
  });

  it('falls back to tools as active tools when activeTools is omitted', async () => {
    const session = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    await runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' });

    expect(session.setActiveToolsByName).toHaveBeenCalledWith(MEMORY_TOOLS);
  });

  it('disables auto-retry before prompting', async () => {
    const session = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    await runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' });

    expect(session.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    expect(session.setAutoRetryEnabled).toHaveBeenCalledBefore(session.prompt);
  });

  it('prompts with the supplied text and returns text plus session', async () => {
    const session = createMockSession('Agent response');
    (createAgentSession as any).mockResolvedValue({ session });

    const result = await runAgentSession({
      ...agent,
      tools: MEMORY_TOOLS,
      prompt: 'User prompt'
    });

    expect(session.prompt).toHaveBeenCalledWith('User prompt');
    expect(result).toEqual({ text: 'Agent response', session });
  });

  it('trims whitespace from the assistant response', async () => {
    const session = createMockSession('  trimmed  ');
    (createAgentSession as any).mockResolvedValue({ session });

    const result = await runAgentSession({
      ...agent,
      tools: MEMORY_TOOLS,
      prompt: 'test'
    });

    expect(result.text).toBe('trimmed');
  });

  it('throws EmptyResponseError when assistant returns no text', async () => {
    const session = createMockSession(null);
    (createAgentSession as any).mockResolvedValue({ session });

    await expect(
      runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' })
    ).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it('throws EmptyResponseError when assistant returns whitespace-only text', async () => {
    const session = createMockSession('   ');
    (createAgentSession as any).mockResolvedValue({ session });

    await expect(
      runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' })
    ).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it('uses the default 45 second timeout', async () => {
    const session = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    await runAgentSession({ ...agent, tools: MEMORY_TOOLS, prompt: 'test' });

    expect(session.prompt).toHaveBeenCalledWith('test');
  });

  it('aborts the session and throws SessionTimeoutError when the timeout fires', async () => {
    const session = createPendingMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    const promise = runAgentSession({
      ...agent,
      tools: MEMORY_TOOLS,
      prompt: 'test',
      _timeoutMs: 10
    });

    await expect(promise).rejects.toBeInstanceOf(SessionTimeoutError);
    expect(session.abort).toHaveBeenCalled();
  });

  it('aborts the session when the external signal fires', async () => {
    const session = createPendingMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    const controller = new AbortController();
    const promise = runAgentSession({
      ...agent,
      tools: MEMORY_TOOLS,
      prompt: 'test',
      signal: controller.signal,
      _timeoutMs: 500
    });

    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow('Aborted');
    expect(session.abort).toHaveBeenCalled();
  });

  it('honours an already-aborted external signal', async () => {
    const session = createPendingMockSession();
    (createAgentSession as any).mockResolvedValue({ session });

    const controller = new AbortController();
    controller.abort();

    await expect(
      runAgentSession({
        ...agent,
        tools: MEMORY_TOOLS,
        prompt: 'test',
        signal: controller.signal,
        _timeoutMs: 10
      })
    ).rejects.toThrow('Session aborted');
  });
});
