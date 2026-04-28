# Google Calendar Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Calendar read/create/edit access to Barnaby via `POST /calendar/events`, using the pi-coding-agent SDK with three custom calendar tools, OAuth 2.0 refresh-token auth, and e2e tests.

**Architecture:** A Fastify plugin stack (`googleAuthPlugin` → `calendarClientPlugin` → `agentPlugin`) where the agent plugin registers three custom tools (`calendar_list`, `calendar_create`, `calendar_edit`) that close over the calendar API client. A dedicated route creates an agent session with tools enabled, passes natural language + calendar context, and returns the agent's result.

**Tech Stack:** Fastify, `@mariozechner/pi-coding-agent`, `googleapis`, `google-auth-library`, `typebox`, vitest

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/plugins/google-auth.ts` | Initializes `OAuth2Client` from env vars; decorates `fastify.googleAuth` |
| `src/plugins/calendar-client.ts` | Thin wrapper over Google Calendar API v3 (`events.list`, `insert`, `patch`) |
| `src/plugins/agent.ts` | Existing plugin extended with `extensionFactories` registering three calendar tools |
| `src/routes/calendar/schemas.ts` | JSON Schema for `POST /calendar/events` |
| `src/routes/calendar/handlers.ts` | Handler: build prompt with calendar context, create agent session, return result |
| `src/routes/calendar/index.ts` | Route registration |
| `src/app.ts` | Register new plugins and routes in dependency order |
| `src/types/fastify.d.ts` | TypeScript augmentation for `googleAuth` and `calendarClient` decorations |
| `scripts/get-google-refresh-token.ts` | Standalone OAuth flow script |
| `test/plugins/google-auth.test.ts` | Plugin tests for credential handling |
| `test/plugins/calendar-client.test.ts` | Plugin tests with mocked `googleapis` |
| `test/routes/calendar.test.ts` | E2E route tests with mocked SDK |
| `test/helper.ts` | Updated to set dummy Google credentials for `buildTestApp` |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install googleapis, google-auth-library, and typebox**

Run:
```bash
npm install --save-exact googleapis google-auth-library typebox
```

Expected: `package.json` updated with exact versions.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
npm install --package-lock-only
git add package-lock.json
git commit -m "chore(deps): add googleapis, google-auth-library, typebox"
```

---

## Task 2: Create Google Auth Plugin

**Files:**
- Create: `src/plugins/google-auth.ts`
- Create: `test/plugins/google-auth.test.ts`

- [ ] **Step 1: Write the plugin**

Create `src/plugins/google-auth.ts`:
```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';

export type GoogleAuth = {
  oauth2Client: OAuth2Client;
};

export default fp(async function googleAuthPlugin(fastify: FastifyInstance) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google OAuth credentials. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in your .env file.'
    );
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  fastify.decorate('googleAuth', { oauth2Client });
});
```

- [ ] **Step 2: Write the failing test**

Create `test/plugins/google-auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import googleAuthPlugin from '../../src/plugins/google-auth.js';

describe('google-auth plugin', () => {
  it('should decorate fastify with googleAuth when credentials are present', async () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';

    try {
      const app = Fastify({ logger: false });
      await app.register(googleAuthPlugin);
      await app.ready();

      expect(app.hasDecorator('googleAuth')).toBe(true);
      expect(app.googleAuth.oauth2Client).toBeDefined();

      await app.close();
    } finally {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
      process.env.GOOGLE_REFRESH_TOKEN = originalRefreshToken;
    }
  });

  it('should throw when credentials are missing', async () => {
    const originalClientId = process.env.GOOGLE_CLIENT_ID;
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const originalRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    try {
      const app = Fastify({ logger: false });
      await expect(app.register(googleAuthPlugin)).rejects.toThrow('Missing Google OAuth credentials');
    } finally {
      process.env.GOOGLE_CLIENT_ID = originalClientId;
      process.env.GOOGLE_CLIENT_SECRET = originalClientSecret;
      process.env.GOOGLE_REFRESH_TOKEN = originalRefreshToken;
    }
  });
});
```

- [ ] **Step 3: Run tests to verify behavior**

Run:
```bash
npx vitest run test/plugins/google-auth.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/google-auth.ts test/plugins/google-auth.test.ts
git commit -m "feat(google-auth): add google oauth plugin with env-based credentials"
```

---

## Task 3: Update Test Helper

**Files:**
- Modify: `test/helper.ts`

- [ ] **Step 1: Add dummy Google credentials to buildTestApp**

Modify `test/helper.ts`:
```ts
import { buildApp } from '../src/app.js';

export async function buildTestApp() {
  process.env.DATABASE_PATH = ':memory:';
  process.env.BASIC_AUTH_USERNAME = 'test';
  process.env.BASIC_AUTH_PASSWORD = 'test';
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';

  const app = await buildApp();
  return app;
}
```

- [ ] **Step 2: Run existing tests to ensure no regressions**

Run:
```bash
npx vitest run
```

Expected: All existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add test/helper.ts
git commit -m "test(helper): add dummy google credentials for test app"
```

---

## Task 4: Create Calendar Client Plugin

**Files:**
- Create: `src/plugins/calendar-client.ts`
- Create: `test/plugins/calendar-client.test.ts`

- [ ] **Step 1: Write the plugin**

Create `src/plugins/calendar-client.ts`:
```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';

export type CalendarEvent = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
};

export type CalendarClient = {
  listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]>;
  createEvent(calendarId: string, event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent>;
  updateEvent(calendarId: string, eventId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
};

export default fp(async function calendarClientPlugin(fastify: FastifyInstance) {
  const auth = fastify.googleAuth.oauth2Client;
  const calendar = google.calendar({ version: 'v3', auth });

  const client: CalendarClient = {
    async listEvents(calendarId, timeMin, timeMax) {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items || []) as CalendarEvent[];
    },

    async createEvent(calendarId, event) {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      return res.data as CalendarEvent;
    },

    async updateEvent(calendarId, eventId, event) {
      const res = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: event,
      });
      return res.data as CalendarEvent;
    },
  };

  fastify.decorate('calendarClient', client);
});
```

- [ ] **Step 2: Write the failing test**

Create `test/plugins/calendar-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import googleAuthPlugin from '../../src/plugins/google-auth.js';
import calendarClientPlugin from '../../src/plugins/calendar-client.js';

const mockList = vi.fn();
const mockInsert = vi.fn();
const mockPatch = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: mockList,
        insert: mockInsert,
        patch: mockPatch,
      },
    })),
  },
}));

describe('calendar-client plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(googleAuthPlugin);
    await app.register(calendarClientPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockList.mockReset();
    mockInsert.mockReset();
    mockPatch.mockReset();
  });

  it('should decorate fastify with calendarClient', () => {
    expect(app.hasDecorator('calendarClient')).toBe(true);
  });

  it('should list events via the Google Calendar API', async () => {
    mockList.mockResolvedValueOnce({
      data: { items: [{ id: '1', summary: 'Test Event' }] },
    });

    const events = await app.calendarClient.listEvents('primary', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    expect(events).toEqual([{ id: '1', summary: 'Test Event' }]);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: '2026-01-01T00:00:00Z',
        timeMax: '2026-01-02T00:00:00Z',
        singleEvents: true,
        orderBy: 'startTime',
      })
    );
  });

  it('should create an event via the Google Calendar API', async () => {
    mockInsert.mockResolvedValueOnce({
      data: { id: '2', summary: 'New Event' },
    });

    const event = await app.calendarClient.createEvent('primary', {
      summary: 'New Event',
      start: { dateTime: '2026-01-01T10:00:00Z' },
      end: { dateTime: '2026-01-01T11:00:00Z' },
    });
    expect(event).toEqual({ id: '2', summary: 'New Event' });
  });

  it('should update an event via the Google Calendar API', async () => {
    mockPatch.mockResolvedValueOnce({
      data: { id: '3', summary: 'Updated Event' },
    });

    const event = await app.calendarClient.updateEvent('primary', '3', { summary: 'Updated Event' });
    expect(event).toEqual({ id: '3', summary: 'Updated Event' });
  });
});
```

- [ ] **Step 3: Run tests**

Run:
```bash
npx vitest run test/plugins/calendar-client.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/calendar-client.ts test/plugins/calendar-client.test.ts
git commit -m "feat(calendar): add google calendar client plugin"
```

---

## Task 5: Update Agent Plugin with Calendar Tools

**Files:**
- Modify: `src/plugins/agent.ts`

- [ ] **Step 1: Add extensionFactories with three calendar tools**

Replace `src/plugins/agent.ts` with:
```ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import { Type } from 'typebox';

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<any>;
  resourceLoader: DefaultResourceLoader;
};

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel('opencode-go', 'minimax-m2.7');

  const calendarExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'calendar_list',
      label: 'List Calendar Events',
      description: 'List events from a Google Calendar within a date range',
      parameters: Type.Object({
        calendarId: Type.String({ description: 'Calendar ID or "primary"' }),
        start: Type.String({ description: 'Start date/time in ISO 8601 format' }),
        end: Type.String({ description: 'End date/time in ISO 8601 format' }),
      }),
      async execute(_toolCallId, params) {
        const events = await fastify.calendarClient.listEvents(params.calendarId, params.start, params.end);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(events) }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: 'calendar_create',
      label: 'Create Calendar Event',
      description: 'Create a new event on a Google Calendar',
      parameters: Type.Object({
        calendarId: Type.String(),
        summary: Type.String({ description: 'Event title' }),
        start: Type.String({ description: 'Start date/time in ISO 8601 format' }),
        end: Type.String({ description: 'End date/time in ISO 8601 format' }),
        description: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const event = await fastify.calendarClient.createEvent(params.calendarId, {
          summary: params.summary,
          start: { dateTime: params.start },
          end: { dateTime: params.end },
          description: params.description,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(event) }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: 'calendar_edit',
      label: 'Edit Calendar Event',
      description: 'Update an existing event on a Google Calendar',
      parameters: Type.Object({
        calendarId: Type.String(),
        eventId: Type.String(),
        summary: Type.Optional(Type.String()),
        start: Type.Optional(Type.String({ description: 'Start date/time in ISO 8601 format' })),
        end: Type.Optional(Type.String({ description: 'End date/time in ISO 8601 format' })),
        description: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const updates: Record<string, unknown> = {};
        if (params.summary !== undefined) updates.summary = params.summary;
        if (params.start !== undefined) updates.start = { dateTime: params.start };
        if (params.end !== undefined) updates.end = { dateTime: params.end };
        if (params.description !== undefined) updates.description = params.description;

        const event = await fastify.calendarClient.updateEvent(params.calendarId, params.eventId, updates);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(event) }],
          details: {},
        };
      },
    });
  };

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: '/dev/null',
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [calendarExtensionFactory],
    systemPrompt:
      'You are a helpful assistant for casual conversation and general questions. ' +
      'Answer clearly, concisely, and in plain language. ' +
      'Do not write or explain code unless the user explicitly asks for it.',
  });
  await resourceLoader.reload();

  fastify.decorate('agent', { authStorage, modelRegistry, model, resourceLoader });
});
```

- [ ] **Step 2: Run existing tests to ensure no regressions**

Run:
```bash
npx vitest run test/routes/chat.test.ts
```

Expected: Chat tests pass (the mock for `DefaultResourceLoader` should still work).

- [ ] **Step 3: Commit**

```bash
git add src/plugins/agent.ts
git commit -m "feat(agent): register calendar_list, calendar_create, calendar_edit tools"
```

---

## Task 6: Create Calendar Route

**Files:**
- Create: `src/routes/calendar/schemas.ts`
- Create: `src/routes/calendar/handlers.ts`
- Create: `src/routes/calendar/index.ts`

- [ ] **Step 1: Write schemas**

Create `src/routes/calendar/schemas.ts`:
```ts
export const calendarSchema = {
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
        result: { type: 'string' },
      },
      required: ['result'],
    },
  },
};
```

- [ ] **Step 2: Write handler**

Create `src/routes/calendar/handlers.ts`:
```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

export type CalendarBody = {
  message: string;
};

function getCalendarList(): Array<{ id: string; name: string }> {
  try {
    return JSON.parse(process.env.CALENDAR_LIST || '[{"id":"primary","name":"Primary"}]');
  } catch {
    return [{ id: 'primary', name: 'Primary' }];
  }
}

export async function calendarHandler(
  request: FastifyRequest<{ Body: CalendarBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;
  const calendars = getCalendarList();

  const calendarContext = calendars
    .map((c) => `- ${c.name} (ID: ${c.id})`)
    .join('\n');

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  try {
    const prompt = [
      'You have access to Google Calendar tools.',
      `Available calendars:\n${calendarContext}`,
      'Use ISO 8601 format for all dates and times.',
      '',
      request.body.message,
    ].join('\n');

    await session.prompt(prompt);
    const responseText = session.getLastAssistantText() ?? '';
    return { result: responseText };
  } finally {
    session.dispose();
  }
}
```

- [ ] **Step 3: Write route registration**

Create `src/routes/calendar/index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { calendarSchema } from './schemas.js';
import { calendarHandler } from './handlers.js';

export default async function calendarRoutes(fastify: FastifyInstance) {
  fastify.post('/events', { schema: calendarSchema }, calendarHandler);
}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/calendar/
git commit -m "feat(calendar): add POST /calendar/events route with natural language handler"
```

---

## Task 7: Register New Plugins and Routes in App

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add imports and registrations**

Modify `src/app.ts`:
```ts
import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';
import helmet from "@fastify/helmet";
import fStatic from "@fastify/static";
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import googleAuthPlugin from './plugins/google-auth.js';
import calendarClientPlugin from './plugins/calendar-client.js';
import agentPlugin from './plugins/agent.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';
import chatRoutes from './routes/chat/index.js';
import calendarRoutes from './routes/calendar/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(helmet);
  await app.register(fStatic, {
    root: new URL("../public", import.meta.url).pathname,
    prefix: "/"
  });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);
  await app.register(googleAuthPlugin);
  await app.register(calendarClientPlugin);
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
  await app.register(calendarRoutes, { prefix: '/calendar' });

  return app;
}
```

- [ ] **Step 2: Run tests to verify integration**

Run:
```bash
npx vitest run
```

Expected: All tests pass (existing + new plugin tests).

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat(app): register google auth, calendar client, and calendar routes"
```

---

## Task 8: Update TypeScript Augmentation

**Files:**
- Modify: `src/types/fastify.d.ts`

- [ ] **Step 1: Add type declarations**

Replace `src/types/fastify.d.ts`:
```ts
import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';
import type { AgentServices } from '../plugins/agent.js';
import type { OAuth2Client } from 'google-auth-library';
import type { CalendarClient } from '../plugins/calendar-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
    agent: AgentServices;
    googleAuth: { oauth2Client: OAuth2Client };
    calendarClient: CalendarClient;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/fastify.d.ts
git commit -m "types(fastify): add googleAuth and calendarClient decorations"
```

---

## Task 9: Create E2E Route Tests

**Files:**
- Create: `test/routes/calendar.test.ts`

- [ ] **Step 1: Write the route test**

Create `test/routes/calendar.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async () => {}),
  getLastAssistantText: vi.fn(() => 'Created event "Dinner" on the family calendar.'),
  dispose: vi.fn(),
};

vi.mock('@mariozechner/pi-coding-agent', async () => {
  const actual = await vi.importActual<typeof import('@mariozechner/pi-coding-agent')>('@mariozechner/pi-coding-agent');
  return {
    ...actual,
    createAgentSession: vi.fn(async () => ({
      session: mockSession,
    })),
    SessionManager: {
      inMemory: vi.fn(() => ({})),
    },
  };
});

describe('Calendar API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    process.env.CALENDAR_LIST = JSON.stringify([
      { id: 'primary', name: 'Primary' },
      { id: 'family@group.calendar.google.com', name: 'Family' },
    ]);
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockSession.prompt.mockClear();
    mockSession.getLastAssistantText.mockClear();
    mockSession.dispose.mockClear();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { message: 'list my events' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject missing message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return a result for a valid message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'create an event on the family calendar for May 15' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('result');
    expect(typeof body.result).toBe('string');
    expect(body.result).toBe('Created event "Dinner" on the family calendar.');
  });

  it('should create an agent session without noTools', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        noTools: 'all',
      })
    );
  });

  it('should include calendar context in the prompt', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'what is on my calendar today' },
    });

    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Available calendars:')
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Family (ID: family@group.calendar.google.com)')
    );
  });

  it('should dispose the session after use', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(mockSession.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npx vitest run test/routes/calendar.test.ts
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/routes/calendar.test.ts
git commit -m "test(calendar): add e2e tests for POST /calendar/events"
```

---

## Task 10: Create One-Time Auth Script

**Files:**
- Create: `scripts/get-google-refresh-token.ts`

- [ ] **Step 1: Write the script**

Create `scripts/get-google-refresh-token.ts`:
```ts
import { google } from 'googleapis';
import http from 'http';
import { URL } from 'url';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/calendar'],
});

console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for authorization...');

const server = http.createServer(async (req, res) => {
  if (!req.url?.startsWith('/oauth2callback')) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost:3000');
  const code = url.searchParams.get('code');

  if (!code) {
    const error = url.searchParams.get('error');
    console.error('Authorization failed:', error);
    res.writeHead(400);
    res.end('Authorization failed. Check your terminal.');
    server.close();
    process.exit(1);
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Authorization successful!');
    console.log('\nAdd this to your .env file:');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    res.writeHead(200);
    res.end('Authorization successful! You can close this tab.');
  } catch (err) {
    console.error('Failed to exchange code for tokens:', err);
    res.writeHead(500);
    res.end('Failed to exchange code. Check your terminal.');
  } finally {
    server.close();
    process.exit(0);
  }
});

server.listen(3000, () => {
  console.log('Local server listening on http://localhost:3000');
});
```

- [ ] **Step 2: Verify script syntax**

Run:
```bash
npx tsc --noEmit scripts/get-google-refresh-token.ts
```

Expected: No errors (may need to adjust tsconfig if it excludes scripts; if so, just check by inspection).

- [ ] **Step 3: Commit**

```bash
git add scripts/get-google-refresh-token.ts
git commit -m "feat(scripts): add one-time google oauth refresh token helper"
```

---

## Task 10b: Create Calendar List Verification Script

**Files:**
- Create: `scripts/list-calendars.sh`

- [ ] **Step 1: Write the script**

Create `scripts/list-calendars.sh`:
```bash
#!/bin/bash
# List available Google Calendars to verify auth and get calendar IDs.
# Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN env vars.

set -euo pipefail

if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ] || [ -z "${GOOGLE_REFRESH_TOKEN:-}" ]; then
  echo "Error: Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN"
  exit 1
fi

# Exchange refresh token for access token
TOKEN_RESPONSE=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GOOGLE_CLIENT_ID" \
  -d "client_secret=$GOOGLE_CLIENT_SECRET" \
  -d "refresh_token=$GOOGLE_REFRESH_TOKEN" \
  -d "grant_type=refresh_token")

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")

if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to get access token:"
  echo "$TOKEN_RESPONSE"
  exit 1
fi

echo "Access token obtained. Fetching calendar list..."
echo ""

# List calendars
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://www.googleapis.com/calendar/v3/users/me/calendarList" | \
  python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', [])
if not items:
    print('No calendars found.')
for cal in items:
    print(f\"ID:   {cal.get('id')}\")
    print(f\"Name: {cal.get('summary')}\")
    print(f\"Access: {cal.get('accessRole')}\")
    print('-' * 40)
"
```

- [ ] **Step 2: Make executable**

Run:
```bash
chmod +x scripts/list-calendars.sh
```

- [ ] **Step 3: Commit**

```bash
git add scripts/list-calendars.sh
git commit -m "feat(scripts): add calendar list verification script"
```

---

## Task 11: Final Integration Verification

- [ ] **Step 1: Run full test suite**

Run:
```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Verify TypeScript compiles**

Run:
```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Commit if clean**

If no uncommitted changes, the suite is green. If there are fixups, stage and commit:
```bash
git add ...
git commit -m "fix: address review feedback / integration issues"
```

---

## Spec Coverage Check

| Spec Section | Implementing Task |
|-------------|-------------------|
| Google Auth Setup (one-time OAuth) | Task 10 (script), Task 2 (plugin) |
| Runtime Auth (refresh token) | Task 2 (plugin) |
| `src/plugins/google-auth.ts` | Task 2 |
| `src/plugins/calendar-client.ts` | Task 4 |
| `src/plugins/agent.ts` (extension factories) | Task 5 |
| Three custom tools (list/create/edit) | Task 5 |
| No delete tool | Task 5 (simply not registered) |
| `src/routes/calendar/*` | Task 6 |
| `src/types/fastify.d.ts` | Task 8 |
| `src/app.ts` registration | Task 7 |
| `scripts/get-google-refresh-token.ts` | Task 10 |
| E2E tests | Task 2, 4, 9 |
| Environment variables | Documented in spec; used in Tasks 2, 6 |

---

## Placeholder Scan

- No `TBD`, `TODO`, or `implement later` found.
- All steps contain exact file paths and code.
- All test steps include exact commands and expected outputs.
- No vague descriptions like "add appropriate error handling."

---

## Type Consistency Check

- `CalendarEvent` type defined in `calendar-client.ts` and used consistently.
- `CalendarClient` interface matches the three methods: `listEvents`, `createEvent`, `updateEvent`.
- `AgentServices` type unchanged (still `{ authStorage, modelRegistry, model, resourceLoader }`).
- `FastifyInstance` augmentation adds `googleAuth` and `calendarClient` with correct types.
- Tool parameter types use `Type.Object` from `typebox` consistently.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-google-calendar-integration.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach would you like?
