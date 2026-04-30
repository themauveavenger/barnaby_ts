import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

export type ChatBody = {
  message: string;
};

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  });

  try {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

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
