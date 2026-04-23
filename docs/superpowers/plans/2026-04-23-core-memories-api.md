# Core Memories API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Fastify REST API with SQLite storage for creating, retrieving, listing, and deleting personal memories with tags and categories, protected by HTTP Basic Auth.

**Architecture:** Fastify plugin architecture with explicit encapsulation. Database access via better-sqlite3 using a synchronous repository pattern. Auth scoped to memory routes only. E2E testing via Fastify's `inject()`.

**Tech Stack:** Node.js 24, TypeScript, Fastify, better-sqlite3, @fastify/basic-auth, fastify-plugin, vitest

---

## File Structure

```
src/
  app.ts                        # App factory (buildApp function)
  index.ts                      # Entry point: builds app, starts server, handles shutdown
  plugins/
    database.ts                 # better-sqlite3 connection, PRAGMAs, migrations
    error-handler.ts            # NotFoundError class + global setErrorHandler
    repository.ts               # createMemoryRepository() + MemoryRepository type
  routes/
    memories/
      index.ts                  # Route registration with scoped basic auth
      handlers.ts               # createMemory, getMemory, listMemories, deleteMemory
      schemas.ts                # JSON Schema definitions
  types/
    fastify.d.ts                # Module augmentation for fastify.db and fastify.memoryRepository
test/
  helper.ts                     # buildTestApp() factory
  routes/
    memories.test.ts            # E2E tests for all memory endpoints
```

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Install production dependencies**

```bash
npm install --save-exact fastify@5.8.5 @fastify/basic-auth@5.0.0 better-sqlite3@12.9.0 fastify-plugin@5.0.0
```

- [ ] **Step 2: Install development dependencies**

```bash
npm install --save-exact -D @types/better-sqlite3@7.6.12 vitest@4.1.5
```

- [ ] **Step 3: Update package.json scripts**

Modify `package.json` scripts section:

```json
"scripts": {
  "start": "tsx --env-file=./.env ./src/index.ts",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Create .env.example**

Create `.env.example`:

```
PORT=3000
DATABASE_PATH=./barnaby.db
BASIC_AUTH_USERNAME=barnaby
BASIC_AUTH_PASSWORD=change-me
```

- [ ] **Step 5: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
  },
});
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example vitest.config.ts
git commit -m "chore: install dependencies for memories api"
```

---

## Task 2: Database Plugin

**Files:**
- Create: `src/plugins/database.ts`
- Create: `src/types/fastify.d.ts`
- Test: `test/plugins/database.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/plugins/database.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';

describe('database plugin', () => {
  let app;

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

  it('should have created tables', () => {
    const tables = app.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memories', 'tags', 'memory_tags')"
    ).all();
    expect(tables.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/plugins/database.test.ts
```

Expected: FAIL with "Cannot find module '../../src/plugins/database.js'"

- [ ] **Step 3: Implement database plugin**

Create `src/plugins/database.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

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

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});
```

- [ ] **Step 4: Create TypeScript augmentation**

Create `src/types/fastify.d.ts`:

```typescript
import type { Database } from 'better-sqlite3';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run test/plugins/database.test.ts
```

Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/plugins/database.ts src/types/fastify.d.ts test/plugins/database.test.ts
git commit -m "feat: add database plugin with sqlite schema"
```

---

## Task 3: Repository Plugin

**Files:**
- Create: `src/plugins/repository.ts`
- Modify: `src/types/fastify.d.ts`
- Test: `test/plugins/repository.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/plugins/repository.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import repositoryPlugin from '../../src/plugins/repository.js';

describe('repository plugin', () => {
  let app;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.register(repositoryPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should decorate fastify with memoryRepository', () => {
    expect(app.hasDecorator('memoryRepository')).toBe(true);
  });

  it('should create and retrieve a memory', () => {
    const created = app.memoryRepository.create({
      content: 'Test memory',
      category: 'note',
      tags: ['test'],
    });

    expect(created.content).toBe('Test memory');
    expect(created.category).toBe('note');
    expect(created.tags).toEqual(['test']);
    expect(created.id).toBeDefined();
    expect(created.createdAt).toBeDefined();

    const found = app.memoryRepository.findById(created.id);
    expect(found).not.toBeNull();
    expect(found.content).toBe('Test memory');
  });

  it('should deduplicate tags', () => {
    const created = app.memoryRepository.create({
      content: 'Dupes',
      category: 'todo',
      tags: ['work', 'WORK', 'work'],
    });

    expect(created.tags).toEqual(['work']);
  });

  it('should delete a memory', () => {
    const created = app.memoryRepository.create({
      content: 'To delete',
      category: 'note',
    });

    const deleted = app.memoryRepository.delete(created.id);
    expect(deleted).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/plugins/repository.test.ts
```

Expected: FAIL with "Cannot find module '../../src/plugins/repository.js'"

- [ ] **Step 3: Implement repository plugin**

Create `src/plugins/repository.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';

export type Memory = {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  createdAt: number;
};

export type CreateMemoryBody = {
  content: string;
  category: MemoryCategory;
  tags?: string[];
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
}

export function createMemoryRepository(db: Database): MemoryRepository {
  return {
    create(data) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const content = data.content.trim();
      const category = data.category.toLowerCase() as MemoryCategory;
      const tags = [
        ...new Set(
          (data.tags || [])
            .map((t) => t.toLowerCase().trim())
            .filter(Boolean)
        ),
      ];

      const insertMemory = db.prepare(
        'INSERT INTO memories (id, content, category, created_at) VALUES (?, ?, ?, ?)'
      );
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO tags (name) VALUES (?)'
      );
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const transaction = db.transaction(() => {
        insertMemory.run(id, content, category, createdAt);
        for (const tag of tags) {
          insertTag.run(tag);
          linkTag.run(id, tag);
        }
      });

      transaction();

      return this.findById(id)!;
    },

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
        .get(id);

      if (!row) return null;

      return {
        id: row.id,
        content: row.content,
        category: row.category,
        tags: row.tag_names ? row.tag_names.split(',') : [],
        createdAt: row.created_at,
      };
    },

    findAll(query) {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (query.category) {
        conditions.push('m.category = ?');
        params.push(query.category.toLowerCase());
      }

      let tagFilterClause = '';
      if (query.tags) {
        const tagList = query.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (tagList.length > 0) {
          const placeholders = tagList.map(() => '?').join(',');
          tagFilterClause = `AND m.id IN (
            SELECT mt.memory_id
            FROM memory_tags mt
            JOIN tags t ON mt.tag_id = t.id
            WHERE t.name IN (${placeholders})
          )`;
          params.push(...tagList);
        }
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const countSql = `SELECT COUNT(*) as total FROM memories m ${whereClause} ${tagFilterClause}`;
      const countRow = db.prepare(countSql).get(...params);
      const total = countRow.total;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const offset = (page - 1) * limit;

      const dataSql = `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
                       FROM memories m
                       LEFT JOIN memory_tags mt ON m.id = mt.memory_id
                       LEFT JOIN tags t ON mt.tag_id = t.id
                       ${whereClause} ${tagFilterClause}
                       GROUP BY m.id
                       ORDER BY m.created_at DESC
                       LIMIT ? OFFSET ?`;

      const rows = db.prepare(dataSql).all(...params, limit, offset);

      const data = rows.map((row) => ({
        id: row.id,
        content: row.content,
        category: row.category,
        tags: row.tag_names ? row.tag_names.split(',') : [],
        createdAt: row.created_at,
      }));

      return { data, total };
    },

    delete(id) {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

export default fp(async function repositoryPlugin(fastify: FastifyInstance) {
  const repo = createMemoryRepository(fastify.db);
  fastify.decorate('memoryRepository', repo);
});
```

- [ ] **Step 4: Update TypeScript augmentation**

Modify `src/types/fastify.d.ts`:

```typescript
import type { Database } from 'better-sqlite3';
import type { MemoryRepository } from '../plugins/repository.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
    memoryRepository: MemoryRepository;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run test/plugins/repository.test.ts
```

Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/plugins/repository.ts src/types/fastify.d.ts test/plugins/repository.test.ts
git commit -m "feat: add memory repository with CRUD operations"
```

---

## Task 4: Error Handler Plugin

**Files:**
- Create: `src/plugins/error-handler.ts`
- Test: `test/plugins/error-handler.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/plugins/error-handler.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import errorHandlerPlugin from '../../src/plugins/error-handler.js';

describe('error handler plugin', () => {
  let app;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should format NotFoundError as 404', async () => {
    app.get('/not-found', async () => {
      const { NotFoundError } = await import('../../src/plugins/error-handler.js');
      throw new NotFoundError('Resource not found');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/not-found',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('Resource not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/plugins/error-handler.test.ts
```

Expected: FAIL with "Cannot find module '../../src/plugins/error-handler.js'"

- [ ] **Step 3: Implement error handler plugin**

Create `src/plugins/error-handler.ts`:

```typescript
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(message: string) {
    super(message);
  }
}

export default fp(async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error.statusCode === 400) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.message,
      });
    }

    if (error instanceof NotFoundError) {
      return reply.code(404).send({
        statusCode: 404,
        error: 'Not Found',
        message: error.message,
      });
    }

    return reply.code(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong',
    });
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run test/plugins/error-handler.test.ts
```

Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add src/plugins/error-handler.ts test/plugins/error-handler.test.ts
git commit -m "feat: add global error handler with NotFoundError"
```

---

## Task 5: Memory Routes

**Files:**
- Create: `src/routes/memories/schemas.ts`
- Create: `src/routes/memories/handlers.ts`
- Create: `src/routes/memories/index.ts`

- [ ] **Step 1: Write failing e2e test**

Create `test/routes/memories.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Memories API', () => {
  let app;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should create a memory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Test memory',
        category: 'note',
        tags: ['test', 'important'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.content).toBe('Test memory');
    expect(body.category).toBe('note');
    expect(body.tags).toEqual(['important', 'test']);
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/routes/memories.test.ts
```

Expected: FAIL with "Cannot find module '../helper.js'" or route not found

- [ ] **Step 3: Create test helper**

Create `test/helper.ts`:

```typescript
import { buildApp } from '../src/app.js';

export async function buildTestApp() {
  process.env.DATABASE_PATH = ':memory:';
  process.env.BASIC_AUTH_USERNAME = 'test';
  process.env.BASIC_AUTH_PASSWORD = 'test';

  const app = await buildApp();
  return app;
}
```

- [ ] **Step 4: Create schemas**

Create `src/routes/memories/schemas.ts`:

```typescript
export const createMemorySchema = {
  body: {
    type: 'object',
    properties: {
      // Note: maxLength 2000 chars is a proxy for ~100 words.
      // Adjust if longer memories are needed.
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      category: {
        type: 'string',
        enum: ['appointment', 'note', 'todo', 'purchase'],
      },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
        default: [],
      },
    },
    required: ['content', 'category'],
  },
};

export const getMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
};

export const listMemoriesSchema = {
  querystring: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['appointment', 'note', 'todo', 'purchase'],
      },
      tags: { type: 'string' },
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
};

export const deleteMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
};
```

- [ ] **Step 5: Create handlers**

Create `src/routes/memories/handlers.ts`:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError } from '../../plugins/error-handler.js';
import type { CreateMemoryBody, ListMemoriesQuery } from '../../plugins/repository.js';

export async function createMemory(
  request: FastifyRequest<{ Body: CreateMemoryBody }>,
  reply: FastifyReply
) {
  const memory = request.server.memoryRepository.create(request.body);
  reply.code(201);
  return memory;
}

export async function getMemory(
  request: FastifyRequest<{ Params: { id: string } }>
) {
  const memory = request.server.memoryRepository.findById(request.params.id);
  if (!memory) {
    throw new NotFoundError('Memory not found');
  }
  return memory;
}

export async function listMemories(
  request: FastifyRequest<{ Querystring: ListMemoriesQuery }>
) {
  const { data, total } = request.server.memoryRepository.findAll(request.query);
  const page = request.query.page || 1;
  const limit = request.query.limit || 20;
  return {
    data,
    pagination: { page, limit, total },
  };
}

export async function deleteMemory(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const deleted = request.server.memoryRepository.delete(request.params.id);
  if (!deleted) {
    throw new NotFoundError('Memory not found');
  }
  reply.code(204);
}
```

- [ ] **Step 6: Create route index**

Create `src/routes/memories/index.ts`:

```typescript
import type { FastifyInstance } from 'fastify';
import basicAuth from '@fastify/basic-auth';
import {
  createMemorySchema,
  getMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
} from './schemas.js';
import { createMemory, getMemory, listMemories, deleteMemory } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  await fastify.register(basicAuth, {
    validate: async (username, password) => {
      const expectedUser = process.env.BASIC_AUTH_USERNAME;
      const expectedPass = process.env.BASIC_AUTH_PASSWORD;
      if (username !== expectedUser || password !== expectedPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'barnaby' },
  });

  fastify.addHook('onRequest', fastify.basicAuth);

  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/:id', { schema: getMemorySchema }, getMemory);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
```

- [ ] **Step 7: Create app factory**

Create `src/app.ts`:

```typescript
import Fastify from 'fastify';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import memoryRoutes from './routes/memories/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);
  await app.register(memoryRoutes, { prefix: '/memories' });

  return app;
}
```

- [ ] **Step 8: Update entry point**

Modify `src/index.ts`:

```typescript
import { buildApp } from './app.js';

async function main() {
  const app = await buildApp();

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully`);
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npx vitest run test/routes/memories.test.ts
```

Expected: PASS (3 tests)

- [ ] **Step 10: Commit**

```bash
git add src/routes/ src/app.ts src/index.ts test/helper.ts test/routes/memories.test.ts
git commit -m "feat: add memory routes with auth, schemas, and handlers"
```

---

## Task 6: Complete E2E Test Suite

**Files:**
- Modify: `test/routes/memories.test.ts`

- [ ] **Step 1: Expand test file with all scenarios**

Replace `test/routes/memories.test.ts` with the complete test suite:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Memories API', () => {
  let app;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid credentials', async () => {
      const badAuth = 'Basic ' + Buffer.from('wrong:wrong').toString('base64');
      const response = await app.inject({
        method: 'GET',
        url: '/memories',
        headers: { authorization: badAuth },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /memories', () => {
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
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
    });

    it('should deduplicate and normalize tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Buy milk',
          category: 'purchase',
          tags: ['Shop', 'shop', 'SHOP'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.tags).toEqual(['shop']);
    });

    it('should reject invalid category', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Test',
          category: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          category: 'note',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /memories/:id', () => {
    it('should retrieve a memory by id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Find me',
          category: 'note',
        },
      });
      const created = createRes.json();

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(created.id);
      expect(body.content).toBe('Find me');
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/00000000-0000-0000-0000-000000000000',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid uuid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/not-a-uuid',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /memories', () => {
    it('should list memories with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?page=1&limit=10',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
    });

    it('should filter by category', async () => {
      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Category filter test',
          category: 'todo',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/memories?category=todo',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.every((m) => m.category === 'todo')).toBe(true);
    });

    it('should reject invalid category in query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?category=invalid',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /memories/:id', () => {
    it('should delete a memory', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Delete me',
          category: 'note',
        },
      });
      const created = createRes.json();

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(deleteRes.statusCode).toBe(204);

      const getRes = await app.inject({
        method: 'GET',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(getRes.statusCode).toBe(404);
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/memories/00000000-0000-0000-0000-000000000000',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should clean up tags on delete (cascade)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Tag cleanup test',
          category: 'note',
          tags: ['cleanup-test'],
        },
      });
      const created = createRes.json();

      await app.inject({
        method: 'DELETE',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      // Verify memory_tags rows are gone (would cause 404 above, but let's be explicit)
      const tagCount = app.db
        .prepare('SELECT COUNT(*) as count FROM memory_tags WHERE memory_id = ?')
        .get(created.id);
      expect(tagCount.count).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add test/routes/memories.test.ts
git commit -m "test: add complete e2e test suite for memories api"
```

---

## Task 7: Final Verification & Manual Test

- [ ] **Step 1: Run full test suite one more time**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 2: Type-check the project**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Start the dev server to verify it boots**

```bash
npm start
```

Expected: Server starts on port 3000, logs show it listening.

Press `Ctrl+C` to stop.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete core memories api implementation" || echo "Nothing to commit"
```

---

## Spec Coverage Checklist

| Spec Requirement | Task |
|------------------|------|
| Fastify plugin architecture | Tasks 2-5 |
| SQLite schema with CHECK constraint | Task 2 |
| PRAGMA foreign_keys + WAL | Task 2 |
| MemoryRepository (sync) | Task 3 |
| POST /memories | Tasks 5-6 |
| GET /memories/:id | Tasks 5-6 |
| GET /memories (with filters/pagination) | Tasks 5-6 |
| DELETE /memories/:id | Tasks 5-6 |
| Basic auth scoped to routes | Task 5 |
| Tag deduplication + lowercase + trim | Task 3 |
| Content maxLength 2000 | Task 5 (schema) |
| Category enum validation (body + query) | Task 5 (schema) |
| Error handler with NotFoundError | Task 4 |
| Graceful shutdown | Task 5 (index.ts) |
| Additive-only migrations | Task 2 |
| E2E tests with inject() | Tasks 1, 6 |
| UUID v4 via crypto.randomUUID() | Task 3 |

---

## Placeholder Scan

- No "TBD", "TODO", "implement later" found.
- No vague "add error handling" without code.
- All test code is complete.
- All implementation code is complete.
- Type names are consistent across all tasks.

---

*End of plan*
