import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({}))
  }
}));

vi.mock('../../../src/services/telegram/shared.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/telegram/shared.js')>();
  return {
    ...actual,
    withTimeout: vi.fn(actual.withTimeout)
  };
});

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import type { Context } from 'grammy';
import { withTimeout } from '../../../src/services/telegram/shared.js';
import { handleYnab } from '../../../src/services/telegram/ynab.js';

function createMockSession() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Logged it in YNAB.'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockContext(overrides: Partial<{ chatId: number; match: string | undefined }> = {}) {
  return {
    chat: { id: overrides.chatId ?? 12345 },
    match: overrides.match,
    msg: { text: overrides.match ?? '' },
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    replyWithChatAction: vi.fn().mockResolvedValue(undefined)
  } as unknown as Context;
}

function createMockFastify() {
  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {}
    },
    log: {
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn()
    }
  } as any;
}

describe('handleYnab', () => {
  let fastify: ReturnType<typeof createMockFastify>;

  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.YNAB_BUDGET_ID = 'budget-123';
    fastify = createMockFastify();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates agent session with expanded YNAB tool allowlist', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'show me overspent categories' });
    await handleYnab(ctx, fastify);

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          'ynab_get_transactions',
          'ynab_get_payee_history',
          'ynab_create_transaction',
          'ynab_approve_transaction',
          'ynab_delete_transaction',
          'ynab_flag_transaction',
          'ynab_split_transaction',
          'ynab_get_budget_month',
          'ynab_get_categories',
          'ynab_get_accounts',
          'ynab_assign_money',
          'ynab_move_money',
          'ynab_update_category_goal',
          'ynab_payees_list'
        ]
      })
    );
  });

  it('includes guidance for discovery, budgeting, and no-clarification behavior in the prompt', async () => {
    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'move $50 from dining out to groceries' });
    await handleYnab(ctx, fastify);

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('ynab_get_accounts');
    expect(prompt).toContain('ynab_get_categories');
    expect(prompt).toContain('ynab_get_budget_month');
    expect(prompt).toContain('ynab_assign_money');
    expect(prompt).toContain('ynab_move_money');
    expect(prompt).toContain('ynab_update_category_goal');
    expect(prompt).toContain('ynab_payees_list');
    expect(prompt).toContain('do not use `dryRun=true`');
    expect(prompt).toContain('Do not ask a clarifying question');
    expect(prompt).toContain('return a brief error');
    expect(prompt).toContain('Do not guess');
  });

  it('ignores messages from unauthorized chat ID', async () => {
    const ctx = createMockContext({ chatId: 99999, match: 'should be ignored' });
    await handleYnab(ctx, fastify);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.react).not.toHaveBeenCalled();
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /ynab is called without text', async () => {
    const ctx = createMockContext({ match: undefined });
    await handleYnab(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /ynab'));
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('sends usage hint when /ynab is called with whitespace only', async () => {
    const ctx = createMockContext({ match: '   ' });
    await handleYnab(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤔');
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('Usage: /ynab'));
    expect(createAgentSession).not.toHaveBeenCalled();
  });

  it('reacts with shrug and sends specific message when session creation fails', async () => {
    (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

    const ctx = createMockContext({ match: 'show my budget' });
    await handleYnab(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('Couldn\'t start a session — please try again.');
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('reacts with shrug and sends generic message when prompt fails', async () => {
    const mockSession = createMockSession();
    mockSession.prompt.mockRejectedValue(new Error('Timeout'));
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'show my budget' });
    await handleYnab(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('Something went wrong — please try again.');
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('reacts with shrug and sends timeout message when session times out', async () => {
    (withTimeout as any).mockResolvedValueOnce({ result: undefined, wasTimeout: true });

    const mockSession = createMockSession();
    (createAgentSession as any).mockResolvedValue({ session: mockSession });

    const ctx = createMockContext({ match: 'show my budget' });
    await handleYnab(ctx, fastify);

    expect(ctx.react).toHaveBeenCalledWith('🤷');
    expect(ctx.reply).toHaveBeenCalledWith('That took too long — please try again.');
  });
});
