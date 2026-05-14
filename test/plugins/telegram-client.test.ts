import Fastify from 'fastify';
import telegramClientPlugin from '../../src/plugins/telegram-client.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface MockBotInternals {
  _commands?: Map<string, (...args: unknown[]) => unknown>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  command: ReturnType<typeof vi.fn>;
  use: ReturnType<typeof vi.fn>;
}

interface AugmentedGlobal {
  __GRAMMY_BOT_INSTANCE__?: MockBotInternals & { api: { sendMessage: ReturnType<typeof vi.fn> } };
}

// Mock grammy Bot and autoRetry
vi.mock('grammy', () => {
  class MockBot {
    token: string;
    api: { sendMessage: ReturnType<typeof vi.fn>; config: { use: ReturnType<typeof vi.fn> } };
    constructor(token: string) {
      this.token = token;
      this.api = { sendMessage: vi.fn(), config: { use: vi.fn() } }
      ;(this as unknown as MockBotInternals).start = vi.fn().mockResolvedValue(undefined)
      ;(this as unknown as MockBotInternals).stop = vi.fn().mockResolvedValue(undefined)
      ;(this as unknown as MockBotInternals).command = vi.fn((name: string, handler: (...args: unknown[]) => unknown) => {
        const commands = (this as unknown as MockBotInternals)._commands || new Map<string, (...args: unknown[]) => unknown>()
        ;(this as unknown as MockBotInternals)._commands = commands;
        commands.set(name, handler);
      })
      ;(this as unknown as MockBotInternals).use = vi.fn(() => {
        void 0;
      });
      ;(globalThis as unknown as AugmentedGlobal).__GRAMMY_BOT_INSTANCE__ = this as unknown as MockBotInternals & { api: { sendMessage: ReturnType<typeof vi.fn> } };
    }
  }
  return {
    Bot: MockBot
  };
});

vi.mock('@grammyjs/auto-retry', () => {
  return {
    autoRetry: vi.fn(() => (fn: (...args: unknown[]) => unknown) => fn)
  };
});

interface AppWithTelegram {
  telegramClient: { sendMessage: (chatId: number, text: string) => Promise<void> };
  telegramBot: { command: (...args: unknown[]) => unknown };
}

describe('telegram-client plugin (TL;DR: TDD-driven)', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
  });

  it('throws if TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const app = Fastify();
    app.register(telegramClientPlugin as unknown as Parameters<typeof app.register>[0]);
    await expect(app.ready()).rejects.toThrowError('TELEGRAM_BOT_TOKEN');
  });

  it('decorates fastify with telegramClient and telegramBot, and starts bot on ready', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as unknown as Parameters<typeof app.register>[0]);
    await app.ready();

    const telegramClient = (app as unknown as AppWithTelegram).telegramClient;
    expect(telegramClient).toBeDefined();
    expect(typeof telegramClient.sendMessage).toBe('function');

    const telegramBot = (app as unknown as AppWithTelegram).telegramBot;
    expect(telegramBot).toBeDefined();
    expect(typeof telegramBot.command).toBe('function');

    const botInstance = (globalThis as unknown as AugmentedGlobal).__GRAMMY_BOT_INSTANCE__;
    expect(botInstance).toBeDefined();
    expect(botInstance!.start.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('registers /start handler logs chat and replies', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as unknown as Parameters<typeof app.register>[0]);
    await app.ready();

    const botInstance = (globalThis as unknown as AugmentedGlobal).__GRAMMY_BOT_INSTANCE__;
    const startHandler = botInstance!._commands?.get('start');
    expect(typeof startHandler).toBe('function');

    const logSpy = vi.spyOn(app.log, 'info');
    const ctx = {
      chat: { id: 123 },
      reply: vi.fn()
    };

    await startHandler!(ctx);

    expect(logSpy).toHaveBeenCalledWith('Telegram /start from chat 123');
    expect(ctx.reply).toHaveBeenCalledWith('Hello! I\'m Barnaby. Your chat ID is 123. Set TELEGRAM_CHAT_ID=123 in your .env to receive daily briefings.');
  });

  it('stops bot on close', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as unknown as Parameters<typeof app.register>[0]);
    await app.ready();

    const botInstance = (globalThis as unknown as AugmentedGlobal).__GRAMMY_BOT_INSTANCE__;
    await app.close();
    expect(botInstance!.stop.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('truncates messages longer than 4096 chars', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as unknown as Parameters<typeof app.register>[0]);
    await app.ready();

    const client = (app as unknown as AppWithTelegram).telegramClient;
    const botInstance = (globalThis as unknown as AugmentedGlobal).__GRAMMY_BOT_INSTANCE__;

    const longText = 'a'.repeat(5000);
    await client.sendMessage(42, longText);

    const sent = botInstance!.api.sendMessage.mock.calls[0] as [number, string];
    expect(sent[0]).toBe(42);
    const payload = sent[1];
    expect(payload.length).toBe(4096);
    expect(payload.endsWith('...')).toBe(true);
  });
});
