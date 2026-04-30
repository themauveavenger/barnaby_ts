# Core Memory Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject permanent memories tagged with `core` into every chat prompt so Barnaby has baseline knowledge about the user.

**Architecture:** Reuse the existing `permanent` flag and tags system. Pre-populate common tags on startup. Add a `findByTags` repository method. Modify the chat handler to fetch core memories and prepend them to the LLM prompt.

**Tech Stack:** Fastify, better-sqlite3, vitest, `@mariozechner/pi-coding-agent`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/plugins/database.ts` | Runs migrations; adds pre-populated tags insertion |
| `src/plugins/repository.ts` | Adds `findByTags` method to `MemoryRepository` interface and implementation |
| `src/routes/chat/handlers.ts` | Fetches core memories and injects them into the prompt |
| `test/plugins/database.test.ts` | Tests that pre-populated tags are inserted on startup |
| `test/plugins/repository.test.ts` | Tests for `findByTags` behavior |
| `test/routes/chat.test.ts` | Tests that core memories are included in the prompt |

---

### Task 1: Pre-populate tags in the database migration

**Files:**
- Modify: `src/plugins/database.ts:38`
- Test: `test/plugins/database.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test to `test/plugins/database.test.ts` that verifies the pre-populated tags exist after startup.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';

describe('database plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should decorate fastify with db', () => {
    expect(app.hasDecorator('db')).toBe(true);
  });

  it('should pre-populate default tags on startup', () => {
    const rows = app.db.prepare('SELECT name FROM tags ORDER BY name').all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    expect(names).toContain('core');
    expect(names).toContain('identity');
    expect(names).toContain('family');
    expect(names).toContain('friend');
    expect(names).toContain('home');
    expect(names).toContain('preference');
    expect(names).toContain('food');
    expect(names).toContain('health');
    expect(names).toContain('holiday');
    expect(names).toContain('date');
    expect(names).toContain('work');
    expect(names).toContain('finance');
    expect(names).toContain('travel');
    expect(names).toContain('tech');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/database.test.ts`

Expected: FAIL — `tags` table is empty because pre-populated tags are not inserted yet.

- [ ] **Step 3: Add pre-populated tags to the migration**

In `src/plugins/database.ts`, after the `ALTER TABLE` migration block (around line 45), add the pre-populated tags insertion:

```typescript
  // Pre-populate default tags
  db.exec(`
    INSERT OR IGNORE INTO tags (name) VALUES
      ('core'),
      ('identity'),
      ('family'),
      ('friend'),
      ('home'),
      ('preference'),
      ('food'),
      ('health'),
      ('holiday'),
      ('date'),
      ('work'),
      ('finance'),
      ('travel'),
      ('tech');
  `);
```

The full file should now look like:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

export type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
};

export default fp(async function databasePlugin(fastify: FastifyInstance) {
  const dbPath = process.env.DATABASE_PATH || ':memory:';
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

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
  `);

  // Migration: add permanent column to existing databases
  const columns = db.pragma('table_info(memories)') as Array<ColumnInfo>;
  const hasPermanent = columns.some((c) => c.name === 'permanent');
  if (!hasPermanent) {
    db.exec('ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0');
  }

  // Pre-populate default tags
  db.exec(`
    INSERT OR IGNORE INTO tags (name) VALUES
      ('core'),
      ('identity'),
      ('family'),
      ('friend'),
      ('home'),
      ('preference'),
      ('food'),
      ('health'),
      ('holiday'),
      ('date'),
      ('work'),
      ('finance'),
      ('travel'),
      ('tech');
  `);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/plugins/database.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/database.ts test/plugins/database.test.ts
git commit -m 'feat: pre-populate default tags on database startup'
```

---

### Task 2: Add `findByTags` to the MemoryRepository

**Files:**
- Modify: `src/plugins/repository.ts:30-36` (interface)
- Modify: `src/plugins/repository.ts:58-208` (implementation)
- Test: `test/plugins/repository.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests to `test/plugins/repository.test.ts` after the existing `findForContext` test:

```typescript
  it('should find memories by tags with AND logic', () => {
    const coreFamily = app.memoryRepository.create({
      content: 'My partner is Alex',
      category: 'note',
      permanent: true,
      tags: ['core', 'family'],
    });

    const coreFood = app.memoryRepository.create({
      content: 'I am vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    const nonCore = app.memoryRepository.create({
      content: 'Just a regular note',
      category: 'note',
      tags: ['work'],
    });

    const results = app.memoryRepository.findByTags(['core', 'family'], { permanentOnly: true });

    expect(results.map((m: Memory) => m.id)).toContain(coreFamily.id);
    expect(results.map((m: Memory) => m.id)).not.toContain(coreFood.id);
    expect(results.map((m: Memory) => m.id)).not.toContain(nonCore.id);
  });

  it('should return empty array when no memories match tags', () => {
    const results = app.memoryRepository.findByTags(['nonexistent'], { permanentOnly: true });
    expect(results).toEqual([]);
  });

  it('should findByTags without permanentOnly filter', () => {
    const nonPermanent = app.memoryRepository.create({
      content: 'Temporary core memory',
      category: 'note',
      permanent: false,
      tags: ['core'],
    });

    const withPermanent = app.memoryRepository.findByTags(['core'], { permanentOnly: true });
    const withoutPermanent = app.memoryRepository.findByTags(['core']);

    expect(withPermanent.map((m: Memory) => m.id)).not.toContain(nonPermanent.id);
    expect(withoutPermanent.map((m: Memory) => m.id)).toContain(nonPermanent.id);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/plugins/repository.test.ts`

Expected: FAIL — `findByTags` is not a function.

- [ ] **Step 3: Add `findByTags` to the interface**

In `src/plugins/repository.ts`, update the `MemoryRepository` interface (line 30-36):

```typescript
export interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };
  findByTags(tags: string[], options?: { permanentOnly?: boolean }): Memory[];
}
```

- [ ] **Step 4: Implement `findByTags`**

Add the `findByTags` method to the `createMemoryRepository` return object, after `findForContext` (around line 201):

```typescript
    findByTags(tags, options = {}) {
      if (tags.length === 0) return [];

      const placeholders = tags.map(() => '?').join(',');
      const permanentFilter = options.permanentOnly ? 'AND m.permanent = 1' : '';

      const sql = `
        SELECT m.*, GROUP_CONCAT(t.name) as tag_names
        FROM memories m
        JOIN memory_tags mt ON m.id = mt.memory_id
        JOIN tags t ON mt.tag_id = t.id
        WHERE t.name IN (${placeholders})
          ${permanentFilter}
        GROUP BY m.id
        HAVING COUNT(DISTINCT t.name) = ?
        ORDER BY m.created_at DESC
      `;

      const params = [...tags, tags.length];
      const rows = db.prepare(sql).all(...params) as MemoryRow[];

      return rows.map((row) => rowToMemory(row));
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/plugins/repository.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/plugins/repository.ts test/plugins/repository.test.ts
git commit -m 'feat: add findByTags method to MemoryRepository'
```

---

### Task 3: Inject core memories into the chat prompt

**Files:**
- Modify: `src/routes/chat/handlers.ts:23-30`
- Test: `test/routes/chat.test.ts`

- [ ] **Step 1: Write the failing test**

Add tests to `test/routes/chat.test.ts` after the existing tests:

```typescript
  it('should include core memories in the prompt when they exist', async () => {
    // Create a core memory
    app.memoryRepository.create({
      content: 'The user is vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'What should I eat?' },
    });

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).toContain('Core memories about the user:');
    expect(prompt).toContain('- The user is vegetarian');
  });

  it('should omit core memory section when no core memories exist', async () => {
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    const prompt = mockSession.prompt.mock.calls[0][0];
    expect(prompt).not.toContain('Core memories about the user:');
  });

  it('should place the user message after core memories', async () => {
    app.memoryRepository.create({
      content: 'The user is vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'What should I eat?' },
    });

    const prompt = mockSession.prompt.mock.calls[0][0];
    const coreIndex = prompt.indexOf('Core memories about the user:');
    const messageIndex = prompt.indexOf('What should I eat?');
    expect(coreIndex).toBeLessThan(messageIndex);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/routes/chat.test.ts`

Expected: FAIL — core memories section is not present in the prompt.

- [ ] **Step 3: Modify the chat handler**

Update `src/routes/chat/handlers.ts` to fetch core memories and inject them:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

export type ChatBody = {
  message: string;
};

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
    noTools: 'all',
  });

  try {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const coreMemories = request.server.memoryRepository.findByTags(['core'], { permanentOnly: true });

    const coreContext = coreMemories.length > 0
      ? ['Core memories about the user:', ...coreMemories.map((m) => `- ${m.content}`)].join('\n')
      : '';

    const prompt = [
      `Today is ${today}.`,
      '',
      coreContext,
      '',
      request.body.message,
    ].filter(Boolean).join('\n');

    await session.prompt(prompt);
    const responseText = session.getLastAssistantText() ?? '';
    return { response: responseText };
  } finally {
    session.dispose();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/routes/chat.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat/handlers.ts test/routes/chat.test.ts
git commit -m 'feat: inject core memories into chat prompt'
```

---

### Task 4: Run full test suite and verify no regressions

- [ ] **Step 1: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass, including the new ones and all existing tests.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 3: Commit if everything passes**

If all tests and typecheck pass, the implementation is complete.

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Pre-populate default tags (Task 1)
- [x] `findByTags` repository method with AND logic (Task 2)
- [x] `permanentOnly` option in `findByTags` (Task 2)
- [x] Inject core memories into chat prompt (Task 3)
- [x] Omit context section when no core memories exist (Task 3)
- [x] Tests for all new behavior (Tasks 1-3)

**2. Placeholder scan:**
- [x] No TBD, TODO, or incomplete sections
- [x] All code blocks contain actual code
- [x] All commands are exact with expected output

**3. Type consistency:**
- [x] `findByTags` signature matches in interface and implementation
- [x] `Memory` type is reused consistently
- [x] `options` parameter is optional in both interface and implementation
