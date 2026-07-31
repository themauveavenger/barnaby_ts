import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { match, P } from 'ts-pattern';
import { SessionTimeoutError } from '../../agent/session-runner.js';

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

/**
 * Reacts 👍 to confirm a handler succeeded. The reaction is Telegram I/O and
 * can fail; if it does, the operation already succeeded so we log only — a
 * failure reply would claim the operation failed when it didn't.
 */
export async function confirmSuccess(
  ctx: Context,
  fastify: FastifyInstance,
  { chatId, logLabel }: { chatId: number; logLabel: string }
): Promise<void> {
  try {
    await ctx.react('👍');
  } catch (error) {
    fastify.log.error({ err: error, chatId }, logLabel);
  }
}

/**
 * Disposes a session, swallowing and logging any failure so it can neither
 * mask an operation error nor escape the handler — grammy's default error
 * handler would stop the bot (no bot.catch is installed). Only the `dispose`
 * member is required, so callers may pass any object exposing it.
 */
export function disposeQuietly(
  session: Pick<AgentSession, 'dispose'>,
  fastify: FastifyInstance,
  { chatId, logLabel }: { chatId: number; logLabel: string }
): void {
  try {
    session.dispose();
  } catch (error) {
    fastify.log.error({ err: error, chatId }, logLabel);
  }
}
