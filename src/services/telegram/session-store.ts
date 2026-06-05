import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { LRUCache } from 'lru-cache';

const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new LRUCache<number, AgentSession>({
  max: 10,
  ttl: SESSION_TTL_MS,
  updateAgeOnGet: true,
  ttlAutopurge: true,
  perf: { now: () => Date.now() },
  dispose: session => session.dispose()
});

export function getSession(chatId: number): AgentSession | undefined {
  return sessions.get(chatId);
}

export function setSession(chatId: number, session: AgentSession): void {
  sessions.set(chatId, session);
}

export function clearSessionStore(): void {
  sessions.clear();
}
