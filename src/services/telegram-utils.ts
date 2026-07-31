import type { FastifyInstance } from 'fastify';
import type { Memory, ResolvedMemory } from '../plugins/repository.js';
import { ALL_TOOLS, runAgentSession } from '../agent/session-runner.js';
import { setSession } from './telegram/session-store.js';

export function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export function formatMemoryList(memories: Pick<Memory, 'content'>[]): string {
  return memories.map(m => `- ${m.content}`).join('\n');
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

export interface DeliverScheduledMessageOptions {
  fastify: FastifyInstance;
  activeTools: readonly string[];
  prompt: string;
  signal?: AbortSignal;
  /** Persist the delivered text to the briefing repository. */
  saveToRepo?: { triggerType: 'scheduled' | 'manual' };
}

/**
 * Runs a scheduled agent message: full tool registry registered, only the
 * given read-only tools active for the first prompt, result delivered to
 * Telegram, then the live session cached for conversational follow-ups.
 * The session is disposed if delivery fails so nothing is cached on
 * partial success.
 */
export async function deliverScheduledMessage(options: DeliverScheduledMessageOptions): Promise<void> {
  const { fastify, activeTools, prompt, signal, saveToRepo } = options;

  const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
  if (!chatIdEnv) {
    throw new MissingChatIdError();
  }

  const chatId = Number(chatIdEnv);
  const { modelRuntime, model, resourceLoader } = fastify.agent;

  const { text, session } = await runAgentSession({
    modelRuntime,
    model,
    resourceLoader,
    tools: ALL_TOOLS,
    activeTools,
    prompt,
    signal
  });

  try {
    await fastify.telegramClient.sendMessage(chatId, text);
    if (saveToRepo) {
      fastify.briefingRepository.create({
        content: text,
        triggerType: saveToRepo.triggerType
      });
    }
    setSession(chatId, session);
  } catch (error) {
    session.dispose();
    throw error;
  }
}

export class MissingChatIdError extends Error {
  constructor() {
    super('TELEGRAM_CHAT_ID is not set');
    this.name = 'MissingChatIdError';
  }
}
