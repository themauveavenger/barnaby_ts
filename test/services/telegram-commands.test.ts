import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
}));

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import type { Bot, Context, RawApi } from 'grammy';
import registerTelegramCommands from '../../src/services/telegram-commands.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Created todo: "Call the dentist"'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockBot() {
  const handlers: Map<string, Function> = new Map();
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    config: { use: vi.fn() },
  } as unknown as RawApi;

  const bot = {
    command: vi.fn((name: string, handler: Function) => {
      handlers.set(name, handler);
    }),
    on: vi.fn(),
    api,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    use: vi.fn(),
    _handlers: handlers,
  } as unknown as Bot<Context>;

  return bot;
}

function createMockFastify(bot?: Bot<Context>) {
  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {},
    },
    telegramBot: bot ?? createMockBot(),
    telegramClient: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    memoryRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findAll: vi.fn(),
      findRecent: vi.fn(),
    },
    memoryActionRepository: {
      create: vi.fn(),
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    },
  } as unknown as FastifyInstance;
}

describe('telegram-commands', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('/remember command', () => {
    it('registers the /remember command handler', () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      registerTelegramCommands(fastify);

      expect(bot.command).toHaveBeenCalledWith('remember', expect.any(Function));
    });

    it('creates agent session and reacts with checkmark on success', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);
      await handler({
        chat: { id: 12345 },
        match: 'call the dentist on Friday',
        reply,
        react,
      });

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['memory_create', 'memory_list', 'memory_resolve'],
        }),
      );

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('call the dentist on Friday');
      expect(prompt).toContain('todo');
      expect(prompt).toContain('appointment');

      expect(react).toHaveBeenCalledWith('👍');
      expect(reply).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('ignores messages from unauthorized chat ID', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn();
      const react = vi.fn();

      await handler({
        chat: { id: 99999 },
        match: 'should be ignored',
        reply,
        react,
      });

      expect(reply).not.toHaveBeenCalled();
      expect(react).not.toHaveBeenCalled();
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it('sends usage hint when /remember is called without text', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: undefined,
        reply,
        react,
      });

      expect(react).toHaveBeenCalledWith('🤔');
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it('sends usage hint when /remember is called with whitespace only', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: '   ',
        reply,
        react,
      });

      expect(react).toHaveBeenCalledWith('🤔');
      expect(reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /remember'));
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it('reacts with 🤷 and sends specific message when session creation fails', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: 'something to remember',
        reply,
        react,
      });

      expect(react).toHaveBeenCalledWith('🤷');
      expect(reply).toHaveBeenCalledWith("Couldn't start a session — please try again.");
      expect(fastify.log.error).toHaveBeenCalled();
    });

    it('reacts with 🤷 and sends generic message when prompt fails', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      const mockSession = createMockSession();
      mockSession.prompt.mockRejectedValue(new Error('Timeout'));
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: 'something to remember',
        reply,
        react,
      });

      expect(react).toHaveBeenCalledWith('🤷');
      expect(reply).toHaveBeenCalledWith('Something went wrong — please try again.');
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disposes session even when prompt fails', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      const mockSession = createMockSession();
      mockSession.prompt.mockRejectedValue(new Error('fail'));
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: 'something to remember',
        reply,
        react,
      });

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('includes categorization guidelines in prompt', async () => {
      const bot = createMockBot();
      const fastify = createMockFastify(bot);
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      registerTelegramCommands(fastify);

      const handler = (bot as any)._handlers.get('remember') as Function;
      const reply = vi.fn().mockResolvedValue(undefined);
      const react = vi.fn().mockResolvedValue(undefined);

      await handler({
        chat: { id: 12345 },
        match: 'shellfish allergy',
        reply,
        react,
      });

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('"todo"');
      expect(prompt).toContain('"appointment"');
      expect(prompt).toContain('"note"');
      expect(prompt).toContain('permanent');
      expect(prompt).toContain('core');
    });
  });
});