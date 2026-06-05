import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { LRUCache } from 'lru-cache';

const SESSION_TTL_MS = 15 * 60 * 1000;

const sessions = new LRUCache<number, AgentSession>({
  max: 10,
  ttl: SESSION_TTL_MS,
  updateAgeOnGet: true,
  ttlAutopurge: true,
  // Disable lru-cache's 1ms TTL-resolution debounce. The debounce caches
  // the last `perf.now()` value in a closure for 1ms, which makes
  // subsequent `isStale` checks use the cached value instead of calling
  // `perf.now()` again. This is fine in production but breaks tests that
  // switch from real to fake timers in under 1ms: the cached real-time
  // value sticks around and makes the cache think new entries are
  // billions of ms old. The debounce is a micro-optimisation we don't
  // need on a cache of at most 10 entries.
  ttlResolution: 0,
  perf: { now: () => Date.now() },
  dispose: async session => {
    const r = await session.compact();

    session.dispose();
  }
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
