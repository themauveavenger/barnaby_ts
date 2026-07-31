import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { SessionTimeoutError } from '../../../src/agent/session-runner.js';
import { defaultErrorMessage, isAllowedChat, reportTelegramError } from '../../../src/services/telegram/shared.js';

function createMockContext() {
  return {
    chat: { id: 12345 },
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined)
  } as unknown as Context;
}

function createMockFastify() {
  return {
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
  } as unknown as FastifyInstance;
}

describe('telegram/shared', () => {
  describe('isAllowedChat', () => {
    beforeEach(() => {
      process.env.TELEGRAM_CHAT_ID = '12345';
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('returns true for matching chat ID', () => {
      expect(isAllowedChat(12345)).toBe(true);
    });

    it('returns false for non-matching chat ID', () => {
      expect(isAllowedChat(99999)).toBe(false);
    });

    it('returns false when TELEGRAM_CHAT_ID is not set', () => {
      delete process.env.TELEGRAM_CHAT_ID;
      expect(isAllowedChat(12345)).toBe(false);
    });
  });

  describe('defaultErrorMessage', () => {
    it('maps session timeouts to the timeout message', () => {
      expect(defaultErrorMessage(new SessionTimeoutError())).toBe('That took too long — please try again.');
    });

    it('maps other errors to the generic message', () => {
      expect(defaultErrorMessage(new Error('LLM API down'))).toBe('Something went wrong — please try again.');
    });
  });

  describe('reportTelegramError', () => {
    let fastify: ReturnType<typeof createMockFastify>;

    beforeEach(() => {
      fastify = createMockFastify();
    });

    it('reacts with shrug and replies with the given text', async () => {
      const ctx = createMockContext();

      await reportTelegramError(ctx, fastify, { chatId: 12345, replyText: 'boom' });

      expect(ctx.react).toHaveBeenCalledWith('🤷');
      expect(ctx.reply).toHaveBeenCalledWith('boom');
      expect(fastify.log.error).not.toHaveBeenCalled();
    });

    it('logs and swallows when the reaction fails', async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.react).mockRejectedValue(new Error('API unreachable'));

      await expect(reportTelegramError(ctx, fastify, { chatId: 12345, replyText: 'boom' })).resolves.toBeUndefined();

      expect(ctx.reply).not.toHaveBeenCalled();
      expect(fastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), chatId: 12345 }),
        'Failed to report error to Telegram'
      );
    });

    it('logs and swallows when the reply fails', async () => {
      const ctx = createMockContext();
      vi.mocked(ctx.reply).mockRejectedValue(new Error('API unreachable'));

      await expect(reportTelegramError(ctx, fastify, { chatId: 12345, replyText: 'boom' })).resolves.toBeUndefined();

      expect(fastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), chatId: 12345 }),
        'Failed to report error to Telegram'
      );
    });
  });
});
