import type { FastifyInstance } from 'fastify';
import type { Bot, Context } from 'grammy';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { MEMORY_CATEGORIZATION_GUIDELINES } from '../agent/memory-guidelines.js';

const REMEMBER_TIMEOUT_MS = 30_000;

export default function registerTelegramCommands(fastify: FastifyInstance): void {
  const bot: Bot<Context> = fastify.telegramBot;
  const allowedChatId = Number(process.env.TELEGRAM_CHAT_ID);

  bot.command('remember', async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId || chatId !== allowedChatId) {
      return;
    }

    const text = ctx.match?.trim();
    if (!text) {
      await ctx.react('🤔');
      await ctx.reply('Usage: /remember <text>\n\nExamples:\n/remember call the dentist on Friday\n/remember shellfish allergy\n/remember what todos do I have?');
      return;
    }

    fastify.log.info({ chatId, text }, 'Telegram /remember command received');

    // build the prompt for the agent up here so we can log any errors.
    const guidelines = MEMORY_CATEGORIZATION_GUIDELINES.join('\n');
    const prompt = `${guidelines}\n\nUser says: "${text}"`;

    let sessionCreated = false;
    let wasTimeout = false;

    try {
      const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

      const { session } = await createAgentSession({
        model,
        authStorage,
        modelRegistry,
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
        tools: ['memory_create', 'memory_list', 'memory_resolve'],
      });

      sessionCreated = true;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        wasTimeout = true;
        controller.abort();
      }, REMEMBER_TIMEOUT_MS);

      try {
        session.setAutoRetryEnabled(false);
        controller.signal.addEventListener('abort', () => {
          session.abort().catch(() => {
          });
        });

        await session.prompt(prompt);
        await ctx.react('👍');
      } finally {
        clearTimeout(timeoutId);
        session.dispose();
      }
    } catch (error) {
      fastify.log.error({ err: error, prompt, text }, 'Failed to process /remember command');
      await ctx.react('🤷');

      if (wasTimeout) {
        await ctx.reply('That took too long — please try again.');
      } else if (!sessionCreated) {
        await ctx.reply("Couldn't start a session — please try again.");
      } else {
        await ctx.reply('Something went wrong — please try again.');
      }
    }
  });
}