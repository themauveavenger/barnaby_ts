import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/agent/prompt-builder.js', () => ({
  promptBuilder: {
    briefing: vi.fn().mockReturnValue('MOCK PROMPT'),
    chat: vi.fn().mockReturnValue('MOCK PROMPT'),
    afternoonUpdate: vi.fn().mockReturnValue('MOCK PROMPT')
  }
}));

vi.mock('../../../src/agent/session-factory.js', () => ({
  createSession: vi.fn()
}));

vi.mock('../../../src/agent/session-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/agent/session-runner.js')>();
  return {
    ...actual,
    runAgentSession: vi.fn()
  };
});

import type { Context } from 'grammy';
import { createSession } from '../../../src/agent/session-factory.js';
import { runAgentSession, EmptyResponseError, SessionTimeoutError } from '../../../src/agent/session-runner.js';
import { promptBuilder } from '../../../src/agent/prompt-builder.js';
import { handleChat } from '../../../src/services/telegram/chat.js';
import { getSession, clearSessionStore } from '../../../src/services/telegram/session-store.js';

function createMockSession(returnText = 'Iris likes maple donuts!') {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue(returnText),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockContext(text = 'what type of donut did Iris like?', chatId = 12345) {
  return {
    chat: { id: chatId },
    msg: { text },
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined)
  } as unknown as Context;
}

function createMockFastify(_memoryContext = '') {
  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {}
    },
    memoryRepository: {
      findByTags: vi.fn().mockReturnValue([]),
      findRecent: vi.fn().mockReturnValue([]),
      findResolvedRecent: vi.fn().mockReturnValue([])
    },
    memoryActionRepository: {},
    calendarIds: [] as string[],
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
  } as any;
}

describe('handleChat', () => {
  let fastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    fastify = createMockFastify();
    clearSessionStore();
    vi.clearAllMocks();
    vi.mocked(createSession).mockResolvedValue(createMockSession() as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates session with the full tool set for a new chat', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Iris likes maple donuts!', session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['calendar_list', 'get_weather_forecast', 'memory_list', 'memory_resolve', 'memory_create', 'drive_read_doc', 'drive_list_docs', 'wolfram_alpha', 'kagi_search', 'kagi_extract']
      })
    );
    expect(runAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'MOCK PROMPT'
      })
    );
  });

  it('sends typing indicator before processing', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
  });

  it('replies with agent text on success', async () => {
    const mockSession = createMockSession('Iris likes maple donuts!');
    (runAgentSession as any).mockResolvedValue({ text: 'Iris likes maple donuts!', session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('Iris likes maple donuts!');
  });

  it('replies with fallback message when agent returns empty response', async () => {
    (runAgentSession as any).mockRejectedValue(new EmptyResponseError());

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('I couldn\'t come up with a response. Try again?');
  });

  it('delegates prompt assembly to PromptBuilder.chat with the user message on a new session', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    const ctx = createMockContext('what type of donut did Iris like?');
    await handleChat(ctx, fastify);

    expect(promptBuilder.chat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(promptBuilder.chat).mock.calls[0][0]).toMatchObject({
      userMessage: 'what type of donut did Iris like?'
    });
  });

  it('passes the PromptBuilder output to SessionRunner on a new session', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(runAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'MOCK PROMPT'
      })
    );
  });

  it('passes memory context to PromptBuilder.chat when memories exist', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    fastify.memoryRepository.findByTags.mockReturnValue([
      { content: 'Shellfish allergy', tags: ['core', 'health'], permanent: true }
    ]);
    fastify.memoryRepository.findRecent.mockReturnValue([
      { content: 'Dentist appointment on Thursday', tags: ['appointment'], permanent: false }
    ]);

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    const memoryContext = vi.mocked(promptBuilder.chat).mock.calls[0][0].memoryContext;
    expect(memoryContext).toContain('Core memories about the user');
    expect(memoryContext).toContain('Shellfish allergy');
    expect(memoryContext).toContain('Recent notes and tasks');
    expect(memoryContext).toContain('Dentist appointment on Thursday');
  });

  it('passes an empty memory context to PromptBuilder when no memories exist', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    fastify.memoryRepository.findByTags.mockReturnValue([]);
    fastify.memoryRepository.findRecent.mockReturnValue([]);
    fastify.memoryRepository.findResolvedRecent.mockReturnValue([]);

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(vi.mocked(promptBuilder.chat).mock.calls[0][0].memoryContext).toBe('');
  });

  it('passes configured calendar IDs to PromptBuilder.chat', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    fastify.calendarIds = ['primary', 'family.calendar@gmail.com'];

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(vi.mocked(promptBuilder.chat).mock.calls[0][0]).toMatchObject({
      calendarIds: ['primary', 'family.calendar@gmail.com']
    });
  });

  it('passes an empty calendar ID list to PromptBuilder.chat when none configured', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    fastify.calendarIds = [];

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(vi.mocked(promptBuilder.chat).mock.calls[0][0]).toMatchObject({
      calendarIds: []
    });
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const ctx = createMockContext('hello', 99999);
    await handleChat(ctx, fastify);

    expect(runAgentSession).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.replyWithChatAction).not.toHaveBeenCalled();
  });

  it('ignores messages without text', async () => {
    const ctx = {
      chat: { id: 12345 },
      msg: {},
      reply: vi.fn().mockResolvedValue(undefined),
      react: vi.fn().mockResolvedValue(undefined),
      replyWithChatAction: vi.fn().mockResolvedValue(undefined)
    } as unknown as Context;

    await handleChat(ctx, fastify);

    expect(runAgentSession).not.toHaveBeenCalled();
  });

  it('replies with generic error when SessionRunner fails', async () => {
    (runAgentSession as any).mockRejectedValue(new Error('API down'));

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('replies with timeout message when SessionRunner times out', async () => {
    (runAgentSession as any).mockRejectedValue(new SessionTimeoutError());

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('That took too long — please try again.');
  });

  it('stores session in session store after first message', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    const chatId = 12345;
    const ctx = createMockContext('hello', chatId);
    await handleChat(ctx, fastify);

    const storedSession = getSession(chatId);
    expect(storedSession).toBe(mockSession);
  });

  it('reuses existing session for follow-up messages', async () => {
    const chatId = 12345;
    const mockSession = createMockSession('First response');
    (runAgentSession as any)
      .mockResolvedValueOnce({ text: 'First response', session: mockSession })
      .mockResolvedValueOnce({ text: 'Second response', session: mockSession });

    // First message - creates session
    const ctx1 = createMockContext('hello', chatId);
    await handleChat(ctx1, fastify);

    expect(runAgentSession).toHaveBeenCalledTimes(1);

    // Second message - reuses session
    const ctx2 = createMockContext('tell me more', chatId);
    await handleChat(ctx2, fastify);

    expect(runAgentSession).toHaveBeenCalledTimes(2);
    expect(runAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        _session: mockSession,
        prompt: 'tell me more'
      })
    );
    expect(ctx2.reply).toHaveBeenCalledWith('Second response');
  });

  it('activates the full tool set when reusing a cached session', async () => {
    const chatId = 12345;
    const mockSession = createMockSession('First response');
    (runAgentSession as any)
      .mockResolvedValueOnce({ text: 'First response', session: mockSession })
      .mockResolvedValueOnce({ text: 'Second response', session: mockSession });

    await handleChat(createMockContext('hello', chatId), fastify);
    await handleChat(createMockContext('tell me more', chatId), fastify);

    expect(mockSession.setActiveToolsByName).toHaveBeenCalledWith(
      ['calendar_list', 'get_weather_forecast', 'memory_list', 'memory_resolve', 'memory_create', 'drive_read_doc', 'drive_list_docs', 'wolfram_alpha', 'kagi_search', 'kagi_extract']
    );
  });

  it('sends only user message (not full context) for follow-up messages', async () => {
    const chatId = 12345;
    const mockSession = createMockSession('First response');
    (runAgentSession as any)
      .mockResolvedValueOnce({ text: 'First response', session: mockSession })
      .mockResolvedValueOnce({ text: 'Second response', session: mockSession });

    // First message - creates session; prompt is assembled by PromptBuilder.
    const ctx1 = createMockContext('hello', chatId);
    await handleChat(ctx1, fastify);

    expect(promptBuilder.chat).toHaveBeenCalledTimes(1);
    expect(runAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: 'MOCK PROMPT'
      })
    );

    // Second message - reuses session with raw user text (no PromptBuilder).
    const ctx2 = createMockContext('tell me more', chatId);
    await handleChat(ctx2, fastify);

    // PromptBuilder is NOT called again on follow-up.
    expect(promptBuilder.chat).toHaveBeenCalledTimes(1);
    expect(runAgentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: 'tell me more'
      })
    );
  });

  it('creates new session for different chat ID', async () => {
    const chatId1 = 12345;
    const chatId2 = 67890;
    vi.stubEnv('TELEGRAM_CHAT_ID', '12345,67890'); // Allow both chat IDs

    try {
      const mockSession1 = createMockSession('Response 1');
      const mockSession2 = createMockSession('Response 2');
      (runAgentSession as any)
        .mockResolvedValueOnce({ text: 'Response 1', session: mockSession1 })
        .mockResolvedValueOnce({ text: 'Response 2', session: mockSession2 });

      // First chat ID
      const ctx1 = createMockContext('hello from chat 1', chatId1);
      await handleChat(ctx1, fastify);

      // Second chat ID
      const ctx2 = createMockContext('hello from chat 2', chatId2);
      await handleChat(ctx2, fastify);

      expect(runAgentSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not call dispose on session after successful prompt', async () => {
    const mockSession = createMockSession();
    (runAgentSession as any).mockResolvedValue({ text: 'Hello', session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    // Session should NOT be disposed - it's managed by the session store
    expect(mockSession.dispose).not.toHaveBeenCalled();
  });

  it('creates a new session after the cached session has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const mockSession1 = createMockSession('First response');
      const mockSession2 = createMockSession('Second response');
      (runAgentSession as any)
        .mockResolvedValueOnce({ text: 'First response', session: mockSession1 })
        .mockResolvedValueOnce({ text: 'Second response', session: mockSession2 });

      // First message — creates and stores a session.
      await handleChat(createMockContext('hello', 12345), fastify);
      expect(runAgentSession).toHaveBeenCalledTimes(1);
      expect(mockSession1.dispose).not.toHaveBeenCalled();

      // Advance past the 15-minute TTL. The session store evicts the
      // first session and calls dispose on it.
      vi.advanceTimersByTime(15 * 60 * 1000 + 10);

      // Second message — the cached session is gone, so a new one is
      // created. The first session's dispose should have fired exactly
      // once from the eviction.
      await handleChat(createMockContext('hello again', 12345), fastify);
      expect(runAgentSession).toHaveBeenCalledTimes(2);
      expect(mockSession1.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reuse a session that has been evicted from the store', async () => {
    const mockSession1 = createMockSession('First response');
    const mockSession2 = createMockSession('Second response');
    (runAgentSession as any)
      .mockResolvedValueOnce({ text: 'First response', session: mockSession1 })
      .mockResolvedValueOnce({ text: 'Second response', session: mockSession2 });

    // First message — creates and stores a session.
    await handleChat(createMockContext('hello', 12345), fastify);
    expect(runAgentSession).toHaveBeenCalledTimes(1);
    expect(mockSession1.dispose).not.toHaveBeenCalled();

    // Simulate eviction: the session store drops the session and calls
    // its dispose callback (the LRU does this on max-size eviction, on
    // clear(), etc.).
    clearSessionStore();
    expect(mockSession1.dispose).toHaveBeenCalledTimes(1);

    // Second message — the cached session is gone, so a new one is
    // created instead of reusing the disposed one.
    await handleChat(createMockContext('hello again', 12345), fastify);
    expect(runAgentSession).toHaveBeenCalledTimes(2);
  });
});
