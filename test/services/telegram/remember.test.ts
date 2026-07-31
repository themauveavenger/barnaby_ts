import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/agent/session-factory.js', () => ({
  createSession: vi.fn()
}));

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
import { createSession } from '../../../src/agent/session-factory.js';
import { runAgentSession, SessionTimeoutError } from '../../../src/agent/session-runner.js';
import { handleRemember } from '../../../src/services/telegram/remember.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Created todo: "Call the dentist"'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function mockRunAgentSession(session: ReturnType<typeof createMockSession>, text = 'Created todo: "Call the dentist"'): void {
  vi.mocked(createSession).mockResolvedValue(session as never);
  vi.mocked(runAgentSession).mockResolvedValue({ text, session: session as never });
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
    vi.mocked(createSession).mockResolvedValue(createMockSession() as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls SessionRunner with memory tools and reacts with checkmark on success', async () => {
    const mockSession = createMockSession();
    mockRunAgentSession(mockSession);

    const ctx = createMockContext({ match: 'call the dentist on Friday' });
    await handleRemember(ctx, fastify);

    expect(runAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        _session: mockSession
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

  it('logs but stays silent when the confirmation reaction fails after a successful run', async () => {
    const mockSession = createMockSession();
    mockRunAgentSession(mockSession);

    const ctx = createMockContext({ match: 'call the dentist on Friday' });
    vi.mocked(ctx.react).mockRejectedValue(new Error('API unreachable'));
    await handleRemember(ctx, fastify);

    // The memory was saved; only the confirmation failed, so no failure reply.
    expect(ctx.react).toHaveBeenCalledTimes(1);
    expect(ctx.react).toHaveBeenCalledWith('👍');
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mockSession.dispose).toHaveBeenCalled();
    expect(fastify.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to confirm /remember success'
    );
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
    mockRunAgentSession(mockSession, '');

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('includes categorization guidelines in prompt', async () => {
    const mockSession = createMockSession();
    mockRunAgentSession(mockSession, 'Created note');

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
