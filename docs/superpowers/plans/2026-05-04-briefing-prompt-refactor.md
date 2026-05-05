# Briefing Prompt Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the daily briefing prompt for modern LLM effectiveness, add briefing history tracking with a new database table, and expose a manual trigger endpoint.

**Architecture:** A new `briefings` SQLite table stores every generated briefing with content, timestamp, and trigger type (`scheduled` | `manual`). A focused `BriefingRepository` handles CRUD. The `BriefingService` fetches the previous briefing to inject as context, uses a structured system prompt with a one-shot example, and saves the result. A new HTTP route allows on-demand manual briefings.

**Tech Stack:** Fastify, better-sqlite3, TypeScript, Vitest, @mariozechner/pi-coding-agent

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/plugins/database.ts` | Modify | Add `briefings` table creation |
| `src/plugins/briefing-repository.ts` | Create | CRUD for briefing history |
| `src/services/briefing.ts` | Modify | Rewrite prompts, integrate repository, support `triggerType` |
| `src/routes/briefing/index.ts` | Create | Route registration for manual trigger |
| `src/routes/briefing/handlers.ts` | Create | POST handler that invokes `BriefingService` with `triggerType: 'manual'` |
| `src/routes/briefing/schemas.ts` | Create | Fastify JSON schema for response validation |
| `src/types/fastify.d.ts` | Modify | Add `briefingRepository` to `FastifyInstance` |
| `src/app.ts` | Modify | Register briefing repository plugin and briefing route |
| `test/plugins/database.test.ts` | Modify | Assert `briefings` table exists with correct columns |
| `test/plugins/briefing-repository.test.ts` | Create | Unit tests for `create`, `findLatest`, `findAll` |
| `test/services/briefing.test.ts` | Modify | Update mocks, assert new prompt content, repository calls, manual trigger |
| `test/routes/briefing.test.ts` | Create | E2E tests for manual trigger endpoint |

---

### Task 1: Add `briefings` table to database plugin

**Files:**
- Modify: `src/plugins/database.ts`
- Test: `test/plugins/database.test.ts`

- [ ] **Step 1: Write the failing test**

Open `test/plugins/database.test.ts` and append a new test case inside the `describe('database plugin')` block:

```typescript
  it('should have briefings table with correct columns', () => {
    const columns = app.db.pragma('table_info(briefings)') as Array<ColumnInfo>;
    const names = columns.map((c) => c.name);

    expect(names).toContain('id');
    expect(names).toContain('content');
    expect(names).toContain('triggered_at');
    expect(names).toContain('trigger_type');

    const triggerType = columns.find((c) => c.name === 'trigger_type');
    expect(triggerType).toBeDefined();
    expect(triggerType!.type).toBe('TEXT');
    expect(triggerType!.notnull).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/database.test.ts --reporter=verbose`

Expected: FAIL with `Error: no such table: briefings`

- [ ] **Step 3: Add briefings table to database plugin**

Open `src/plugins/database.ts`. After the `memory_tags` table creation (line 37) and before the `// Migration: add permanent column` comment (line 40), insert:

```typescript
    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual'))
    );
```

The full block should read:

```typescript
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('appointment', 'note', 'todo', 'purchase')),
      permanent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (memory_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual'))
    );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/database.test.ts --reporter=verbose`

Expected: PASS for all tests including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/database.ts test/plugins/database.test.ts
git commit -m "feat: add briefings table to database"
```

---

### Task 2: Create briefing repository

**Files:**
- Create: `src/plugins/briefing-repository.ts`
- Test: `test/plugins/briefing-repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/plugins/briefing-repository.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import { createBriefingRepository } from '../../src/plugins/briefing-repository.js';

describe('briefing repository', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let repo: ReturnType<typeof createBriefingRepository>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.ready();
    repo = createBriefingRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.db.exec('DELETE FROM briefings');
  });

  it('should create a briefing and return it', () => {
    const briefing = repo.create({
      content: 'Test briefing content',
      triggerType: 'scheduled',
    });

    expect(briefing.id).toBeDefined();
    expect(briefing.content).toBe('Test briefing content');
    expect(briefing.triggerType).toBe('scheduled');
    expect(briefing.triggeredAt).toBeDefined();
  });

  it('should find the latest briefing', () => {
    repo.create({ content: 'First', triggerType: 'scheduled' });
    repo.create({ content: 'Second', triggerType: 'manual' });

    const latest = repo.findLatest();
    expect(latest).not.toBeNull();
    expect(latest!.content).toBe('Second');
    expect(latest!.triggerType).toBe('manual');
  });

  it('should return null when no briefings exist', () => {
    const latest = repo.findLatest();
    expect(latest).toBeNull();
  });

  it('should find all briefings ordered by triggered_at DESC', () => {
    repo.create({ content: 'First', triggerType: 'scheduled' });
    repo.create({ content: 'Second', triggerType: 'manual' });

    const all = repo.findAll();
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe('Second');
    expect(all[1].content).toBe('First');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/briefing-repository.test.ts --reporter=verbose`

Expected: FAIL with `Error: Cannot find module '../../src/plugins/briefing-repository.js'`

- [ ] **Step 3: Implement briefing repository**

Create `src/plugins/briefing-repository.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export type Briefing = {
  id: string;
  content: string;
  triggeredAt: string; // ISO 8601
  triggerType: 'scheduled' | 'manual';
};

export type CreateBriefingBody = {
  content: string;
  triggerType: 'scheduled' | 'manual';
};

export interface BriefingRepository {
  create(data: CreateBriefingBody): Briefing;
  findLatest(): Briefing | null;
  findAll(): Briefing[];
}

type BriefingRow = {
  id: string;
  content: string;
  triggered_at: number;
  trigger_type: 'scheduled' | 'manual';
};

function rowToBriefing(row: BriefingRow): Briefing {
  return {
    id: row.id,
    content: row.content,
    triggeredAt: new Date(row.triggered_at).toISOString(),
    triggerType: row.trigger_type,
  };
}

export function createBriefingRepository(db: Database): BriefingRepository {
  return {
    create(data) {
      const id = crypto.randomUUID();
      const triggeredAt = Date.now();

      db.prepare(
        'INSERT INTO briefings (id, content, triggered_at, trigger_type) VALUES (?, ?, ?, ?)'
      ).run(id, data.content, triggeredAt, data.triggerType);

      const row = db
        .prepare('SELECT * FROM briefings WHERE id = ?')
        .get(id) as BriefingRow;

      return rowToBriefing(row);
    },

    findLatest() {
      const row = db
        .prepare('SELECT * FROM briefings ORDER BY triggered_at DESC LIMIT 1')
        .get() as BriefingRow | undefined;

      if (!row) return null;
      return rowToBriefing(row);
    },

    findAll() {
      const rows = db
        .prepare('SELECT * FROM briefings ORDER BY triggered_at DESC')
        .all() as BriefingRow[];

      return rows.map((row) => rowToBriefing(row));
    },
  };
}

export default fp(async function briefingRepositoryPlugin(fastify: FastifyInstance) {
  const repo = createBriefingRepository(fastify.db);
  fastify.decorate('briefingRepository', repo);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/briefing-repository.test.ts --reporter=verbose`

Expected: PASS for all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/briefing-repository.ts test/plugins/briefing-repository.test.ts
git commit -m "feat: add briefing repository with create, findLatest, findAll"
```

---

### Task 3: Refactor briefing service prompts and integrate repository

**Files:**
- Modify: `src/services/briefing.ts`
- Test: `test/services/briefing.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `test/services/briefing.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createBriefingService, registerBriefingJob } from '../../src/services/briefing.js';

const mockResourceLoader = {
  reload: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
  DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
    return mockResourceLoader;
  }),
}));

import { createAgentSession, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';

function createMockFastify(overrides: Partial<FastifyInstance> = {}): FastifyInstance {
  const mockBriefingRepo = {
    create: vi.fn().mockReturnValue({}),
    findLatest: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue([]),
  };

  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
    },
    telegramClient: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    briefingRepository: mockBriefingRepo,
    scheduler: {
      addCronJob: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  } as unknown as FastifyInstance;
}

describe('briefing service', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.BRIEFING_CRON = '0 7 * * *';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendBriefing', () => {
    it('creates agent session with improved system prompt and sends result to Telegram', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Good morning! You have 2 events today.'),
        dispose: vi.fn(),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const resourceLoaderCall = (DefaultResourceLoader as any).mock.calls[0][0];
      expect(resourceLoaderCall.systemPrompt).toContain('You are Barnaby');
      expect(resourceLoaderCall.systemPrompt).toContain('EXAMPLE');
      expect(resourceLoaderCall.systemPrompt).toContain('Only use information provided by the tools');
      expect(resourceLoaderCall.systemPrompt).toContain('If a tool returns an error');
      expect(resourceLoaderCall.systemPrompt).toContain('Do not use emojis');

      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Today is')
      );
      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('It is currently')
      );

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(
        12345,
        'Good morning! You have 2 events today.'
      );

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Good morning! You have 2 events today.',
        triggerType: 'scheduled',
      });

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('skips when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.warn).toHaveBeenCalledWith('TELEGRAM_CHAT_ID is not set, skipping briefing');
      expect(createAgentSession).not.toHaveBeenCalled();
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('handles agent session failure gracefully', async () => {
      (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.error).toHaveBeenCalled();
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('handles telegram send failure gracefully', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing text'),
        dispose: vi.fn(),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API down')),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.error).toHaveBeenCalled();
    });

    it('includes previous briefing context when one exists', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('New briefing'),
        dispose: vi.fn(),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const previousBriefing = {
        id: 'prev-1',
        content: 'Previous briefing content',
        triggeredAt: new Date(Date.now() - 86400000).toISOString(),
        triggerType: 'scheduled' as const,
      };

      const fastify = createMockFastify({
        briefingRepository: {
          create: vi.fn().mockReturnValue({}),
          findLatest: vi.fn().mockReturnValue(previousBriefing),
          findAll: vi.fn().mockReturnValue([previousBriefing]),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Previous briefing content');
      expect(prompt).toContain('Try not to repeat the same information');
    });

    it('saves manual briefings with correct trigger type', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Manual briefing'),
        dispose: vi.fn(),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing({ triggerType: 'manual' });

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Manual briefing',
        triggerType: 'manual',
      });
    });
  });

  describe('registerBriefingJob', () => {
    it('creates cron job with preventOverrun', () => {
      const fastify = createMockFastify();
      registerBriefingJob(fastify);

      expect(fastify.scheduler.addCronJob).toHaveBeenCalled();
      const job = (fastify.scheduler.addCronJob as any).mock.calls[0][0];
      expect(job.id).toBe('briefing-job');
      expect(job.preventOverrun).toBe(true);
      expect(job.schedule.cronExpression).toBe('0 7 * * *');
    });

    it('warns when BRIEFING_CRON is not set', () => {
      delete process.env.BRIEFING_CRON;
      const fastify = createMockFastify();
      registerBriefingJob(fastify);

      expect(fastify.log.warn).toHaveBeenCalledWith('BRIEFING_CRON is not set, skipping briefing job registration');
      expect(fastify.scheduler.addCronJob).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/services/briefing.test.ts --reporter=verbose`

Expected: FAIL with errors like ` briefingRepository is not defined`, `sendBriefing does not accept arguments`, or prompt assertions failing.

- [ ] **Step 3: Rewrite briefing service**

Replace the entire contents of `src/services/briefing.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import { CronJob, AsyncTask } from 'toad-scheduler';
import createCalendarExtension from '../plugins/agent/extensions/google-calendar.js';

export type BriefingService = {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }): Promise<void>;
};

function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function buildSystemPrompt(): string {
  return (
    'You are Barnaby, a friendly personal assistant who generates daily briefings for your user via Telegram.\n\n' +
    'OUTPUT RULES:\n' +
    '- Start with a brief, warm greeting that references the time of day (morning/afternoon/evening)\n' +
    '- Use 2-3 short paragraphs total, max 150 words\n' +
    '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences\n' +
    '- If no calendar events exist today, do not mention the calendar at all\n' +
    '- If no memories or tasks exist, do not mention them at all\n' +
    '- Never apologize for lack of information; just provide what you have\n' +
    '- If a tool returns an error, mention it briefly in plain English and move on. Do not dwell on technical details.\n' +
    '- Only use information provided by the tools. Do not invent events, memories, or tasks.\n' +
    '- Do not use emojis.\n' +
    '- End with one brief, encouraging closing line\n\n' +
    'TONE: Casual, warm, and efficient. Avoid robotic lists. Write like a helpful friend, not an administrative assistant.\n\n' +
    'EXAMPLE:\n' +
    'Good morning! It is Tuesday, May 6, 2025.\n\n' +
    'You have a busy day ahead. Your team standup is at 10:00 AM, followed by a dentist appointment at 2:30 PM. ' +
    'Also, remember that your passport expires next month — you noted that as something to renew soon.\n\n' +
    'Have a great Tuesday!'
  );
}

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing(options = {}) {
      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        fastify.log.warn('TELEGRAM_CHAT_ID is not set, skipping briefing');
        return;
      }

      const chatId = Number(chatIdEnv);
      const triggerType = options.triggerType ?? 'scheduled';

      try {
        const { authStorage, modelRegistry, model } = fastify.agent;

        const resourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: '/dev/null',
          noContextFiles: true,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          extensionFactories: [
            createCalendarExtension(fastify),
          ],
          systemPrompt: buildSystemPrompt(),
        });
        await resourceLoader.reload();

        const { session } = await createAgentSession({
          model,
          authStorage,
          modelRegistry,
          resourceLoader,
          sessionManager: SessionManager.inMemory(),
        });

        try {
          const now = new Date();
          const today = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          const timeOfDay = getTimeOfDay(now.getHours());

          const previousBriefing = fastify.briefingRepository.findLatest();
          const previousContext = previousBriefing
            ? `\n\nHere is your previous briefing from ${new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US')} for reference. Try not to repeat the same information unless it is still relevant:\n\n${previousBriefing.content}`
            : '';

          const prompt = `Today is ${today}. It is currently ${timeOfDay}.\n\nGenerate the daily briefing.${previousContext}`;

          await session.prompt(prompt);
          const responseText = session.getLastAssistantText() ?? '';

          await fastify.telegramClient.sendMessage(chatId, responseText);

          fastify.briefingRepository.create({
            content: responseText,
            triggerType,
          });
        } finally {
          session.dispose();
        }
      } catch (error) {
        fastify.log.error(error, 'Failed to send briefing');
      }
    },
  };
}

export function registerBriefingJob(fastify: FastifyInstance): void {
  const briefingService = createBriefingService(fastify);
  const cronExpression = process.env.BRIEFING_CRON;

  if (!cronExpression) {
    fastify.log.warn('BRIEFING_CRON is not set, skipping briefing job registration');
    return;
  }

  const task = new AsyncTask(
    'briefing-task',
    async () => {
      await briefingService.sendBriefing();
    },
    (err: Error) => {
      fastify.log.error(err, 'Briefing cron task failed');
    }
  );

  const job = new CronJob(
    { cronExpression },
    task,
    { id: 'briefing-job', preventOverrun: true }
  );

  fastify.scheduler.addCronJob(job);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/services/briefing.test.ts --reporter=verbose`

Expected: PASS for all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/briefing.ts test/services/briefing.test.ts
git commit -m "feat: rewrite briefing prompts with example, history, and error guidance"
```

---

### Task 4: Add manual briefing HTTP endpoint

**Files:**
- Create: `src/routes/briefing/index.ts`
- Create: `src/routes/briefing/handlers.ts`
- Create: `src/routes/briefing/schemas.ts`
- Test: `test/routes/briefing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/routes/briefing.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async (_prompt: string) => {}),
  getLastAssistantText: vi.fn(() => 'Manual briefing content'),
  dispose: vi.fn(),
};

const mockResourceLoader = {
  reload: vi.fn(async () => {}),
};

vi.mock('@mariozechner/pi-coding-agent', async () => {
  return {
    AuthStorage: { create: vi.fn(() => ({})) },
    ModelRegistry: { create: vi.fn(() => ({})) },
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
      return mockResourceLoader;
    }),
    createAgentSession: vi.fn(async () => ({ session: mockSession })),
    SessionManager: { inMemory: vi.fn(() => ({})) },
  };
});

vi.mock('@mariozechner/pi-ai', async () => {
  return {
    getModel: vi.fn(() => ({
      id: 'kimi-k2.6',
      provider: 'opencode-go',
    })),
  };
});

describe('Briefing API', () => {
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
      url: '/briefing',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should trigger a manual briefing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/briefing',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Briefing sent');
  });

  it('should save manual briefing to repository', async () => {
    await app.inject({
      method: 'POST',
      url: '/briefing',
      headers: { authorization: authHeader },
    });

    const latest = app.briefingRepository.findLatest();
    expect(latest).not.toBeNull();
    expect(latest!.triggerType).toBe('manual');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/briefing.test.ts --reporter=verbose`

Expected: FAIL with `404` because the route does not exist yet.

- [ ] **Step 3: Implement route, handler, and schema**

Create `src/routes/briefing/schemas.ts`:

```typescript
export const briefingTriggerSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
      },
    },
  },
};
```

Create `src/routes/briefing/handlers.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createBriefingService } from '../../services/briefing.js';

export async function briefingTriggerHandler(
  _request: FastifyRequest,
  reply: FastifyReply
) {
  const service = createBriefingService(reply.server);
  await service.sendBriefing({ triggerType: 'manual' });
  return { success: true, message: 'Briefing sent' };
}
```

Create `src/routes/briefing/index.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import { briefingTriggerSchema } from './schemas.js';
import { briefingTriggerHandler } from './handlers.js';

export default async function briefingRoutes(fastify: FastifyInstance) {
  fastify.post('/', { schema: briefingTriggerSchema }, briefingTriggerHandler);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/briefing.test.ts --reporter=verbose`

Expected: FAIL because the route is not registered in `app.ts` yet. The route file exists but Fastify does not know about it.

- [ ] **Step 5: Register route in app.ts and update types**

Open `src/types/fastify.d.ts`. After the `MemoryRepository` import, add:

```typescript
import type { BriefingRepository } from '../plugins/briefing-repository.js';
```

Inside the `FastifyInstance` interface, after `memoryRepository: MemoryRepository;`, add:

```typescript
    briefingRepository: BriefingRepository;
```

Open `src/app.ts`. After the `registerBriefingJob` import, add:

```typescript
import briefingRepositoryPlugin from './plugins/briefing-repository.js';
import briefingRoutes from './routes/briefing/index.js';
```

After `await app.register(repositoryPlugin);`, add:

```typescript
  await app.register(briefingRepositoryPlugin);
```

After `await app.register(calendarRoutes, { prefix: '/calendar' });`, add:

```typescript
  await app.register(briefingRoutes, { prefix: '/briefing' });
```

- [ ] **Step 6: Run route test again**

Run: `npx vitest run test/routes/briefing.test.ts --reporter=verbose`

Expected: PASS for all 3 tests.

- [ ] **Step 7: Run full test suite**

Run: `npx vitest run --reporter=verbose`

Expected: PASS for the entire suite.

- [ ] **Step 8: Commit**

```bash
git add src/routes/briefing/ src/types/fastify.d.ts src/app.ts test/routes/briefing.test.ts
git commit -m "feat: add manual briefing trigger endpoint at POST /briefing"
```

---

## Self-Review

### 1. Spec coverage

| Requirement | Task |
|-------------|------|
| Improve briefing prompt for modern LLMs | Task 3: new `buildSystemPrompt()` with structured rules, example, tone |
| Handle tool errors gracefully — plain English, don't dwell | Task 3: system prompt includes `- If a tool returns an error, mention it briefly in plain English and move on. Do not dwell on technical details.` |
| Only calendar tool available | Task 3: `extensionFactories` still only includes `createCalendarExtension(fastify)` |
| Add one-shot example | Task 3: `EXAMPLE` section in system prompt |
| No emojis | Task 3: `- Do not use emojis.` rule |
| Anti-hallucination | Task 3: `- Only use information provided by the tools. Do not invent events, memories, or tasks.` |
| New table for briefing history | Task 1: `briefings` table with `id`, `content`, `triggered_at`, `trigger_type` |
| Store content + date + time | Task 1 & 2: `triggered_at INTEGER` stores epoch ms; repository returns ISO strings |
| Manual trigger tracked in table | Task 3 & 4: `sendBriefing({ triggerType: 'manual' })` passes through to repository.create |
| Manual trigger endpoint | Task 4: `POST /briefing` route |

No gaps identified.

### 2. Placeholder scan

No `TBD`, `TODO`, `implement later`, or vague instructions found. Every step contains exact file paths, exact code blocks, exact commands, and expected outputs.

### 3. Type consistency

- `BriefingService.sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' })` used consistently in service definition, service implementation, cron job, and route handler.
- `CreateBriefingBody` uses `triggerType: 'scheduled' | 'manual'` matching the database `CHECK` constraint.
- `Briefing.triggerType` is `'scheduled' | 'manual'` throughout.
- `briefingRepository` decorator name matches interface name casing convention used by `memoryRepository`.

All consistent.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-04-briefing-prompt-refactor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
