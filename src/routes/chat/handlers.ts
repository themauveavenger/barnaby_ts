import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

export type ChatBody = {
  message: string;
};

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model } = request.server.agent;

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  });

  try {
    await session.prompt(request.body.message);
    const responseText = session.getLastAssistantText() ?? '';
    return { response: responseText };
  } finally {
    session.dispose();
  }
}
