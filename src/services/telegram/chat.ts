import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { buildMemoryContext } from '../telegram-utils.js';
import { createSession } from '../../agent/session-factory.js';
import { ALL_TOOLS, EmptyResponseError, runAgentSession, SessionTimeoutError } from '../../agent/session-runner.js';
import { promptBuilder } from '../../agent/prompt-builder.js';
import { isAllowedChat } from './shared.js';
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

  try {
    const cachedSession = getSession(chatId);

    if (cachedSession) {
      cachedSession.setActiveToolsByName([...ALL_TOOLS]);
      fastify.log.debug({ chatId }, 'Reusing existing session');

      const { text: responseText } = await runAgentSession({
        _session: cachedSession,
        prompt: text
      });

      await ctx.reply(responseText);
    } else {
      const memoryContext = buildMemoryContext(fastify);
      const prompt = promptBuilder.chat({
        userMessage: text,
        memoryContext,
        calendarIds: fastify.calendarIds
      });
      const { modelRuntime, model, resourceLoader } = fastify.agent;
      const session = await createSession({
        modelRuntime,
        model,
        resourceLoader,
        tools: ALL_TOOLS
      });
      try {
        session.setActiveToolsByName([...ALL_TOOLS]);
        const { text: responseText, session: promptedSession } = await runAgentSession({
          _session: session,
          prompt
        });

        await ctx.reply(responseText);
        setSession(chatId, promptedSession);
        fastify.log.debug({ chatId }, 'Created new session');
      } catch (error) {
        session.dispose();
        throw error;
      }
    }
  } catch (error) {
    fastify.log.error({ err: error, chatId, text }, 'Failed to process Telegram chat message');

    if (error instanceof SessionTimeoutError) {
      await ctx.reply('That took too long — please try again.');
    } else if (error instanceof EmptyResponseError) {
      await ctx.reply('I couldn\'t come up with a response. Try again?');
    } else {
      await ctx.reply('Something went wrong — please try again.');
    }
  }
}
