import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSession, setSession, clearSessionStore } from '../../../src/services/telegram/session-store.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('test response'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

describe('session-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionStore();
  });

  it('stores and retrieves a session by chat ID', () => {
    const chatId = 12345;
    const session = createMockSession();

    setSession(chatId, session as any);
    const retrieved = getSession(chatId);

    expect(retrieved).toBe(session);
  });

  it('returns undefined for unknown chat ID', () => {
    const retrieved = getSession(99999);
    expect(retrieved).toBeUndefined();
  });

  it('overwrites existing session for same chat ID', () => {
    const chatId = 12345;
    const session1 = createMockSession();
    const session2 = createMockSession();

    setSession(chatId, session1 as any);
    setSession(chatId, session2 as any);

    const retrieved = getSession(chatId);
    expect(retrieved).toBe(session2);
  });

  it('clears all sessions', () => {
    const chatId1 = 12345;
    const chatId2 = 67890;
    const session1 = createMockSession();
    const session2 = createMockSession();

    setSession(chatId1, session1 as any);
    setSession(chatId2, session2 as any);

    clearSessionStore();

    expect(getSession(chatId1)).toBeUndefined();
    expect(getSession(chatId2)).toBeUndefined();
  });

  it('calls dispose callback when clearing store', () => {
    const chatId = 12345;
    const session = createMockSession();

    setSession(chatId, session as any);
    clearSessionStore();

    expect(session.dispose).toHaveBeenCalled();
  });

  it('calls dispose exactly once when a session is evicted due to max size', () => {
    // The cache has max=10, so adding 11 sessions should evict the first one
    const sessions = [];
    for (let i = 0; i < 11; i++) {
      const session = createMockSession();
      sessions.push(session);
      setSession(i, session as any);
    }

    // The first session should have been evicted and disposed exactly once
    expect(sessions[0].dispose).toHaveBeenCalledTimes(1);
    expect(getSession(0)).toBeUndefined();
    // Other sessions should not have been disposed
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i].dispose).not.toHaveBeenCalled();
    }
  });

  it('expires a session after the 15-minute TTL', () => {
    vi.useFakeTimers();
    // Anchor the clock before the LRU sees it — the LRU captured real
    // Date.now() at module load, so a mocked clock that starts at 0 would
    // produce a negative age and never expire.
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const chatId = 12345;
      const session = createMockSession();
      setSession(chatId, session as any);

      // Advance past the 15-minute TTL without accessing the session.
      // The LRU is configured with `updateAgeOnGet: true`, so any `get`
      // would reset the TTL (sliding window). We don't access here, so
      // the session is allowed to expire.
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);
      expect(getSession(chatId)).toBeUndefined();
      expect(session.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sliding window: a get resets the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    try {
      const chatId = 12345;
      const session = createMockSession();
      setSession(chatId, session as any);

      // 10 minutes in, a get resets the TTL. The original expiry was
      // t=15min; after the get, expiry is t=25min.
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(getSession(chatId)).toBe(session);
      expect(session.dispose).not.toHaveBeenCalled();

      // Past the original 15-minute TTL — without the sliding window the
      // session would be expired by now. With the sliding window, it's
      // still alive for another 5 minutes.
      vi.advanceTimersByTime(15 * 60 * 1000 + 10);
      expect(getSession(chatId)).toBeUndefined();
      expect(session.dispose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
