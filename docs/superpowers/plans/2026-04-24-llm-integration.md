# Phase 3: LLM Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `POST /chat` endpoint that accepts a user message and returns an LLM response using the `@mariozechner/pi-coding-agent` SDK via the OpenCode Go provider.

**Architecture:** A Fastify plugin initializes the SDK's `AuthStorage` and `ModelRegistry` once at startup. The `POST /chat` handler creates an ephemeral in-memory session per request, streams the response via `session.prompt()`, and returns the concatenated text.

**Tech Stack:** Node.js 24, TypeScript, Fastify, vitest, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/plugins/agent.ts` | Fastify plugin — initializes `AuthStorage` and `ModelRegistry`, decorates app |
| `src/types/fastify.d.ts` | TypeScript augmentation — adds `agent` property to `FastifyInstance` |
| `src/routes/chat/schemas.ts` | JSON Schema for `POST /chat` request/response validation |
| `src/routes/chat/handlers.ts` | Handler — creates session, calls `session.prompt()`, extracts text response |
| `src/routes/chat/index.ts` | Route registration — wires `POST /chat` with schema and handler |
| `src/app.ts` | Registers `agentPlugin` and `chatRoutes` |
| `test/routes/chat.test.ts` | E2E test with mocked SDK — asserts auth, validation, and response shape |

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install pi-coding-agent and pi-ai**

```bash
npm install --save-exact @mariozechner/pi-coding-agent @mariozechner/pi-ai
```

- [ ] **Step 2: Verify installation**

Run:
```bash
ls node_modules/@mariozechner/pi-coding-agent/dist && ls node_modules/@mariozechner/pi-ai/dist
```

Expected: Both directories exist with `.d.ts` and `.js` files.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
npm run test
```

Expected: Tests still pass (no code changes yet).

```bash
git commit -m "deps: add pi-coding-agent and pi-ai"
```

---

### Task 2: Create Agent Plugin

**Files:**
- Create: `src/plugins/agent.ts`

- [ ] **Step 1: Write the agent plugin**

Create `src/plugins/agent.ts`:

```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry } from '@mariozechner/pi-coding-agent';

export type AgentServices = {
  authStorage: ReturnType<typeof AuthStorage.create>;
  modelRegistry: ReturnType<typeof ModelRegistry.create>;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  fastify.decorate('agent', { authStorage, modelRegistry });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/agent.ts
```

No tests to run yet (plugin not wired up).

```bash
git commit -m "feat: add agent plugin for LLM SDK infrastructure"
```

---

### Task 3: Update Fastify Type Augmentation

**Files:**
- Modify: `src/types/fastify.d.ts`

- [ ] **Step 1: Add agent type to FastifyInstance**

Modify `src/types/fastify.d.ts`:

```ts
import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';
import type { AgentServices } from '../plugins/agent.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
    agent: AgentServices;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors (agent plugin exists and exports `AgentServices`).

- [ ] **Step 3: Commit**

```bash
git add src/types/fastify.d.ts
git commit -m "types: add agent decoration to FastifyInstance"
```

---

### Task 4: Create Chat Schemas

**Files:**
- Create: `src/routes/chat/schemas.ts`

- [ ] **Step 1: Write chat request/response schemas**

Create `src/routes/chat/schemas.ts`:

```ts
export const chatSchema = {
  body: {
    type: 'object',
    properties: {
      message: { type: 'string', minLength: 1 },
    },
    required: ['message'],
  },
  response: {
    200: {
      type: 'object',
      properties: {
        response: { type: 'string' },
      },
      required: ['response'],
    },
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/chat/schemas.ts
git commit -m "feat: add chat route JSON schemas"
```

---

### Task 5: Create Chat Handler

**Files:**
- Create: `src/routes/chat/handlers.ts`

- [ ] **Step 1: Write the chat handler**

Create `src/routes/chat/handlers.ts`:

```ts
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
  });

  const textParts: string[] = [];

  session.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      textParts.push(event.assistantMessageEvent.delta);
    }
  });

  await session.prompt(request.body.message);

  const responseText = textParts.join('');
  return { response: responseText };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/chat/handlers.ts
git commit -m "feat: add chat handler with LLM session creation"
```

---

### Task 6: Create Chat Route Index

**Files:**
- Create: `src/routes/chat/index.ts`

- [ ] **Step 1: Write the route registration**

Create `src/routes/chat/index.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { chatSchema } from './schemas.js';
import { chatHandler } from './handlers.js';

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/', { schema: chatSchema }, chatHandler);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/chat/index.ts
git commit -m "feat: register POST /chat route"
```

---

### Task 7: Register Agent Plugin and Chat Route in App

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Import and register agent plugin and chat routes**

Modify `src/app.ts` — add two imports and two registrations:

```ts
import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';
import helmet from '@fastify/helmet';
import fStatic from '@fastify/static';
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import agentPlugin from './plugins/agent.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';
import chatRoutes from './routes/chat/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(fStatic, {
    root: new URL('../public', import.meta.url).pathname,
    prefix: '/',
  });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);
  await app.register(agentPlugin);

  await app.register(view, {
    engine: { handlebars },
    root: new URL('./templates', import.meta.url).pathname,
    layout: 'layout.hbs',
    viewExt: 'hbs',
    propertyName: 'view',
  });

  await app.register(basicAuth, {
    validate: async (username, password) => {
      const expectedUser = process.env.BASIC_AUTH_USERNAME;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'barnaby' },
  });

  app.addHook('onRequest', app.basicAuth);

  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);
  await app.register(chatRoutes, { prefix: '/chat' });

  return app;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: register agent plugin and chat routes in app"
```

---

### Task 8: Write E2E Test for Chat Route

**Files:**
- Create: `test/routes/chat.test.ts`

- [ ] **Step 1: Write the test file with mocked SDK**

Create `test/routes/chat.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';

// Mock the pi SDK packages so tests don't need real API keys
vi.mock('@mariozechner/pi-coding-agent', async () => {
  return {
    AuthStorage: {
      create: vi.fn(() => ({})),
    },
    ModelRegistry: {
      create: vi.fn(() => ({})),
    },
    createAgentSession: vi.fn(async () => ({
      session: {
        subscribe: vi.fn(),
        prompt: vi.fn(async () => {}),
      },
    })),
    SessionManager: {
      inMemory: vi.fn(() => ({})),
    },
  };
});

vi.mock('@mariozechner/pi-ai', async () => {
  return {
    getModel: vi.fn(() => ({
      id: 'kimi-k2.5',
      provider: 'opencode-go',
    })),
  };
});

describe('Chat API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject invalid credentials', async () => {
    const badAuth = 'Basic ' + Buffer.from('wrong:wrong').toString('base64');
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: badAuth },
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject missing message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('should reject empty message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return a response for a valid message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('response');
    expect(typeof body.response).toBe('string');
  });
});
```

- [ ] **Step 2: Run the chat tests**

Run:
```bash
npx vitest run test/routes/chat.test.ts
```

Expected: All 5 tests pass.

- [ ] **Step 3: Run the full test suite**

Run:
```bash
npm run test
```

Expected: All existing tests still pass, plus the 5 new chat tests.

- [ ] **Step 4: Commit**

```bash
git add test/routes/chat.test.ts
git commit -m "test: add e2e tests for chat route with mocked SDK"
```

---

### Task 9: Manual Verification (Optional but Recommended)

**Files:** None

- [ ] **Step 1: Create a local `.env` with your OpenCode API key**

Ensure your `.env` file contains:
```
BASIC_AUTH_USERNAME=your_username
BASIC_AUTH_PASSWORD=your_password
OPENCODE_API_KEY=your_opencode_api_key
```

- [ ] **Step 2: Start the server**

```bash
npm run start
```

- [ ] **Step 3: Test the endpoint with curl**

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'your_username:your_password' | base64)" \
  -d '{"message": "Say hello in one word"}'
```

Expected: JSON response like `{"response":"Hello"}` (actual text depends on the model).

- [ ] **Step 4: Stop the server**

`Ctrl+C` in the terminal running the server.

---

## Spec Coverage Check

| Spec Requirement | Plan Task |
|-----------------|-----------|
| `src/plugins/agent.ts` initializes `AuthStorage` + `ModelRegistry` | Task 2 |
| Type augmentation for `agent` decoration | Task 3 |
| `POST /chat` route with schema validation | Tasks 4, 5, 6, 7 |
| Handler creates ephemeral in-memory session | Task 5 |
| Handler calls `session.prompt()` and returns text | Task 5 |
| Route registered in `app.ts` | Task 7 |
| E2E test with mocked SDK | Task 8 |
| Auth protected by existing `basicAuth` | Covered by tests in Task 8 |
| Error handling bubbles to `errorHandlerPlugin` | Tests assert 400/401 in Task 8 |

---

## Placeholder Scan

- No "TBD", "TODO", "implement later", or "fill in details" found.
- No vague instructions like "add appropriate error handling."
- No "similar to Task N" references.
- Every step has exact file paths, code, commands, and expected output.

---

## Type Consistency Check

- `AgentServices` type defined in `src/plugins/agent.ts`, imported in `src/types/fastify.d.ts`.
- `ChatBody` type defined in `src/routes/chat/handlers.ts`.
- `chatSchema` exported from `src/routes/chat/schemas.ts`, imported in `src/routes/chat/index.ts`.
- `chatHandler` exported from `src/routes/chat/handlers.ts`, imported in `src/routes/chat/index.ts`.
- `chatRoutes` imported in `src/app.ts`.
- Mock types in tests match the real SDK shapes (`createAgentSession`, `getModel`, `SessionManager.inMemory`).

All type references are consistent across tasks.
