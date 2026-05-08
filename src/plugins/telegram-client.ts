import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Bot, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';

export type TelegramClient = {
  sendMessage(chatId: number, text: string): Promise<void>;
};

const MAX_MESSAGE_LENGTH = 4096;

export default fp(async function telegramClientPlugin(fastify: FastifyInstance) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  const bot = new Bot(token);
  // Enable automatic retry on 429s
  bot.api.config.use(autoRetry());

  // /start handler: log chat id and reply with setup instructions
  bot.command('start', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (typeof chatId !== 'undefined') {
      fastify.log.info(`Telegram /start from chat ${chatId}`);
    }
    await ctx.reply(`Hello! I'm Barnaby. Your chat ID is ${chatId}. Set TELEGRAM_CHAT_ID=${chatId} in your .env to receive daily briefings.`);
  });

  // Bot lifecycle
  fastify.addHook('onReady', () => {
    // Do not await; start is long-running and should run in background
    bot.start().catch((err) => {
      fastify.log.error(err, 'Telegram bot failed to start');
    });
  });

  fastify.addHook('onClose', async () => {
    try {
      await bot.stop();
    } catch (err) {
      fastify.log.error(err, 'Telegram bot failed to stop');
    }
  });

  const client: TelegramClient = {
    async sendMessage(chatId: number, text: string) {
      const payload = text.length > MAX_MESSAGE_LENGTH
        ? text.slice(0, MAX_MESSAGE_LENGTH - 3) + '...'
        : text;
      await bot.api.sendMessage(chatId, payload);
    },
  };

  fastify.decorate('telegramClient', client);
  fastify.decorate('telegramBot', bot);
});
