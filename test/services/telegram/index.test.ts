import { describe, it, expect, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import registerHandlers from '../../../src/services/telegram/index.js';

function createMockBot() {
  return {
    command: vi.fn(),
    on: vi.fn()
  };
}

function createMockFastify(bot: ReturnType<typeof createMockBot>) {
  return {
    telegramBot: bot
  } as unknown as FastifyInstance;
}

describe('registerHandlers', () => {
  it('registers /remember command handler', () => {
    const bot = createMockBot();
    const fastify = createMockFastify(bot);

    registerHandlers(fastify);

    expect(bot.command).toHaveBeenCalledWith('remember', expect.any(Function));
  });

  it('registers /kill_sessions command handler', () => {
    const bot = createMockBot();
    const fastify = createMockFastify(bot);

    registerHandlers(fastify);

    expect(bot.command).toHaveBeenCalledWith('kill_sessions', expect.any(Function));
  });

  it('registers message:text handler', () => {
    const bot = createMockBot();
    const fastify = createMockFastify(bot);

    registerHandlers(fastify);

    expect(bot.on).toHaveBeenCalledWith('message:text', expect.any(Function));
  });
});
