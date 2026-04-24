# Memory Permanence & Context Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `permanent` flag to memories, migrate the database, convert all `createdAt` responses to ISO 8601 strings, and add a `GET /memories/context` endpoint that returns permanent + recent memories.

**Architecture:** Extend the existing SQLite schema with an additive migration, update the repository layer to handle the new field and ISO 8601 formatting, add a new repository method for context retrieval, expose it via a new HTTP route, and update all tests.

**Tech Stack:** Node.js 24, TypeScript, Fastify, better-sqlite3, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|--------------|
| `src/plugins/database.ts` | Modify | Add `permanent` column to schema + migration |
| `src/plugins/repository.ts` | Modify | Add `permanent` to types, ISO 8601 conversion, `findForContext()` |
| `src/routes/memories/schemas.ts` | Modify | Add `permanent` to POST body schema |
| `src/routes/memories/handlers.ts` | Modify | Add `getContext` handler |
| `src/routes/memories/index.ts` | Modify | Register `GET /context` route |
| `test/routes/memories.test.ts` | Modify | Update existing tests + add context endpoint tests |
| `test/plugins/repository.test.ts` | Modify | Add `permanent` and `findForContext` tests |
| `.env.example` | Modify | Add `CONTEXT_WINDOW_DAYS` |

---

### Task 1: Database Migration

**Files:**
- Modify: `src/plugins/database.ts`
- Test: `test/plugins/database.test.ts`

- [ ] **Step 1: Update `CREATE TABLE` to include `permanent`**

Modify `src/plugins/database.ts` line 13-18:
```typescript
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('appointment', 'note', 'todo', 'purchase')),
      permanent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
```

- [ ] **Step 2: Add migration for existing databases**

After the `CREATE TABLE` block (after line 29), add:
```typescript
  // Migration: add permanent column to existing databases
  const columns = db.pragma('table_info(memories)') as Array<{ name: string }>;
  const hasPermanent = columns.some((c) => c.name === 'permanent');
  if (!hasPermanent) {
    db.exec('ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0');
  }
```

- [ ] **Step 3: Update database test**

Modify `test/plugins/database.test.ts` to assert the `permanent` column exists:
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

  it('should have memories table with permanent column', () => {
    const columns = app.db.pragma('table_info(memories)') as Array<{ name: string }>;
    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain('permanent');
  });
});
```

- [ ] **Step 4: Run database test**

```bash
npx vitest run test/plugins/database.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugins/database.ts test/plugins/database.test.ts
git commit -m "feat: add permanent column to memories table with migration"
```

---

### Task 2: Repository Types & Helper

**Files:**
- Modify: `src/plugins/repository.ts`

- [ ] **Step 1: Update types and add helper function**

Replace the types and `MemoryRow` in `src/plugins/repository.ts` (lines 5-41):
```typescript
export type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';

export type Memory = {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  permanent: boolean;
  createdAt: string; // ISO 8601
};

export type CreateMemoryBody = {
  content: string;
  category: MemoryCategory;
  tags?: string[];
  permanent?: boolean;
};

export type ListMemoriesQuery = {
  category?: string;
  tags?: string;
  page?: number;
  limit?: number;
};

export interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };
}

type MemoryRow = {
  id: string;
  content: string;
  category: MemoryCategory;
  permanent: number;
  created_at: number;
  tag_names: string | null;
};

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    tags: row.tag_names ? row.tag_names.split(',') : [],
    permanent: Boolean(row.permanent),
    createdAt: new Date(row.created_at).toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/repository.ts
git commit -m "feat: add permanent to memory types and iso8601 helper"
```

---

### Task 3: Repository create & findById

**Files:**
- Modify: `src/plugins/repository.ts`

- [ ] **Step 1: Update `create` to handle `permanent`**

In `src/plugins/repository.ts`, replace the `create` method (lines 45-79):
```typescript
    create(data) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const content = data.content.trim();
      const category = data.category.toLowerCase() as MemoryCategory;
      const permanent = data.permanent ? 1 : 0;
      const tags = [
        ...new Set(
          (data.tags || [])
            .map((t) => t.toLowerCase().trim())
            .filter(Boolean)
        ),
      ];

      const insertMemory = db.prepare(
        'INSERT INTO memories (id, content, category, permanent, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO tags (name) VALUES (?)'
      );
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const transaction = db.transaction(() => {
        insertMemory.run(id, content, category, permanent, createdAt);
        for (const tag of tags) {
          insertTag.run(tag);
          linkTag.run(id, tag);
        }
      });

      transaction();

      return this.findById(id)!;
    },
```

- [ ] **Step 2: Update `findById` to use helper**

Replace `findById` (lines 81-102):
```typescript
    findById(id) {
      const row = db
        .prepare(
          `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
           FROM memories m
           LEFT JOIN memory_tags mt ON m.id = mt.memory_id
           LEFT JOIN tags t ON mt.tag_id = t.id
           WHERE m.id = ?
           GROUP BY m.id`
        )
        .get(id) as MemoryRow | undefined;

      if (!row) return null;

      return rowToMemory(row);
    },
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/repository.ts
git commit -m "feat: update create and findById for permanent field"
```

---

### Task 4: Repository findAll & findForContext

**Files:**
- Modify: `src/plugins/repository.ts`

- [ ] **Step 1: Update `findAll` to use helper**

Replace the `data` mapping in `findAll` (around lines 154-160):
```typescript
      const data = rows.map((row) => rowToMemory(row));
```

- [ ] **Step 2: Add `findForContext` method**

After `findAll`, before `delete`, add:
```typescript
    findForContext() {
      const days = parseInt(process.env.CONTEXT_WINDOW_DAYS || '30', 10);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

      const permanentRows = db
        .prepare(
          `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
           FROM memories m
           LEFT JOIN memory_tags mt ON m.id = mt.memory_id
           LEFT JOIN tags t ON mt.tag_id = t.id
           WHERE m.permanent = 1
           GROUP BY m.id
           ORDER BY m.created_at DESC`
        )
        .all() as MemoryRow[];

      const recentRows = db
        .prepare(
          `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
           FROM memories m
           LEFT JOIN memory_tags mt ON m.id = mt.memory_id
           LEFT JOIN tags t ON mt.tag_id = t.id
           WHERE m.permanent = 0 AND m.created_at >= ?
           GROUP BY m.id
           ORDER BY m.created_at DESC`
        )
        .all(cutoff) as MemoryRow[];

      return {
        permanent: permanentRows.map((row) => rowToMemory(row)),
        recent: recentRows.map((row) => rowToMemory(row)),
      };
    },
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/repository.ts
git commit -m "feat: add findForContext and update findAll with iso8601"
```

---

### Task 5: Schema Updates

**Files:**
- Modify: `src/routes/memories/schemas.ts`

- [ ] **Step 1: Add `permanent` to POST body schema**

Modify `src/routes/memories/schemas.ts`, add `permanent` to the `createMemorySchema` body properties (after line 11):
```typescript
      permanent: { type: 'boolean', default: false },
```

The full `createMemorySchema` should be:
```typescript
export const createMemorySchema = {
  body: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      category: {
        type: 'string',
        enum: ['appointment', 'note', 'todo', 'purchase'],
      },
      permanent: { type: 'boolean', default: false },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        default: [],
      },
    },
    required: ['content', 'category'],
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/memories/schemas.ts
git commit -m "feat: add permanent to create memory schema"
```

---

### Task 6: Handler & Route Updates

**Files:**
- Modify: `src/routes/memories/handlers.ts`
- Modify: `src/routes/memories/index.ts`

- [ ] **Step 1: Add `getContext` handler**

Add to `src/routes/memories/handlers.ts` after `deleteMemory`:
```typescript
export async function getContext(request: FastifyRequest) {
  const context = request.server.memoryRepository.findForContext();
  return context;
}
```

- [ ] **Step 2: Register new route**

Modify `src/routes/memories/index.ts`:
1. Import `getContext`:
```typescript
import { createMemory, getMemory, listMemories, deleteMemory, getContext } from './handlers.js';
```
2. Add the route after `fastify.get('/:id', ...)`:
```typescript
  fastify.get('/context', getContext);
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/memories/handlers.ts src/routes/memories/index.ts
git commit -m "feat: add GET /memories/context endpoint"
```

---

### Task 7: Repository Unit Tests

**Files:**
- Modify: `test/plugins/repository.test.ts`

- [ ] **Step 1: Update existing assertions for new types**

Modify `test/plugins/repository.test.ts`. Update the create/retrieve test to check `permanent` and `createdAt` format:
```typescript
  it('should create and retrieve a memory', () => {
    const created = app.memoryRepository.create({
      content: 'Test memory',
      category: 'note',
      tags: ['test'],
    });

    expect(created.content).toBe('Test memory');
    expect(created.category).toBe('note');
    expect(created.tags).toEqual(['test']);
    expect(created.permanent).toBe(false);
    expect(created.id).toBeDefined();
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601

    const found = app.memoryRepository.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe('Test memory');
    expect(found!.permanent).toBe(false);
  });
```

- [ ] **Step 2: Add test for creating permanent memory**

After the create/retrieve test, add:
```typescript
  it('should create a permanent memory', () => {
    const created = app.memoryRepository.create({
      content: 'Permanent memory',
      category: 'note',
      permanent: true,
    });

    expect(created.permanent).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found!.permanent).toBe(true);
  });
```

- [ ] **Step 3: Add test for `findForContext`**

After the delete test, add:
```typescript
  it('should find memories for context', () => {
    const permanent = app.memoryRepository.create({
      content: 'I like dark mode',
      category: 'note',
      permanent: true,
    });

    const recent = app.memoryRepository.create({
      content: 'Recent thing',
      category: 'note',
    });

    // Make an old memory by updating created_at directly
    const old = app.memoryRepository.create({
      content: 'Old thing',
      category: 'note',
    });
    app.db
      .prepare('UPDATE memories SET created_at = ? WHERE id = ?')
      .run(Date.now() - 31 * 24 * 60 * 60 * 1000, old.id);

    const context = app.memoryRepository.findForContext();

    expect(context.permanent.map((m) => m.id)).toContain(permanent.id);
    expect(context.recent.map((m) => m.id)).toContain(recent.id);
    expect(context.recent.map((m) => m.id)).not.toContain(old.id);
    expect(context.permanent.map((m) => m.id)).not.toContain(recent.id);
  });
```

- [ ] **Step 4: Run repository tests**

```bash
npx vitest run test/plugins/repository.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/plugins/repository.test.ts
git commit -m "test: add permanent and findForContext repository tests"
```

---

### Task 8: E2E Tests — Existing Endpoints

**Files:**
- Modify: `test/routes/memories.test.ts`

- [ ] **Step 1: Update POST test for `permanent` default and ISO 8601**

Modify the first POST test in `test/routes/memories.test.ts` (lines 37-57):
```typescript
    it('should create a memory with tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Dentist at 2pm',
          category: 'appointment',
          tags: ['health', 'reminder'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.content).toBe('Dentist at 2pm');
      expect(body.category).toBe('appointment');
      expect(body.tags).toContain('health');
      expect(body.tags).toContain('reminder');
      expect(body.permanent).toBe(false);
      expect(body.id).toBeDefined();
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
```

- [ ] **Step 2: Add POST test for `permanent: true`**

After the deduplication test, add:
```typescript
    it('should create a permanent memory', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'I prefer dark mode',
          category: 'note',
          permanent: true,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.permanent).toBe(true);
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
```

- [ ] **Step 3: Update GET by id test for ISO 8601**

In the GET by id test, add assertions:
```typescript
      expect(body.id).toBe(created.id);
      expect(body.content).toBe('Find me');
      expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
```

- [ ] **Step 4: Run e2e tests**

```bash
npx vitest run test/routes/memories.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/routes/memories.test.ts
git commit -m "test: update e2e tests for permanent and iso8601 timestamps"
```

---

### Task 9: E2E Tests — Context Endpoint

**Files:**
- Modify: `test/routes/memories.test.ts`

- [ ] **Step 1: Add context endpoint tests**

Add a new `describe` block at the end of the file, before the final closing brace:
```typescript
  describe('GET /memories/context', () => {
    it('should return permanent and recent memories', async () => {
      // Create permanent memory
      const permRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Permanent preference',
          category: 'note',
          permanent: true,
        },
      });
      const permanent = permRes.json();

      // Create recent memory
      const recentRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Recent event',
          category: 'note',
        },
      });
      const recent = recentRes.json();

      // Create old memory (manually backdate)
      const oldRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Old event',
          category: 'note',
        },
      });
      const old = oldRes.json();
      app.db
        .prepare('UPDATE memories SET created_at = ? WHERE id = ?')
        .run(Date.now() - 31 * 24 * 60 * 60 * 1000, old.id);

      const response = await app.inject({
        method: 'GET',
        url: '/memories/context',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.permanent.map((m: { id: string }) => m.id)).toContain(permanent.id);
      expect(body.recent.map((m: { id: string }) => m.id)).toContain(recent.id);
      expect(body.recent.map((m: { id: string }) => m.id)).not.toContain(old.id);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/context',
      });
      expect(response.statusCode).toBe(401);
    });
  });
```

- [ ] **Step 2: Run all e2e tests**

```bash
npx vitest run test/routes/memories.test.ts
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/routes/memories.test.ts
git commit -m "test: add e2e tests for GET /memories/context"
```

---

### Task 10: Environment Example & Final Verification

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add `CONTEXT_WINDOW_DAYS` to `.env.example`**

Modify `.env.example` to add:
```
CONTEXT_WINDOW_DAYS=30
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "chore: add CONTEXT_WINDOW_DAYS to env example"
```

---

## Self-Review

**1. Spec coverage:**
- `permanent` boolean on memories → Tasks 1, 2, 3, 5, 7, 8, 9
- `createdAt` as ISO 8601 → Tasks 2, 3, 4, 7, 8
- `GET /memories/context` endpoint → Tasks 4, 6, 9
- `CONTEXT_WINDOW_DAYS` env var → Tasks 4, 10
- Database migration → Task 1
- All tests updated → Tasks 7, 8, 9

**2. Placeholder scan:** No TBDs, TODOs, or vague steps. Every step has exact code and commands.

**3. Type consistency:** `permanent` is `boolean` in `Memory`, `number` in `MemoryRow`, handled by `Boolean()` in `rowToMemory`. `createdAt` is `string` in `Memory`, converted via `new Date(row.created_at).toISOString()`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-memory-permanence.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
