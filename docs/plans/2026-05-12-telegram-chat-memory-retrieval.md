# Telegram Chat & Memory Retrieval

**Date:** 2026-05-12

## Goal

Allow free-form Telegram messages to Barnaby (not just `/remember`) so the user can ask questions like "what type of donut did Iris like?" and have Barnaby search its memories and respond conversationally.

## Background

Barnaby currently handles three interaction patterns via Telegram:

1. **`/start`** — replies with chat ID setup instructions. Registered in `telegram-client.ts`.
2. **`/remember <text>`** — creates a one-shot agent session with `memory_create`, `memory_list`, and `memory_resolve` tools, prompts the agent with categorization guidelines, and reacts with 👍/🤷. In `services/telegram-commands.ts`.
3. **Briefings** — scheduled cron jobs that create one-shot sessions with calendar/weather tools, inject memory context into the prompt, and send the response via Telegram. No `/command`, no user-initiated interaction.

There is also a web chat API (`POST /chat`) that creates an ephemeral agent session with **no tools** and injects core memories into the prompt, returning the LLM response as JSON. This is the closest existing pattern to what we need, but it's an offline API, not a Telegram handler, and it has no tool access.

All three Telegram patterns create and dispose an agent session within a single request. None support multi-turn conversation.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Session lifecycle | One-shot per message | Simpler, no state/expiry management. Multi-turn can be added later. |
| Message routing | Free-form messages → chat; `/remember` stays as explicit store | Natural conversational feel. Commands are handled by `bot.command()`, so no overlap. |
| Memory tools for chat | `memory_list` and `memory_resolve` only | Chat can *query* memories but not *create* them — that stays with `/remember`. |
| Memory search strategy | Agent-driven via `memory_list` tool | Reuses existing tool. The LLM decides which filters (category, tags, `recent_days`) to apply based on the user's question. No new database code needed. |
| Timeout | 30 seconds (matching `/remember`) | Chat may need 1–2 tool calls, but memory queries are fast. 30s is enough. |
| Session persistence | None | In-memory, disposed after response. No `SessionManager.create()`. |

## What the User Sees

**Before (current):**
```
User: /remember Iris loves maple donuts
Barnaby: 👍
```
(No way to query — only `/remember` and scheduled briefings.)

**After:**
```
User: /remember Iris loves maple donuts
Barnaby: 👍

User: what type of donut did Iris like?
Barnaby: Iris likes maple donuts! 🍩

User: what do I have going on this week?
Barnaby: You've got a dentist appointment on Thursday and a dinner with Sam on Friday.

User: hey barnaby
Barnaby: Hey! What's up?
```

- `/remember` — behavior unchanged. Still creates memories. Still reacts with 👍.
- Free-form text — creates a one-shot agent session with `memory_list` and `memory_resolve` tools, includes memory context in the prompt, and replies with the agent's text response.
- Commands (`/start`, `/remember`) — handled by `bot.command()`, never reach the message handler.

## File Organization

`services/telegram-commands.ts` will grow significantly with this change. Rather than one file with `/remember`, `/start`, and a message handler, split into a directory:

```
src/services/telegram/
├── index.ts          # registerHandlers() — wires up bot.command and bot.on
├── remember.ts       # /remember command handler
├── chat.ts           # Free-form message handler
└── shared.ts         # createAgentSession helper, timeout logic, prompt building
```

**Current state:**
```
src/services/telegram-commands.ts   # Everything in one file
src/plugins/telegram-client.ts      # Bot setup, /start handler, sendMessage client
```

**After:**
```
src/services/telegram/
├── index.ts          # registerHandlers(bot, fastify) — wires everything up
├── remember.ts       # handleRemember(ctx) — /remember command
├── chat.ts           # handleChat(ctx) — free-form message handler
└── shared.ts         # createChatSession(), withTimeout(), buildChatPrompt()
src/plugins/telegram-client.ts      # Unchanged — bot setup, /start, sendMessage
```

The `/start` handler stays in `telegram-client.ts` — it's bot initialization, not a command service.

### `shared.ts`

Extracted session creation and timeout logic used by both `/remember` and the chat handler:

```typescript
export const SESSION_TIMEOUT_MS = 30_000;

export async function withTimeout<T>(
  session: AgentSession,
  fn: () => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  let wasTimeout = false;

  session.setAutoRetryEnabled(false);
  controller.signal.addEventListener('abort', () => {
    wasTimeout = true;
    session.abort().catch(() => {});
  });

  try {
    return await fn();
  } finally {
    clearTimeout(timeoutId);
    session.dispose();
  }
}

export function isAllowedChat(chatId: number): boolean {
  const allowedChatId = Number(process.env.TELEGRAM_CHAT_ID);
  return chatId === allowedChatId;
}
```

### `chat.ts`

The free-form message handler:

```typescript
export async function handleChat(ctx: Context, fastify: FastifyInstance): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId || !isAllowedChat(chatId)) return;

  const text = ctx.msg?.text;
  if (!text) return;

  // Show typing indicator while the agent works
  await ctx.replyWithChatAction('typing');

  fastify.log.info({ chatId, text }, 'Telegram chat message received');

  try {
    const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry,
      resourceLoader,
      sessionManager: SessionManager.inMemory(),
      tools: ['memory_list', 'memory_resolve'],
    });

    const memoryContext = buildMemoryContext(fastify);

    const prompt = [
      BARNABY_PERSONALITY,
      '',
      ...(memoryContext ? ['', memoryContext] : []),
      '',
      `The user asks: "${text}"`,
      '',
      'Answer concisely and naturally. Use the memory_list tool to search for relevant information if needed. ' +
      'You can only search and read memories — you cannot create new ones. ' +
      'If you find relevant memories, reference them directly. ' +
      'If nothing relevant comes up, say so honestly rather than making things up.',
    ].join('\n');

    const response = await withTimeout(session, async () => {
      await session.prompt(prompt);
      return session.getLastAssistantText();
    });

    await ctx.reply(response ?? "I couldn't come up with a response. Try again?");
  } catch (error) {
    fastify.log.error({ err: error, chatId, text }, 'Failed to process Telegram chat message');
    await ctx.reply("Something went wrong — please try again.");
  }
}
```

Key differences from `/remember`:
- Tools are `memory_list` + `memory_resolve` (no `memory_create`)
- Includes `buildMemoryContext(fastify)` to give the agent core + recent memories up front
- Uses `ctx.reply()` instead of `ctx.react()` — the point is a text response
- Sends `typing` chat action for UX while the agent works
- Error message is a text reply, not a reaction

### `remember.ts`

Refactored from the current inline function in `telegram-commands.ts`. Same logic, extracted into a named export and using shared helpers:

```typescript
export async function handleRemember(ctx: Context, fastify: FastifyInstance): Promise<void> {
  // Same logic as current /remember handler
  // Uses shared withTimeout(), isAllowedChat(), and session creation
}
```

Behavior is unchanged from the current implementation.

### `index.ts`

Wires up all handlers:

```typescript
export default function registerHandlers(fastify: FastifyInstance): void {
  const bot = fastify.telegramBot;

  bot.command('remember', (ctx) => handleRemember(ctx, fastify));
  bot.on('message:text', (ctx) => handleChat(ctx, fastify));
}
```

`bot.command('remember', ...)` is checked before `bot.on('message:text', ...)`, so `/remember` messages won't reach the chat handler. This is grammy's default routing — command handlers take priority.

## Changes to Existing Files

| File | Change |
|------|--------|
| `src/services/telegram-commands.ts` | **Delete** — replaced by `src/services/telegram/` directory |
| `src/services/telegram/index.ts` | **New** — registers all handlers |
| `src/services/telegram/remember.ts` | **New** — extracted `/remember` handler |
| `src/services/telegram/chat.ts` | **New** — free-form message handler |
| `src/services/telegram/shared.ts` | **New** — session creation, timeout, auth helpers |
| `src/app.ts` | **Edit** — change import from `telegram-commands` to `telegram/index` |
| `src/plugins/telegram-client.ts` | No changes |
| `src/plugins/agent/extensions/memory.ts` | No changes |
| `src/agent/personality.ts` | No changes (referenced by chat prompt) |

## Why Not `memory_create` in Chat?

The user explicitly chose `/remember` as the only way to create memories (alongside the web UI). Reasons this makes sense:

- **Intentionality** — `/remember` signals "store this." Free-form chat could accidentally create memories from every question.
- **Noise** — Without explicit intent, the agent might over-store ("the user asked about donuts → create a note about donuts") leading to memory pollution.
- **Simplicity** — Two distinct modes: "store" (`/remember`) and "retrieve" (free-form chat) are easier to reason about than a single mode that does both.

If the user later wants the agent to create memories during chat, it's a one-line change to add `memory_create` to the tools list and adjust the prompt.

## Why Not Multi-turn Sessions?

One-shot per message means each message is independent — no conversation history between messages. Trade-offs:

- **Lost:** The ability to ask follow-up questions like "what about the second one?"
- **Kept:** Simplicity (no session storage, no TTL/expiry, no cleanup, no token accumulation)
- **Mitigated:** The memory context injected in the prompt gives a reasonable approximation of continuity for memory-retrieval queries. If the user asks "what type of donut did Iris like?", Barnaby searches its memories and answers. The next message starts fresh, but memories persist across sessions naturally.

Multi-turn sessions can be added later with `SessionManager.create()` and a per-chat session map with TTL-based eviction, if one-shot proves insufficient.

## Prompt Design for Chat

The chat prompt combines:

1. **Barnaby's personality** — `BARNABY_PERSONALITY` from `agent/personality.ts`
2. **Memory context** — `buildMemoryContext(fastify)` from `briefing-helpers.ts` (core memories + recent memories + resolved memories)
3. **The user's question** — inline
4. **Tool usage instructions** — explains what `memory_list` and `memory_resolve` can do and that the agent cannot create memories

The prompt instructs the agent to search memories first (using `memory_list` with appropriate filters) and answer from what it finds. If nothing is relevant, it should say so honestly rather than fabricating.

Sample prompt for "what type of donut did Iris like?":

```
You are Barnaby, a friendly personal assistant for your user. You are warm, casual, and efficient. Write like a helpful friend, not an administrative assistant. Answer clearly, concisely, and in plain language. Do not write or explain code unless the user explicitly asks for it.

Core memories about the user:
- Shellfish allergy
- Prefers morning appointments

Recent notes and tasks (last 30 days):
- Dentist appointment on Thursday
- Dinner with Sam on Friday

Tasks already completed or dismissed (do not mention these again):
- Buy groceries (completed May 5)

The user asks: "what type of donut did Iris like?"

Answer concisely and naturally. Use the memory_list tool to search for relevant information if needed. You can only search and read memories — you cannot create new ones. If you find relevant memories, reference them directly. If nothing relevant comes up, say so honestly rather than making things up.
```

This is similar to how briefings work, but instead of generating a report, the agent is answering a specific question.

## Testing Plan

### Unit Tests: `test/services/telegram/chat.test.ts`

New file. Tests the free-form message handler.

| Test | What it verifies |
|------|-----------------|
| `handleChat` ignores messages from unauthorized chat IDs | No session created, no reply |
| `handleChat` ignores non-text messages | No session created |
| `handleChat` sends typing indicator before processing | `ctx.replyWithChatAction('typing')` called |
| `handleChat` creates session with memory_list and memory_resolve | `createAgentSession` called with those tools |
| `handleChat` includes personality in prompt | Prompt contains `BARNABY_PERSONALITY` |
| `handleChat` includes memory context in prompt | Prompt includes core + recent memories |
| `handleChat` includes user message in prompt | Prompt contains the user's text |
| `handleChat` includes "you cannot create new memories" instruction | Prompt tells agent not to create |
| `handleChat` replies with agent text on success | `ctx.reply()` called with agent response |
| `handleChat` replies with fallback on empty agent response | `ctx.reply()` called with fallback message |
| `handleChat` replies with error message on session failure | `ctx.reply()` called with error text (no 👎 reaction) |
| `handleChat` disposes session even on error | `session.dispose()` in finally |
| `handleChat` respects 30-second timeout | Timeout aborts session |

### Unit Tests: `test/services/telegram/remember.test.ts`

Extracted from existing `test/services/telegram-commands.test.ts`. Same test cases, new file location. Tests the `/remember` handler.

| Test | What it verifies |
|------|-----------------|
| All existing `/remember` tests | Behavior unchanged after extraction |

### Unit Tests: `test/services/telegram/shared.test.ts`

Tests for shared helpers.

| Test | What it verifies |
|------|-----------------|
| `isAllowedChat` returns true for matching chat ID | Correct authorization |
| `isAllowedChat` returns false for non-matching chat ID | Rejects unauthorized |
| `withTimeout` resolves within timeout | Happy path |
| `withTimeout` aborts and disposes on timeout | Timeout behavior |
| `withTimeout` disposes session on success | Cleanup |
| `withTimeout` disposes session on error | Cleanup on failure |

### Integration Tests: `test/services/telegram/index.test.ts`

Tests the handler registration.

| Test | What it verifies |
|------|-----------------|
| Registers `/remember` command | `bot.command('remember', ...)` called |
| Registers `message:text` handler | `bot.on('message:text', ...)` called |
| Command handler does not receive `/remember` messages | grammy routing ensures this |

### Refactored Tests: `test/services/telegram-commands.test.ts`

**Delete** this file. Its contents move to `remember.test.ts`.

## Order of Implementation

1. Create `src/services/telegram/shared.ts` — extract `isAllowedChat()`, `withTimeout()`, `SESSION_TIMEOUT_MS`
2. Create `src/services/telegram/remember.ts` — extract `/remember` handler using shared helpers
3. Create `src/services/telegram/chat.ts` — new free-form message handler
4. Create `src/services/telegram/index.ts` — register handlers
5. Delete `src/services/telegram-commands.ts`
6. Update `src/app.ts` — change import from `registerTelegramCommands` to `registerHandlers` from new module
7. Move and update tests — `telegram-commands.test.ts` → `telegram/remember.test.ts`, create `telegram/chat.test.ts`, `telegram/shared.test.ts`, `telegram/index.test.ts`
8. Run `npm run test:minimal`
9. Run `npm run typecheck`