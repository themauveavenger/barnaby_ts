import type { AgentSession } from '@earendil-works/pi-coding-agent';

/** Maximum time (in milliseconds) allowed for a single agent prompt. */
export const SESSION_TIMEOUT_MS = 45_000;

/**
 * Full tool registry used by Telegram chat and by user follow-ups to cached
 * sessions. Registering the full set lets a session switch capabilities
 * between turns via setActiveToolsByName.
 */
export const ALL_TOOLS = [
  'calendar_list',
  'get_weather_forecast',
  'memory_list',
  'memory_resolve',
  'memory_create',
  'drive_read_doc',
  'drive_list_docs',
  'wolfram_alpha',
  'kagi_search',
  'kagi_extract'
] as const;

/** A tool name valid in the full registry. */
export type AgentToolName = (typeof ALL_TOOLS)[number];

/** Tools active during the initial automated morning briefing prompt. */
export const BRIEFING_READONLY_TOOLS = [
  'calendar_list',
  'get_weather_forecast'
] as const satisfies readonly AgentToolName[];

/** Tools active during the initial automated afternoon update prompt. */
export const AFTERNOON_UPDATE_READONLY_TOOLS = [
  'calendar_list'
] as const satisfies readonly AgentToolName[];

/** Tools used by the /remember command. */
export const MEMORY_TOOLS = [
  'memory_create',
  'memory_list',
  'memory_resolve'
] as const satisfies readonly AgentToolName[];

/** Thrown when the assistant produces no text response. */
export class EmptyResponseError extends Error {
  constructor() {
    super('Agent returned an empty response');
    this.name = 'EmptyResponseError';
  }
}

/** Thrown when a prompt exceeds the configured session timeout. */
export class SessionTimeoutError extends Error {
  constructor() {
    super('Session timed out');
    this.name = 'SessionTimeoutError';
  }
}

export interface RunAgentSessionOptions {
  /** The caller-created session to prompt. The runner never disposes it. */
  _session: AgentSession;
  prompt: string;
  signal?: AbortSignal;
  /**
   * Internal override for the prompt timeout. Defaults to 45 seconds. Tests
   * may pass a shorter value to avoid real waits.
   */
  _timeoutMs?: number;
}

export interface RunAgentSessionResult {
  text: string;
  session: AgentSession;
}

/**
 * Runs one prompt on a caller-provided session with timeout and abort
 * protection. It never creates or disposes a session.
 */
export async function runAgentSession(
  options: RunAgentSessionOptions
): Promise<RunAgentSessionResult> {
  const { _session: session, prompt, signal, _timeoutMs } = options;
  let timeoutFired = false;

  const abortSession = (): void => {
    session.abort().catch(() => {
      void 0;
    });
  };

  // Set up the timeout before any await so fake-timer tests can intercept it.
  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    abortSession();
  }, _timeoutMs ?? SESSION_TIMEOUT_MS);

  const onExternalAbort = () => {
    abortSession();
  };

  signal?.addEventListener('abort', onExternalAbort);
  if (signal?.aborted) {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
    throw new Error('Session aborted');
  }

  try {
    session.setAutoRetryEnabled(false);
    await session.prompt(prompt);
  } catch (error) {
    if (timeoutFired) {
      throw new SessionTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
  }

  const text = session.getLastAssistantText()?.trim();
  if (!text) {
    throw new EmptyResponseError();
  }

  return { text, session };
}
