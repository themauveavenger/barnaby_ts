import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/agent/session-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/agent/session-runner.js')>();
  return {
    ...actual,
    runAgentSession: vi.fn(),
    SessionTimeoutError: class SessionTimeoutError extends Error {
      constructor() {
        super('Session timed out');
        this.name = 'SessionTimeoutError';
      }
    }
  };
});

import type { Context } from 'grammy';
import { runAgentSession, SessionTimeoutError } from '../../../src/agent/session-runner.js';
import { handleRemember } from '../../../src/services/telegram/remember.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Created todo: "Call the dentist"'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockContext(overrides: Partial<{ chatId: number; match: string | undefined }> = {}) {
  return {
    chat: { id: overrides.chatId ?? 12345 },
    match: overrides.match,
    msg: { text: overrides.match ?? '' },
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined)
  } as unknown as Context;
}

function createMockFastify() {
  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {}
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
  } as any;
}

describe('handleRemember', () => {
  let fastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    fastify = createMockFastify();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls SessionRunner with memory tools and reacts with checkmark on success', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Created todo: "Call the dentist"', session: mockSession });

    const ctx = createMockContext({ match: 'call the dentist on Friday' });
    await handleRemember(ctx, fastify);

    expect(runAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['memory_create', 'memory_list', 'memory_resolve'],
        model: fastify.agent.model,
        modelRuntime: fastify.agent.modelRuntime,
        resourceLoader: fastify.agent.resourceLoader
      })
    );

    const prompt = (runAgentSession as any).mock.calls[0][0].prompt;
    expect(prompt).toContain('call the dentist on Friday');
    expect(prompt).toContain('todo');
    expect(prompt).toContain('note');

    expect(ctx.react).toHaveBeenCalledWith('👍');
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const ctx = createMockContext({ chatId: 99999, match: 'should be ignored' });
    await handleRemember(ctx, fastify);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.react).not.toHaveBeenCalled();
    expect(runAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /remember is called without text', async () => {
    const ctx = createMockContext({ match: undefined });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
    expect(runAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /remember is called with whitespace only', async () => {
    const ctx = createMockContext({ match: '   ' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
    expect(runAgentSession).not.toHaveBeenCalled();
  });

  it('reacts with shrug and sends generic error message when SessionRunner fails', async () => {
    (runAgentSession as any).mockRejectedValue(new Error('LLM API down'));

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('disposes session even when SessionRunner fails after session creation', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: '', session: mockSession });

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('includes categorization guidelines in prompt', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Created note', session: mockSession });

    const ctx = createMockContext({ match: 'shellfish allergy' });
    await handleRemember(ctx, fastify);

    const prompt = (runAgentSession as any).mock.calls[0][0].prompt;
    expect(prompt).toContain('"todo"');
    expect(prompt).toContain('"note"');
    expect(prompt).toContain('permanent');
    expect(prompt).toContain('core');
  });

  it('reacts with shrug and sends timeout message when SessionRunner times out', async () => {
    (runAgentSession as any).mockRejectedValue(new SessionTimeoutError());

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('That took too long — please try again.');
  });
});
