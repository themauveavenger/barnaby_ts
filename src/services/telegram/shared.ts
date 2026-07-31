import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { match, P } from 'ts-pattern';
import { SessionTimeoutError } from '../../agent/session-runner.js';

/**
 * Validates whether a chat is authorized to interact with the bot.
 *
 * Implements a whitelist security model - only chat IDs explicitly listed in the
 * TELEGRAM_CHAT_ID environment variable are allowed. This prevents unauthorized
 * users from accessing the bot even if they discover it.
 *
 * The environment variable accepts comma-separated chat IDs (e.g., "123456,789012").
 */
export function isAllowedChat(chatId: number): boolean {
  const allowedChatIds = (process.env.TELEGRAM_CHAT_ID ?? '')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => !Number.isNaN(id));
  return allowedChatIds.includes(chatId);
}

export const GENERIC_ERROR_MESSAGE = 'Something went wrong — please try again.';

const TIMEOUT_ERROR_MESSAGE = 'That took too long — please try again.';

/**
 * Maps an agent-run failure to the user-facing error message. Handler-specific
 * failures (e.g. chat's empty response) are layered on top of this by the
 * individual handlers.
 */
export function defaultErrorMessage(error: unknown): string {
  return match(error)
    .with(P.instanceOf(SessionTimeoutError), () => TIMEOUT_ERROR_MESSAGE)
    .otherwise(() => GENERIC_ERROR_MESSAGE);
}

/**
 * Reacts 🤷 and replies with `replyText` after a handler failure.
 *
 * The reaction and reply are themselves Telegram I/O and can fail (GrammyError
 * on 4xx, HttpError on network loss). They are guarded so a failed report can
 * never throw out of the handler: grammy's default error handler would stop
 * the bot (no bot.catch is installed).
 */
export async function reportTelegramError(
  ctx: Context,
  fastify: FastifyInstance,
  { chatId, replyText }: { chatId: number; replyText: string }
): Promise<void> {
  try {
    await ctx.react('🤷');
    await ctx.reply(replyText);
  } catch (error) {
    fastify.log.error({ err: error, chatId }, 'Failed to report error to Telegram');
  }
}
