import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isAllowedChat } from '../../../src/services/telegram/shared.js';

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
});
