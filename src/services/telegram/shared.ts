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
