import type { Context } from 'grammy';
import type { FastifyInstance } from 'fastify';
import { MEMORY_CATEGORIZATION_GUIDELINES } from '../../agent/memory-guidelines.js';
import { createSession } from '../../agent/session-factory.js';
import { MEMORY_TOOLS, runAgentSession, SessionTimeoutError } from '../../agent/session-runner.js';
import { isAllowedChat } from './shared.js';

export async function handleRemember(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) {
    return;
  }

  const text = typeof ctx.match === 'string' ? ctx.match.trim() : ctx.match?.[0]?.trim();
  if (!text) {
    await ctx.react('🤔');
    await ctx.reply(
      'Usage: /remember <text>\n\nExamples:\n/remember call the dentist on Friday\n/remember shellfish allergy\n/remember what todos do I have?'
    );
    return;
  }

  fastify.log.info({ chatId, text }, 'Telegram /remember command received');

  const guidelines = MEMORY_CATEGORIZATION_GUIDELINES.join('\n');
  const prompt = `${guidelines}\n\nUser says: "${text}"`;

  try {
    const { modelRuntime, model, resourceLoader } = fastify.agent;
    const session = await createSession({
      modelRuntime,
      model,
      resourceLoader,
      tools: MEMORY_TOOLS
    });

    try {
      session.setActiveToolsByName([...MEMORY_TOOLS]);
      await runAgentSession({
        _session: session,
        prompt
      });
      await ctx.react('👍');
    } finally {
      session.dispose();
    }
  } catch (error) {
    fastify.log.error({ err: error, prompt, text }, 'Failed to process /remember command');
    await ctx.react('🤷');

    if (error instanceof SessionTimeoutError) {
      await ctx.reply('That took too long — please try again.');
    } else {
      await ctx.reply('Something went wrong — please try again.');
    }
  }
}
