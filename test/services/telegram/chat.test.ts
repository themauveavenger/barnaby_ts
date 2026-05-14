import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({}))
  }
}));

vi.mock('../../../src/services/telegram/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/telegram/shared.js')>();
  return {
    ...actual,
    withTimeout: vi.fn(actual.withTimeout)
  };
});

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import type { Context } from 'grammy';
import { withTimeout } from '../../../src/services/telegram/shared.js';
import { handleChat } from '../../../src/services/telegram/chat.js';

function createMockSession(returnText = 'Iris likes maple donuts!') {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue(returnText),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates session with memory_list and memory_resolve tools', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: ['memory_list', 'memory_resolve']
      })
    );
  });

  it('sends typing indicator before processing', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.replyWithChatAction).toHaveBeenCalledWith('typing');
  });

  it('replies with agent text on success', async () => {
    const mockSession = createMockSession('Iris likes maple donuts!');
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('Iris likes maple donuts!');
  });

  it('replies with fallback message when agent returns empty response', async () => {
    const mockSession = createMockSession('');
    mockSession.getLastAssistantText.mockReturnValue(null);
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('I couldn\'t come up with a response. Try again?');
  });

  it('includes user message in prompt', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext('what type of donut did Iris like?');
    await handleChat(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('what type of donut did Iris like?');
  });

  it('includes "you cannot create new memories" instruction in prompt', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('you cannot create new ones');
  });

  it('includes memory context when memories exist', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    fastify.memoryRepository.findByTags.mockReturnValue([
      { content: 'Shellfish allergy', tags: ['core', 'health'], permanent: true }
    ]);
    fastify.memoryRepository.findRecent.mockReturnValue([
      { content: 'Dentist appointment on Thursday', tags: ['appointment'], permanent: false }
    ]);

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('Core memories about the user');
    expect(prompt).toContain('Shellfish allergy');
    expect(prompt).toContain('Recent notes and tasks');
    expect(prompt).toContain('Dentist appointment on Thursday');
  });

  it('omits empty memory sections from prompt', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    fastify.memoryRepository.findByTags.mockReturnValue([]);
    fastify.memoryRepository.findRecent.mockReturnValue([]);
    fastify.memoryRepository.findResolvedRecent.mockReturnValue([]);

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).not.toContain('Core memories about the user');
    expect(prompt).not.toContain('Recent notes and tasks');
  });

  it('disposes session on success', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('disposes session on error', async () => {
    const mockSession = createMockSession();
    mockSession.prompt.mockRejectedValue(new Error('fail'));
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const ctx = createMockContext('hello', 99999);
    await handleChat(ctx, fastify);

    expect(createAgentSession).not.toHaveBeenCalled();
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

    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('replies with error message when session creation fails', async () => {
    (createAgentSession as any).mockRejectedValue(new Error('API down'));

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('Couldn\'t start a session — please try again.');
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('replies with generic error when prompt fails after session creation', async () => {
    const mockSession = createMockSession();
    mockSession.prompt.mockRejectedValue(new Error('LLM error'));
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('replies with timeout message when session times out', async () => {
    (withTimeout as any).mockResolvedValueOnce({ result: undefined, wasTimeout: true });

    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext();
    await handleChat(ctx, fastify);

    expect(ctx.reply).toHaveBeenCalledWith('That took too long — please try again.');
  });
});
