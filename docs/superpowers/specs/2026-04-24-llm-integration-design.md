# Phase 3: LLM Integration — Design

**Date:** 2026-04-24  
**Status:** Approved  
**Goal:** Add a `POST /chat` endpoint that accepts a user message and returns an LLM response, using the `@mariozechner/pi-coding-agent` SDK via the OpenCode Go provider.

---

## Context

Barnaby is a Fastify-based personal assistant API with:
- SQLite via better-sqlite3
- Global basic auth via `@fastify/basic-auth`
- Plugin-based architecture (database → repository → routes)
- E2E tests with Fastify `inject()` and vitest

This design targets the simplest possible proof-of-concept: a single route that sends a message to an LLM and returns the text response. No memory context, no tools, no persistence.

---

## Components

### 1. `src/plugins/agent.ts` — Agent Plugin

A Fastify plugin that initializes the SDK's shared infrastructure once at startup.

- Creates `AuthStorage.create()` — reads `OPENCODE_API_KEY` from environment.
- Creates `ModelRegistry.create(authStorage)` — discovers models including the `opencode-go` provider.
- Decorates the Fastify instance with `agent: { authStorage, modelRegistry }`.
- Follows the same pattern as `database.ts` and `repository.ts`.

### 2. `src/routes/chat/index.ts` — Chat Route

Registers a single `POST /chat` route with schema validation.

### 3. `src/routes/chat/schemas.ts` — Request/Response Schemas

JSON Schema for the route:

- **Request body:** `{ message: string }` (required, non-empty)
- **Response:** `{ response: string }`

### 4. `src/routes/chat/handlers.ts` — Chat Handler

Per-request flow:

1. Import `getModel` from `@mariozechner/pi-ai`.
2. Resolve model: `getModel('opencode-go', 'kimi-k2.5')`.
3. Create an ephemeral session:
   ```ts
   const { session } = await createAgentSession({
     model,
     authStorage: request.server.agent.authStorage,
     modelRegistry: request.server.agent.modelRegistry,
     sessionManager: SessionManager.inMemory(),
   });
   ```
4. Call `await session.prompt(request.body.message)`.
5. Extract the final text response from the session result.
6. Return `{ response: text }`.

### 5. `src/types/fastify.d.ts` — TypeScript Augmentation

Update `FastifyInstance` to include the `agent` decoration so routes can access it type-safely.

### 6. `src/app.ts` — App Registration

Register `agentPlugin` alongside existing plugins (`errorHandlerPlugin`, `databasePlugin`, `repositoryPlugin`).

---

## Data Flow

```
POST /chat { message: "hello" }
  → schema validation (400 if invalid)
  → basic auth (401 if missing/wrong)
  → handler:
      getModel('opencode-go', 'kimi-k2.5')
      createAgentSession({ model, authStorage, modelRegistry, inMemory })
      session.prompt("hello")
      extract text from result
  → { response: "..." }
```

---

## Auth & Provider Configuration

- **Environment variable:** `OPENCODE_API_KEY` (added to `.env`, gitignored).
- `AuthStorage.create()` picks up the key automatically from the environment.
- `ModelRegistry` discovers the `opencode-go` provider and its models (including `kimi-k2.5`).
- No manual `baseUrl` or custom provider registration is needed — pi-mono natively supports OpenCode Go.

---

## Error Handling

- **Validation errors** (`message` missing/empty) → 400 (handled by Fastify schema validation).
- **Auth failures** → 401 (handled by existing global `basicAuth` hook).
- **LLM/SDK errors** (bad key, rate limit, provider unavailable) → bubble to existing `errorHandlerPlugin` → 500 with message.

---

## Testing

- One e2e test using Fastify `inject()` for `POST /chat`.
- Mock `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` so tests run without real API keys.
- Assert 200 status and response shape `{ response: string }`.

---

## API Contract

| Method | Path   | Body                    | Response                |
|--------|--------|-------------------------|-------------------------|
| POST   | /chat  | `{ "message": string }` | `{ "response": string }` |

---

## Scope Boundaries

### In Scope
- `POST /chat` route with simple message/response
- SDK integration via shared plugin
- Type-safe decoration
- Basic e2e test with mocks

### Out of Scope (future work)
- Passing memory context to the LLM
- Tool use / agent capabilities
- Session persistence
- Streaming responses
- Non-chat LLM use cases
