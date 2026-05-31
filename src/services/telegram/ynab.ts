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
  'ynab_split_transaction',
  'ynab_get_budget_month',
  'ynab_get_categories',
  'ynab_get_accounts',
  'ynab_assign_money',
  'ynab_move_money',
  'ynab_update_category_goal',
  'ynab_payees_list'
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
      + 'If still ambiguous, do not guess — return a brief error explaining what is missing.'
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
    '- If the exact account name is unclear, use `ynab_get_accounts` to discover it before deciding the request cannot be completed.',
    '- If the exact payee name is unclear, use `ynab_payees_list` or `ynab_get_payee_history` before deciding the request cannot be completed.',
    '- If the exact category name is unclear, use `ynab_get_categories` before deciding the request cannot be completed.',
    '',
    '### Split transactions',
    '',
    'When the user lists multiple items in a single purchase:',
    '- If individual amounts are given, use them as split amounts.',
    '- If individual amounts are NOT given, use `null` for all split amounts except one — '
    + 'YNAB will calculate the remainder. If you still cannot determine a valid split, '
    + 'return a brief error explaining what is missing.',
    '- Each split needs a category. If the user doesn\'t provide categories, use `ynab_get_categories` to find likely matches before deciding the request cannot be completed.',
    '- Use the `splits` parameter on `ynab_create_transaction` for new split transactions.',
    '- Use `ynab_split_transaction` only to split an EXISTING transaction.',
    '',
    '### Querying transactions and budget status',
    '',
    'For "show me recent transactions", "what did I spend at X", etc., use `ynab_get_transactions`.',
    'Use `ynab_get_payee_history` to look up past transactions with a specific payee.',
    'Use `ynab_get_budget_month` when the user asks about the overall month, Ready to Assign, or overspending.',
    'Use `ynab_get_accounts` when the user asks about account balances or wants help choosing an account.',
    'Use `ynab_get_categories` when the user asks about categories, available balances, or overspent categories.',
    '',
    '### Budgeting changes',
    '',
    'Use `ynab_assign_money` to set or adjust the assigned amount for one category.',
    'Use `ynab_move_money` to move money between categories.',
    'Use `ynab_update_category_goal` only for supported goal fields: target amount, target date, and NEED whole-amount behavior.',
    'Because there is no follow-up session, do not use `dryRun=true` for budgeting write operations. Either complete the requested change now or return a brief error explaining why you could not complete it.',
    '',
    '## Response style',
    '',
    'After completing the action, confirm briefly what you did. Keep it short and conversational.',
    'There is no follow-up conversation state for clarification. Do not ask a clarifying question.',
    'Prefer using discovery tools to resolve ambiguity first. If required information is still missing or the request cannot be completed safely, return a brief error that says exactly what is missing or why the action could not be completed.',
    'Do not guess when account, payee, category, split details, or transfer details remain ambiguous after using the available tools.',
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
