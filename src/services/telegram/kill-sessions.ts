import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { match } from 'ts-pattern';
import { confirmSuccess, GENERIC_ERROR_MESSAGE, reportTelegramError } from './shared.js';
import { isAllowedChat } from './auth.js';
import { clearSessionStore } from './session-store.js';

export async function handleKillSessions(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) {
    return;
  }

  fastify.log.info({ chatId }, 'Telegram /kill_sessions command received');

  // Kill first: this is the only step whose failure means sessions survive.
  try {
    clearSessionStore();
  } catch (error) {
    fastify.log.error({ err: error, chatId }, 'Failed to clear sessions');

    const summary = error instanceof Error && error.message ? error.message : null;
    await reportTelegramError(ctx, fastify, {
      chatId,
      replyText: match(summary)
        .with(null, () => GENERIC_ERROR_MESSAGE)
        .otherwise(s => `Failed to kill sessions: ${s}`)
    });
    return;
  }

  // Confirm: if this fails the kill already happened, so report nothing — a
  // failure reply would claim the kill failed when it succeeded.
  await confirmSuccess(ctx, fastify, { chatId, logLabel: 'Failed to confirm /kill_sessions success' });
}
