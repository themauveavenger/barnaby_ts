import type { AgentSession } from '@earendil-works/pi-coding-agent';

export const SESSION_TIMEOUT_MS = 45_000;

export function isAllowedChat(chatId: number): boolean {
  const allowedChatIds = (process.env.TELEGRAM_CHAT_ID ?? '')
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => !Number.isNaN(id));
  return allowedChatIds.includes(chatId);
}

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
  }
  catch (error) {
    if (wasTimeout) {
      return { result: undefined, wasTimeout: true };
    }
    throw error;
  }
  finally {
    clearTimeout(timeoutId);
  }
}
