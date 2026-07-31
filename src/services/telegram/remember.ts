import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { MEMORY_CATEGORIZATION_GUIDELINES } from '../../agent/memory-guidelines.js';
import { createSession } from '../../agent/session-factory.js';
import { MEMORY_TOOLS, runAgentSession } from '../../agent/session-runner.js';
import { confirmSuccess, defaultErrorMessage, disposeQuietly, reportTelegramError } from './shared.js';
import { isAllowedChat } from './auth.js';

export async function handleRemember(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) {
    return;
  }

  const text = typeof ctx.match === 'string' ? ctx.match.trim() : ctx.match?.[0]?.trim();
  if (!text) {
    await ctx.react('🤔');
    await ctx.reply(
      'Usage: /remember <text>\n\nExamples:\n/remember call the dentist on Friday\n/remember shellfish allergy\n/remember what todos do I have?'
    );
    return;
  }

  fastify.log.info({ chatId, text }, 'Telegram /remember command received');

  const guidelines = MEMORY_CATEGORIZATION_GUIDELINES.join('\n');
  const prompt = `${guidelines}\n\nUser says: "${text}"`;

  // Run first: this is the only step whose failure means the memory was not
  // saved. Disposal is guarded so a dispose failure can never mask the run
  // error or escape the handler — grammy's default error handler would stop
  // the bot (no bot.catch is installed).
  try {
    const { modelRuntime, model, resourceLoader } = fastify.agent;
    const session = await createSession({
      modelRuntime,
      model,
      resourceLoader,
      tools: MEMORY_TOOLS
    });

    try {
      session.setActiveToolsByName([...MEMORY_TOOLS]);
      await runAgentSession({
        _session: session,
        prompt
      });
    } finally {
      disposeQuietly(session, fastify, { chatId, logLabel: 'Failed to dispose /remember session' });
    }
  } catch (error) {
    fastify.log.error({ err: error, prompt, text }, 'Failed to process /remember command');
    await reportTelegramError(ctx, fastify, { chatId, replyText: defaultErrorMessage(error) });
    return;
  }

  // Confirm: if this fails the memory was already saved, so report nothing — a
  // failure reply would claim the save failed when it succeeded.
  await confirmSuccess(ctx, fastify, { chatId, logLabel: 'Failed to confirm /remember success' });
}
