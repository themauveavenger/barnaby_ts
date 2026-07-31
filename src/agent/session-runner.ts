import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentSession, ModelRuntime, ResourceLoader } from '@earendil-works/pi-coding-agent';
import type { Api, Model } from '@earendil-works/pi-ai';

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

/** Tools active during the initial automated morning briefing prompt. */
export const BRIEFING_READONLY_TOOLS = [
  'calendar_list',
  'get_weather_forecast'
] as const;

/** Tools active during the initial automated afternoon update prompt. */
export const AFTERNOON_UPDATE_READONLY_TOOLS = [
  'calendar_list'
] as const;

/** Tools used by the /remember command. */
export const MEMORY_TOOLS = [
  'memory_create',
  'memory_list',
  'memory_resolve'
] as const;

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
  modelRuntime: ModelRuntime;
  model: Model<Api>;
  resourceLoader: ResourceLoader;
  tools: readonly string[] | string[];
  activeTools?: readonly string[] | string[];
  prompt: string;
  signal?: AbortSignal;
  /**
   * Internal override for the prompt timeout. Defaults to 45 seconds. Tests
   * may pass a shorter value to avoid real waits.
   */
  _timeoutMs?: number;
  /**
   * An existing session to reuse instead of creating a new one. When provided,
   * the tools are only used to set active tools via setActiveToolsByName.
   */
  _session?: AgentSession;
}

export interface RunAgentSessionResult {
  text: string;
  session: AgentSession;
}

/**
 * Creates a fresh agent session, runs a single prompt with timeout and abort
 * protection, and returns both the response text and the live session.
 *
 * Callers are responsible for caching the returned session or disposing it.
 */
export async function runAgentSession(
  options: RunAgentSessionOptions
): Promise<RunAgentSessionResult> {
  const { modelRuntime, model, resourceLoader, tools, activeTools, prompt, signal, _timeoutMs, _session } = options;

  let session: AgentSession;
  // The session created here (never _session). The caller only receives a
  // session when runAgentSession returns normally, so any failure must
  // dispose what we created or it leaks. Declared separately so the catch
  // can reference it without tripping definite-assignment analysis.
  let createdSession: AgentSession | undefined;
  let timeoutFired = false;

  // Set up the timeout before any await so fake-timer tests can intercept it.
  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    session?.abort().catch(() => {
      void 0;
    });
  }, _timeoutMs ?? SESSION_TIMEOUT_MS);

  const onExternalAbort = () => {
    session?.abort().catch(() => {
      void 0;
    });
  };

  signal?.addEventListener('abort', onExternalAbort);
  if (signal?.aborted) {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onExternalAbort);
    throw new Error('Session aborted');
  }

  try {
    if (_session) {
      session = _session;
    } else {
      ({ session } = await createAgentSession({
        model,
        modelRuntime,
        resourceLoader,
        sessionManager: SessionManager.inMemory(),
        tools: [...tools]
      }));
      createdSession = session;
    }

    session.setActiveToolsByName([...(activeTools ?? tools)]);
    session.setAutoRetryEnabled(false);

    await session.prompt(prompt);
  } catch (error) {
    createdSession?.dispose();
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
    createdSession?.dispose();
    throw new EmptyResponseError();
  }

  return { text, session };
}
