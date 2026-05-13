import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAllowedChat, withTimeout, SESSION_TIMEOUT_MS } from '../../../src/services/telegram/shared.js';

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

  describe('withTimeout', () => {
    it('resolves with result when fn succeeds', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };

      const result = await withTimeout(mockSession as any, async () => 'hello');

      expect(result).toEqual({ result: 'hello', wasTimeout: false });
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disposes session even when fn throws', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };

      await expect(
        withTimeout(mockSession as any, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('sets autoRetryEnabled to false', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      };

      await withTimeout(mockSession as any, async () => 'ok');

      expect(mockSession.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('SESSION_TIMEOUT_MS', () => {
    it('is 30 seconds', () => {
      expect(SESSION_TIMEOUT_MS).toBe(30_000);
    });
  });
});