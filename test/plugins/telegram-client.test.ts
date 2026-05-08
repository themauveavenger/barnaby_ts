import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import telegramClientPlugin from '../../src/plugins/telegram-client.js';

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock grammy Bot and autoRetry
vi.mock('grammy', () => {
  let instance: any = null;
  class MockBot {
    token: string;
    api: { sendMessage: any };
    constructor(token: string) {
    this.token = token;
    this.api = { sendMessage: vi.fn(), config: { use: vi.fn() } } as any;
      (this as any).start = vi.fn().mockResolvedValue(undefined);
      (this as any).stop = vi.fn().mockResolvedValue(undefined);
      (this as any).command = vi.fn((name: string, handler: Function) => {
        (this as any)._commands = (this as any)._commands || new Map<string, Function>();
        (this as any)._commands.set(name, handler);
      });
      (this as any).use = vi.fn(() => {});
      instance = this;
      (globalThis as any).__GRAMMY_BOT_INSTANCE__ = this;
    }
  }
  // Expose a simple getter for the latest instance for tests
  return {
    Bot: MockBot,
  };
});

vi.mock('@grammyjs/auto-retry', () => {
  return {
    autoRetry: vi.fn(() => (fn: any) => fn),
  };
});

describe('telegram-client plugin (TL;DR: TDD-driven)', () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
  });

  it('throws if TELEGRAM_BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const app = Fastify();
    app.register(telegramClientPlugin as any);
    await expect(app.ready()).rejects.toThrowError('TELEGRAM_BOT_TOKEN');
  });

  it('decorates fastify with telegramClient and telegramBot, and starts bot on ready', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as any);
    await app.ready();

    const telegramClient = (app as any).telegramClient;
    expect(telegramClient).toBeDefined();
    expect(typeof telegramClient.sendMessage).toBe('function');

    const telegramBot = (app as any).telegramBot;
    expect(telegramBot).toBeDefined();
    expect(typeof telegramBot.command).toBe('function');

    const botInstance = (globalThis as any).__GRAMMY_BOT_INSTANCE__;
    expect(botInstance).toBeDefined();
    expect((botInstance.start as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('registers /start handler logs chat and replies', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as any);
    await app.ready();

    const botInstance = (globalThis as any).__GRAMMY_BOT_INSTANCE__;
    const startHandler = (botInstance as any)._commands?.get('start');
    expect(typeof startHandler).toBe('function');

    const logSpy = vi.spyOn(app.log, 'info');
    const ctx: any = {
      chat: { id: 123 },
      reply: vi.fn(),
    };

    await startHandler(ctx);

    expect(logSpy).toHaveBeenCalledWith('Telegram /start from chat 123');
    expect(ctx.reply).toHaveBeenCalledWith("Hello! I'm Barnaby. Your chat ID is 123. Set TELEGRAM_CHAT_ID=123 in your .env to receive daily briefings.");
  });

  it('stops bot on close', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as any);
    await app.ready();

    const botInstance = (globalThis as any).__GRAMMY_BOT_INSTANCE__;
    await app.close();
    expect((botInstance.stop as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('truncates messages longer than 4096 chars', async () => {
    const app = Fastify();
    app.register(telegramClientPlugin as any);
    await app.ready();

    const client = (app as any).telegramClient as any;
    const botInstance = (globalThis as any).__GRAMMY_BOT_INSTANCE__;

    const longText = 'a'.repeat(5000);
    await client.sendMessage(42, longText);

    const sent = (botInstance.api.sendMessage as any).mock.calls[0];
    expect(sent[0]).toBe(42);
    const payload = sent[1];
    expect(payload.length).toBe(4096);
    expect(payload.endsWith('...')).toBe(true);
  });
});
