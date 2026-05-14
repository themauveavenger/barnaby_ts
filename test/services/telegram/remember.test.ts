import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
}));

vi.mock('../../../src/services/telegram/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/telegram/shared.js')>();
  return {
    ...actual,
    withTimeout: vi.fn(actual.withTimeout),
  };
});

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import type { Context } from 'grammy';
import { SESSION_TIMEOUT_MS, withTimeout } from '../../../src/services/telegram/shared.js';
import { handleRemember } from '../../../src/services/telegram/remember.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Created todo: "Call the dentist"'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}



function createMockContext(overrides: Partial<{ chatId: number; match: string | undefined }> = {}) {
  return {
    chat: { id: overrides.chatId ?? 12345 },
    match: overrides.match,
    msg: { text: overrides.match ?? '' },
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createMockFastify() {
  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {},
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    },
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

  it('creates agent session and reacts with checkmark on success', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'call the dentist on Friday' });
    await handleRemember(ctx, fastify);

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['memory_create', 'memory_list', 'memory_resolve'],
      }),
    );

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('call the dentist on Friday');
    expect(prompt).toContain('todo');
    expect(prompt).toContain('appointment');

    expect(ctx.react).toHaveBeenCalledWith('👍');
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const ctx = createMockContext({ chatId: 99999, match: 'should be ignored' });
    await handleRemember(ctx, fastify);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.react).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /remember is called without text', async () => {
    const ctx = createMockContext({ match: undefined });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /remember is called with whitespace only', async () => {
    const ctx = createMockContext({ match: '   ' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('reacts with shrug and sends specific message when session creation fails', async () => {
    (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith("Couldn't start a session — please try again.");
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('reacts with shrug and sends generic message when prompt fails', async () => {
    const mockSession = createMockSession();
    mockSession.prompt.mockRejectedValue(new Error('Timeout'));
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('disposes session even when prompt fails', async () => {
    const mockSession = createMockSession();
    mockSession.prompt.mockRejectedValue(new Error('fail'));
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('includes categorization guidelines in prompt', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'shellfish allergy' });
    await handleRemember(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('"todo"');
    expect(prompt).toContain('"appointment"');
    expect(prompt).toContain('"note"');
    expect(prompt).toContain('permanent');
    expect(prompt).toContain('core');
  });

  it('reacts with shrug and sends timeout message when session times out', async () => {
    (withTimeout as any).mockResolvedValueOnce({ result: undefined, wasTimeout: true });

    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'something to remember' });
    await handleRemember(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('That took too long — please try again.');
  });
});