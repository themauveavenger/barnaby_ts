import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export type ChatBody = {
  message: string;
};

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;
  const timezone = request.server.timezone;

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  });

  try {
    const today = format(TZDate.tz(timezone), 'EEEE, MMMM d, yyyy');

    const coreMemories = request.server.memoryRepository.findByTags(['core'], { permanentOnly: true });

    const coreContext = coreMemories.length > 0
      ? ['Core memories about the user:', ...coreMemories.map((m) => `- ${m.content}`)].join('\n')
      : '';

    const prompt = [
      `Today is ${today}.`,
      '',
      coreContext,
      '',
      request.body.message,
    ].filter(Boolean).join('\n');

    await session.prompt(prompt);
    const responseText = session.getLastAssistantText() ?? '';
    return { response: responseText };
  } finally {
    session.dispose();
  }
}
