import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { isAllowedChat, withTimeout } from './shared.js';

const YNAB_TOOLS = [
  'ynab_get_transactions',
  'ynab_get_payee_history',
  'ynab_create_transaction',
  'ynab_approve_transaction',
  'ynab_delete_transaction',
  'ynab_flag_transaction',
  'ynab_split_transaction'
];

/**
 * YNAB accounts: name → ID.
 * Names must match exactly as they appear in YNAB.
 * Used in the prompt so the agent can map natural language ("on my Chase") to the right account.
 */
const YNAB_ACCOUNTS = new Map<string, string>([
  // TODO: populate with [name, id] pairs
  // e.g. ['Checking', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
  //      ['Chase Sapphire', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'],
]);

function buildYnabPrompt(userText: string): string {
  const budgetId = process.env.YNAB_BUDGET_ID;
  const today = new Date().toISOString().split('T')[0];

  const lines = [
    'You are a YNAB assistant. The user will describe a financial transaction or ask about their budget.',
    'Your job is to interpret their request and call the appropriate YNAB tool.',
    '',
    '## Context',
    '',
    `Budget ID: ${budgetId ?? 'UNKNOWN — ask the user'}`,
    `Today's date: ${today}`,
    ''
  ];

  if (YNAB_ACCOUNTS.size > 0) {
    lines.push('## Accounts');
    lines.push('');
    lines.push('These are the exact account names (and IDs) in YNAB:');
    for (const [name, id] of YNAB_ACCOUNTS) {
      lines.push(`- ${name} (${id})`);
    }
    lines.push('');
    lines.push(
      'When the user mentions an account or card, match it to the closest name from this list. '
      + 'If ambiguous, ask which one they mean.'
    );
    lines.push('');
  }

  lines.push(
    '## How to interpret requests',
    '',
    '### Creating transactions',
    '',
    'Most requests will be creating transactions. Interpret spending language like this:',
    '- "spent $100 at Stop & Shop" → single outflow transaction',
    '- "spent $90 at Amazon on shoes, pencils, and paper towels" → split transaction (one per item)',
    '- "$50 from checking to savings" → transfer between accounts',
    '',
    'Rules:',
    '- Outflows are NEGATIVE amounts. If the user says "spent $100", the amount is -100.',
    '- Inflows are POSITIVE amounts (refunds, income, reimbursements).',
    '- If a date is mentioned (e.g. "yesterday", "last Friday"), calculate from today\'s date. Otherwise use today.',
    '- The `account` field is required — it\'s the account the money came from (or went into).',
    '- The `payee` field is the merchant or person. Use the name as given by the user.',
    '- If a category is not specified, omit it — YNAB will leave it uncategorized for later.',
    '',
    '### Split transactions',
    '',
    'When the user lists multiple items in a single purchase:',
    '- If individual amounts are given, use them as split amounts.',
    '- If individual amounts are NOT given, use `null` for all split amounts except one — '
    + 'YNAB will calculate the remainder. If you cannot determine any individual amounts, '
    + 'ask the user how to divide it.',
    '- Each split needs a category. If the user doesn\'t provide categories, ask.',
    '- Use the `splits` parameter on `ynab_create_transaction` for new split transactions.',
    '- Use `ynab_split_transaction` only to split an EXISTING transaction.',
    '',
    '### Querying transactions',
    '',
    'For "show me recent transactions", "what did I spend at X", etc., use `ynab_get_transactions`.',
    'Use `ynab_get_payee_history` to look up past transactions with a specific payee.',
    '',
    '## Response style',
    '',
    'After completing the action, confirm briefly what you did. Keep it short and conversational.',
    'If something is ambiguous or missing (account, payee, how to split), ask ONE clarifying question.',
    '',
    '---',
    '',
    `User says: "${userText}"`
  );

  return lines.join('\n');
}

export async function handleYnab(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) {
    return;
  }

  const text = typeof ctx.match === 'string' ? ctx.match.trim() : ctx.match?.[0]?.trim();
  if (!text) {
    await ctx.react('🤔');
    await ctx.reply(
      'Usage: /ynab <request>\n\nExamples:\n'
      + '/ynab spent $100 at Stop & Shop on the Chase\n'
      + '/ynab $90 at Amazon on shoes, pencils, and paper towels\n'
      + '/ynab show recent transactions'
    );
    return;
  }

  fastify.log.info({ chatId, text }, 'Telegram /ynab command received');

  let sessionCreated = false;

  try {
    const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      tools: YNAB_TOOLS
    });

    sessionCreated = true;

    const prompt = buildYnabPrompt(text);

    const { result: responseText, wasTimeout } = await withTimeout(session, async () => {
      await session.prompt(prompt);
      return session.getLastAssistantText();
    });

    if (wasTimeout) {
      await ctx.react('🤷');
      await ctx.reply('That took too long — please try again.');
    }
    else {
      await ctx.reply(responseText ?? 'I couldn\'t come up with a response. Try again?');
    }
  }
  catch (error) {
    fastify.log.error({ err: error, text }, 'Failed to process /ynab command');
    await ctx.react('🤷');

    if (!sessionCreated) {
      await ctx.reply('Couldn\'t start a session — please try again.');
    }
    else {
      await ctx.reply('Something went wrong — please try again.');
    }
  }
}
