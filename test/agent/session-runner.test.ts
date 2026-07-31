import { describe, it, expect, vi, afterEach } from 'vitest';

import type { AgentSession } from '@earendil-works/pi-coding-agent';
import {
  runAgentSession,
  EmptyResponseError,
  SessionTimeoutError
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

describe('runAgentSession', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prompts the supplied session and returns its response', async () => {
    const session = createMockSession('Agent response');

    const result = await runAgentSession({
      _session: session as unknown as AgentSession,
      prompt: 'User prompt'
    });

    expect(session.prompt).toHaveBeenCalledWith('User prompt');
    expect(result).toEqual({ text: 'Agent response', session });
  });

  it('trims whitespace from the assistant response', async () => {
    const session = createMockSession('  trimmed  ');

    const result = await runAgentSession({
      _session: session as unknown as AgentSession,
      prompt: 'test'
    });

    expect(result.text).toBe('trimmed');
  });

  it('disables auto-retry before prompting', async () => {
    const session = createMockSession();

    await runAgentSession({
      _session: session as unknown as AgentSession,
      prompt: 'test'
    });

    expect(session.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    expect(session.setAutoRetryEnabled).toHaveBeenCalledBefore(session.prompt);
  });

  it('throws EmptyResponseError when assistant returns no text', async () => {
    const session = createMockSession(null);

    await expect(
      runAgentSession({
        _session: session as unknown as AgentSession,
        prompt: 'test'
      })
    ).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it('throws EmptyResponseError when assistant returns whitespace-only text', async () => {
    const session = createMockSession('   ');

    await expect(
      runAgentSession({
        _session: session as unknown as AgentSession,
        prompt: 'test'
      })
    ).rejects.toBeInstanceOf(EmptyResponseError);
  });

  it('propagates prompt failures without disposing the session', async () => {
    const session = createMockSession();
    session.prompt.mockRejectedValue(new Error('LLM API down'));

    await expect(
      runAgentSession({
        _session: session as unknown as AgentSession,
        prompt: 'test'
      })
    ).rejects.toThrow('LLM API down');

    expect(session.dispose).not.toHaveBeenCalled();
  });

  it('aborts the session and throws SessionTimeoutError when the timeout fires', async () => {
    const session = createPendingMockSession();

    const promise = runAgentSession({
      _session: session as unknown as AgentSession,
      prompt: 'test',
      _timeoutMs: 10
    });

    await expect(promise).rejects.toBeInstanceOf(SessionTimeoutError);
    expect(session.abort).toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
  });

  it('aborts the session when the external signal fires', async () => {
    const session = createPendingMockSession();
    const controller = new AbortController();

    const promise = runAgentSession({
      _session: session as unknown as AgentSession,
      prompt: 'test',
      signal: controller.signal,
      _timeoutMs: 500
    });

    setTimeout(() => controller.abort(), 5);

    await expect(promise).rejects.toThrow('Aborted');
    expect(session.abort).toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
  });

  it('honours an already-aborted external signal', async () => {
    const session = createPendingMockSession();
    const controller = new AbortController();
    controller.abort();

    await expect(
      runAgentSession({
        _session: session as unknown as AgentSession,
        prompt: 'test',
        signal: controller.signal,
        _timeoutMs: 10
      })
    ).rejects.toThrow('Session aborted');

    expect(session.prompt).not.toHaveBeenCalled();
    expect(session.dispose).not.toHaveBeenCalled();
  });
});
