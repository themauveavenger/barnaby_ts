import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { BARNABY_PERSONALITY } from '../../agent/personality.js';
import { buildMemoryContext } from '../../services/briefing-helpers.js';
import { isAllowedChat, withTimeout } from './shared.js';

export async function handleChat(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) {
    return;
  }

  const text = ctx.msg?.text;
  if (!text) {
    return;
  }

  // Show typing indicator while the agent works
  await ctx.replyWithChatAction('typing');

  fastify.log.info({ chatId, text }, 'Telegram chat message received');

  let sessionCreated = false;

  try {
    const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      tools: ['memory_list', 'memory_resolve'],
    });

    sessionCreated = true;

    const memoryContext = buildMemoryContext(fastify);

    const prompt = [
      BARNABY_PERSONALITY,
      '',
      ...(memoryContext ? ['', memoryContext] : []),
      '',
      `The user asks: "${text}"`,
      '',
      'Answer concisely and naturally. Use the memory_list tool to search for relevant information if needed. ' +
        'You can only search and read memories — you cannot create new ones. ' +
        'If you find relevant memories, reference them directly. ' +
        'If nothing relevant comes up, say so honestly rather than making things up.',
    ].join('\n');

    const { result: responseText, wasTimeout } = await withTimeout(session, async () => {
      await session.prompt(prompt);
      return session.getLastAssistantText();
    });

    if (wasTimeout) {
      await ctx.reply('That took too long — please try again.');
    } else {
      await ctx.reply(responseText ?? "I couldn't come up with a response. Try again?");
    }
  } catch (error) {
    fastify.log.error({ err: error, chatId, text }, 'Failed to process Telegram chat message');

    if (!sessionCreated) {
      await ctx.reply("Couldn't start a session — please try again.");
    } else {
      await ctx.reply('Something went wrong — please try again.');
    }
  }
}