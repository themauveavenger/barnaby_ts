import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import type { Memory, ResolvedMemory } from '../plugins/repository.js';

export function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function formatMemoryList(memories: Pick<Memory, 'content'>[]): string {
  return memories.map((m) => `- ${m.content}`).join('\n');
}

export function formatResolvedList(memories: ResolvedMemory[]): string {
  return memories.map((m) => {
    const date = new Date(m.actionCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const action = m.action === 'completed' ? 'completed' : 'dismissed';
    return `- ${m.content} (${action} ${date})`;
  }).join('\n');
}

export function buildMemoryContext(fastify: FastifyInstance): string {
  const coreMemories = fastify.memoryRepository.findByTags(['core'], { permanentOnly: true });
  const recentMemories = fastify.memoryRepository.findRecent(7);
  const resolvedMemories = fastify.memoryRepository.findResolvedRecent(7);

  const coreContext = coreMemories.length > 0
    ? `Core memories about the user:\n${formatMemoryList(coreMemories)}`
    : '';

  const recentContext = recentMemories.length > 0
    ? `Recent notes and tasks (last 7 days):\n${formatMemoryList(recentMemories)}`
    : '';

  const resolvedContext = resolvedMemories.length > 0
    ? `Tasks already completed or dismissed (do not mention these again):\n${formatResolvedList(resolvedMemories)}`
    : '';

  return [coreContext, recentContext, resolvedContext].filter(Boolean).join('\n\n');
}

export type DeliverOptions = {
  fastify: FastifyInstance;
  tools: string[];
  prompt: string;
  signal?: AbortSignal;
  saveToRepo?: { triggerType: 'scheduled' | 'manual' };
};

export class EmptyResponseError extends Error {
  constructor() {
    super('Agent returned an empty response');
    this.name = 'EmptyResponseError';
  }
}

export class MissingChatIdError extends Error {
  constructor() {
    super('TELEGRAM_CHAT_ID is not set');
    this.name = 'MissingChatIdError';
  }
}

export async function createAgentAndDeliver(options: DeliverOptions): Promise<string> {
  const { fastify, tools, prompt, signal, saveToRepo } = options;

  const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
  if (!chatIdEnv) {
    throw new MissingChatIdError();
  }

  const chatId = Number(chatIdEnv);
  const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    tools,
  });

  session.setAutoRetryEnabled(false);

  const onAbort = () => {
    session.abort().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) {
    onAbort();
  }

  try {
    await session.prompt(prompt);
    const responseText = session.getLastAssistantText()?.trim();

    if (!responseText) {
      throw new EmptyResponseError();
    }

    await fastify.telegramClient.sendMessage(chatId, responseText);

    if (saveToRepo) {
      fastify.briefingRepository.create({
        content: responseText,
        triggerType: saveToRepo.triggerType,
      });
    }

    return responseText;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    session.dispose();
  }
}