import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Context } from 'grammy';
import { handleKillSessions } from '../../../src/services/telegram/kill-sessions.js';
import { getSession, setSession, clearSessionStore } from '../../../src/services/telegram/session-store.js';

function createMockSession(dispose: ReturnType<typeof vi.fn> = vi.fn()) {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('test response'),
    dispose,
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockContext(overrides: Partial<{ chatId: number }> = {}) {
  return {
    chat: { id: overrides.chatId ?? 12345 },
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
  } as any;
}

describe('handleKillSessions', () => {
  let fastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    fastify = createMockFastify();
    clearSessionStore();
  });

  it('clears the session store and reacts with a checkmark on success', async () => {
    const session = createMockSession();
    setSession(12345, session as any);

    const ctx = createMockContext();
    await handleKillSessions(ctx, fastify);

    expect(getSession(12345)).toBeUndefined();
    expect(ctx.react).toHaveBeenCalledWith('👍');
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const session = createMockSession();
    setSession(12345, session as any);

    const ctx = createMockContext({ chatId: 99999 });
    await handleKillSessions(ctx, fastify);

    expect(getSession(12345)).toBe(session);
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.react).not.toHaveBeenCalled();
  });

  it('reacts with shrug and replies with the error summary when clearing fails', async () => {
    const dispose = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('session dispose exploded');
      })
      .mockImplementation(() => undefined);
    setSession(12345, createMockSession(dispose) as any);

    const ctx = createMockContext();
    await handleKillSessions(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('session dispose exploded'));
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('logs but stays silent when the confirmation reaction fails after clearing', async () => {
    const session = createMockSession();
    setSession(12345, session as any);

    const ctx = createMockContext();
    vi.mocked(ctx.react).mockRejectedValue(new Error('API unreachable'));
    await handleKillSessions(ctx, fastify);

    // The kill succeeded; only the confirmation failed, so no failure message.
    expect(getSession(12345)).toBeUndefined();
    expect(ctx.react).toHaveBeenCalledTimes(1);
    expect(ctx.react).toHaveBeenCalledWith('👍');
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(fastify.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to confirm /kill_sessions success'
    );
  });

  it('logs instead of throwing when the failure report itself fails', async () => {
    const dispose = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('dispose exploded');
      })
      .mockImplementation(() => undefined);
    setSession(12345, createMockSession(dispose) as any);

    const ctx = createMockContext();
    vi.mocked(ctx.react).mockRejectedValue(new Error('API unreachable'));
    await handleKillSessions(ctx, fastify);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(fastify.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'Failed to report error to Telegram'
    );
  });

  it('reacts with shrug and replies with a generic failure message when the error has no summary', async () => {
    const dispose = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error();
      })
      .mockImplementation(() => undefined);
    setSession(12345, createMockSession(dispose) as any);

    const ctx = createMockContext();
    await handleKillSessions(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
  });
});
