import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { buildMemoryContext } from '../telegram-utils.js';
import { promptBuilder } from '../../agent/prompt-builder.js';
import { isAllowedChat, withTimeout } from './shared.js';
import { getSession, setSession } from './session-store.js';

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
    // Try to get existing session from store
    let session = getSession(chatId);
    let prompt: string;

    if (session) {
      // Reuse existing session - just send the user's message
      prompt = text;
      fastify.log.debug({ chatId }, 'Reusing existing session');
    } else {
      // Create new session with full context
      const { modelRuntime, model, resourceLoader } = fastify.agent;

      const result = await createAgentSession({
        model,
        modelRuntime,
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
        tools: ['calendar_list', 'memory_list', 'memory_resolve', 'drive_read_doc', 'drive_list_docs', 'wolfram_alpha']
      });

      session = result.session;
      sessionCreated = true;

      const memoryContext = buildMemoryContext(fastify);

      prompt = promptBuilder.chat({
        userMessage: text,
        memoryContext,
        calendarIds: fastify.calendarIds
      });

      // Store the session for reuse
      setSession(chatId, session);
      fastify.log.debug({ chatId }, 'Created new session');
    }

    const { result: responseText, wasTimeout } = await withTimeout(session, async () => {
      await session.prompt(prompt);
      return session.getLastAssistantText();
    });

    if (wasTimeout) {
      await ctx.reply('That took too long — please try again.');
    } else {
      await ctx.reply(responseText ?? 'I couldn\'t come up with a response. Try again?');
    }
  } catch (error) {
    fastify.log.error({ err: error, chatId, text }, 'Failed to process Telegram chat message');

    if (!sessionCreated) {
      await ctx.reply('Couldn\'t start a session — please try again.');
    } else {
      await ctx.reply('Something went wrong — please try again.');
    }
  }
}
