import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { } from 'ts-pattern';

/**
 * Maximum time (in milliseconds) allowed for an LLM operation before timing out.
 *
 * Set to 45 seconds to balance giving the model enough time for complex responses
 * while preventing users from waiting indefinitely on hung API calls.
 */
export const SESSION_TIMEOUT_MS = 45_000;

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

/**
 * Wraps an async operation with timeout protection, automatically aborting the session if exceeded.
 *
 * Prevents LLM API calls from hanging indefinitely by monitoring execution time and
 * triggering session abortion when the timeout is reached. This ensures responsive
 * user experience and prevents resource exhaustion from stuck operations.
 *
 * The session parameter is required so the wrapper can abort the underlying LLM request
 * when the timeout fires, rather than just abandoning the Promise.
 *
 * @param session - The agent session to abort if the operation times out
 * @param fn - The async operation to execute with timeout protection
 * @returns A discriminated union: `{ result: T, wasTimeout: false }` on success,
 *          or `{ result: undefined, wasTimeout: true }` if the operation timed out
 */
export async function withTimeout<T>(
  session: AgentSession,
  fn: () => Promise<T>
): Promise<{ result: T; wasTimeout: false } | { result: undefined; wasTimeout: true }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  let wasTimeout = false;

  session.setAutoRetryEnabled(false);
  controller.signal.addEventListener('abort', () => {
    wasTimeout = true;
    session.abort().catch(() => {
      void 0;
    });
  });

  try {
    const result = await fn();
    return { result, wasTimeout };
  } catch (error) {
    if (wasTimeout) {
      return { result: undefined, wasTimeout: true };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
