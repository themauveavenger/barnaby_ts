import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
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
    it('returns wasTimeout=true when fn exceeds timeout', async () => {
      vi.useFakeTimers();

      let rejectPromise: ((reason?: unknown) => void) | undefined;
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockImplementation(() => {
          rejectPromise?.(new Error('Aborted'));
          return Promise.resolve();
        }),
        dispose: vi.fn()
      };

      const fn = async () => {
        return new Promise<string>((_, reject) => {
          rejectPromise = reject;
        });
      };

      const promise = withTimeout(mockSession as unknown as AgentSession, fn);

      vi.advanceTimersByTime(SESSION_TIMEOUT_MS + 10);

      const result = await promise;

      expect(result).toEqual({ result: undefined, wasTimeout: true });
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('resolves with result when fn succeeds', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn()
      };

      const result = await withTimeout(mockSession as unknown as AgentSession, async () => 'hello');

      expect(result).toEqual({ result: 'hello', wasTimeout: false });
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disposes session even when fn throws', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn()
      };

      await expect(
        withTimeout(mockSession as unknown as AgentSession, async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow('fail');

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('sets autoRetryEnabled to false', async () => {
      const mockSession = {
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn()
      };

      await withTimeout(mockSession as unknown as AgentSession, async () => 'ok');

      expect(mockSession.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    });
  });

  describe('SESSION_TIMEOUT_MS', () => {
    it('is 30 seconds', () => {
      expect(SESSION_TIMEOUT_MS).toBe(30_000);
    });
  });
});
