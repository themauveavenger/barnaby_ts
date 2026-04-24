import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';

export type ChatBody = {
  message: string;
};

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry } = request.server.agent;

  const model = getModel('opencode-go', 'kimi-k2.5');

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  });

  await session.prompt(request.body.message);

  const responseText = session.getLastAssistantText() ?? '';
  return { response: responseText };
}
