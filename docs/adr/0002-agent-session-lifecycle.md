# Session lifecycle ownership: caller-provided sessions

Issue #12 originally specified `runAgentSession(opts)` as owning the full agent session lifecycle: it would create the session, register the full tool registry, apply an `activeTools` subset via `setActiveToolsByName`, prompt with timeout/abort protection, and return `{ text, session }`. The implementation deliberately deviated from that interface, and this ADR records the design that landed.

We adopt a three-way split of session concerns:

- **`src/agent/session-factory.ts`** owns creation. `createSession` takes the model runtime, model, resource loader, and the tool registry; the caller owns the result.
- **`src/agent/session-runner.ts`** owns prompt execution: the 45-second timeout, external `AbortSignal` handling, auto-retry disablement, and error normalization (`SessionTimeoutError`, `EmptyResponseError`). It never creates or disposes a session.
- **Callers** own tool activation (`setActiveToolsByName`), caching (via the session-store's 15-minute LRU cache), and disposal.

Why caller-provided sessions instead of runner-created ones? A runner that both creates and prompts carries two disposal policies — "dispose what I created, never touch what the caller gave me" — which made its error paths hard to reason about (the earlier implementation needed a definite-assignment workaround to survive its own catch block) and blurred the boundary between prompt failure and session caching. "Whoever creates disposes" is a single, checkable invariant, and the runner's tests no longer need to mock `createAgentSession`.

Tool activation is per-path policy, not runner policy. Briefing and afternoon-update deliveries register the full registry (`ALL_TOOLS`) but activate read-only subsets (`BRIEFING_READONLY_TOOLS`, `AFTERNOON_UPDATE_READONLY_TOOLS`) for the first prompt; Telegram chat and replies to cached sessions activate `ALL_TOOLS`; `/remember` uses `MEMORY_TOOLS`.

The scheduled-message helper `deliverScheduledMessage` (in `telegram-utils.ts`) stays shared between briefing and afternoon update rather than being inlined as #12 proposed, because dispose-on-failure, session caching, `TELEGRAM_CHAT_ID` handling, and the optional briefing-repository save are shared complexity with a single owner.

Briefing and afternoon-update deliveries cache their live session via `setSession(chatId, session)`, so a user reply within the TTL window reuses the session that generated the message; when a new delivery overwrites a cached session, the LRU cache's dispose callback cleans up the evicted session.

Decisions recorded from the implementation of #12 (commits `a22031d`, `59b9659`, `e779a0e`).
