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

  it('calls dispose callback when session is evicted due to max size', () => {
    // The cache has max=10, so adding 11 sessions should evict the first one
    const sessions = [];
    for (let i = 0; i < 11; i++) {
      const session = createMockSession();
      sessions.push(session);
      setSession(i, session as any);
    }

    // The first session should have been evicted and disposed
    expect(sessions[0].dispose).toHaveBeenCalled();
    expect(getSession(0)).toBeUndefined();
  });
});
