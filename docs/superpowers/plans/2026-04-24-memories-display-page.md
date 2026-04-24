# Memories Display Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-rendered HTML page at `/` for viewing memories with pagination, category/tag filtering, and full details, protected by basic auth.

**Architecture:** Move basic auth to the app level so both API and HTML routes share it. Register `@fastify/view` with Handlebars. Create a new `pages` route at `/` that queries the repository and renders templates.

**Tech Stack:** Fastify 5, TypeScript, Handlebars, @fastify/view, @fastify/basic-auth, better-sqlite3, vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `package.json` | Add `@fastify/view` and `handlebars` dependencies |
| `src/app.ts` | Move basic auth here; register `@fastify/view`; wire page routes |
| `src/routes/memories/index.ts` | Remove basic auth registration (keep routes) |
| `src/routes/pages/index.ts` | GET `/` handler: parse query, call repository, render HTML |
| `src/templates/layout.hbs` | Shared HTML wrapper (title, main content block) |
| `src/templates/memories.hbs` | Filter form, memory list, pagination controls |
| `test/routes/pages.test.ts` | E2E tests for the HTML page |

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @fastify/view and handlebars**

```bash
npm install --save-exact @fastify/view@11.0.0 handlebars@4.7.8
```

- [ ] **Step 2: Verify package.json updated**

Run: `cat package.json | grep -A2 -B2 "view\|handlebars"`
Expected: Both packages appear in `dependencies` with exact versions.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
npm install --save-exact @fastify/view@11.0.0 handlebars@4.7.8 && git add package.json package-lock.json && git commit -m "deps: add @fastify/view and handlebars"
```

---

### Task 2: Move basic auth to app level

**Files:**
- Modify: `src/app.ts`
- Modify: `src/routes/memories/index.ts`

- [ ] **Step 1: Add basic auth to app.ts**

Modify `src/app.ts` to import and register `@fastify/basic-auth` before routes:

```typescript
import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);

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

  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);

  return app;
}
```

- [ ] **Step 2: Remove basic auth from memory routes**

Replace the contents of `src/routes/memories/index.ts` with:

```typescript
import type { FastifyInstance } from 'fastify';
import {
  createMemorySchema,
  getMemorySchema,
  listMemoriesSchema,
  deleteMemorySchema,
} from './schemas.js';
import { createMemory, getMemory, listMemories, deleteMemory, getContext } from './handlers.js';

export default async function memoryRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, listMemories);
  fastify.get('/context', getContext);
  fastify.get('/:id', { schema: getMemorySchema }, getMemory);
  fastify.post('/', { schema: createMemorySchema }, createMemory);
  fastify.delete('/:id', { schema: deleteMemorySchema }, deleteMemory);
}
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npm test`
Expected: All existing tests pass. No 401 failures (basic auth is still active at app level).

- [ ] **Step 4: Commit**

```bash
git add src/app.ts src/routes/memories/index.ts
git commit -m "refactor: move basic auth to app level"
```

---

### Task 3: Register @fastify/view with Handlebars

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add view plugin registration to app.ts**

Import `@fastify/view` and register it after repository, before routes:

```typescript
import Fastify from 'fastify';
import basicAuth from '@fastify/basic-auth';
import view from '@fastify/view';
import handlebars from 'handlebars';
import errorHandlerPlugin from './plugins/error-handler.js';
import databasePlugin from './plugins/database.js';
import repositoryPlugin from './plugins/repository.js';
import memoryRoutes from './routes/memories/index.js';
import pageRoutes from './routes/pages/index.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(errorHandlerPlugin);
  await app.register(databasePlugin);
  await app.register(repositoryPlugin);

  await app.register(view, {
    engine: { handlebars },
    root: new URL('../templates', import.meta.url).pathname,
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

  await app.register(memoryRoutes, { prefix: '/memories' });
  await app.register(pageRoutes);

  return app;
}
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: All tests pass. The view plugin registration should not affect API tests.

- [ ] **Step 3: Commit**

```bash
git add src/app.ts
git commit -m "feat: register @fastify/view with handlebars"
```

---

### Task 4: Create templates directory and layout

**Files:**
- Create: `src/templates/layout.hbs`
- Create: `src/templates/memories.hbs`

- [ ] **Step 1: Create layout template**

Create `src/templates/layout.hbs`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Barnaby</title>
</head>
<body>
  <main>
    {{{body}}}
  </main>
</body>
</html>
```

- [ ] **Step 2: Create memories page template**

Create `src/templates/memories.hbs`:

```html
<h1>Memories</h1>

<form method="get" action="/">
  <label>
    Category:
    <select name="category">
      <option value="">All</option>
      <option value="appointment" {{#if filters.categoryAppointment}}selected{{/if}}>Appointment</option>
      <option value="note" {{#if filters.categoryNote}}selected{{/if}}>Note</option>
      <option value="todo" {{#if filters.categoryTodo}}selected{{/if}}>Todo</option>
      <option value="purchase" {{#if filters.categoryPurchase}}selected{{/if}}>Purchase</option>
    </select>
  </label>

  <label>
    Tags:
    <input type="text" name="tags" value="{{filters.tags}}" placeholder="comma-separated">
  </label>

  <button type="submit">Filter</button>
</form>

{{#if error}}
  <p style="color: red;">{{error}}</p>
{{/if}}

{{#if memories.length}}
  <ul>
    {{#each memories}}
      <li>
        <p>{{content}}</p>
        <p>Category: {{category}} | Created: {{createdAt}}{{#if permanent}} | Permanent{{/if}}</p>
        {{#if tags.length}}
          <p>Tags: {{#each tags}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}</p>
        {{/if}}
      </li>
    {{/each}}
  </ul>

  <nav>
    {{#if pagination.hasPrevious}}
      <a href="{{pagination.previousUrl}}">Previous</a>
    {{else}}
      <span>Previous</span>
    {{/if}}

    <span>Page {{pagination.page}} of {{pagination.totalPages}}</span>

    {{#if pagination.hasNext}}
      <a href="{{pagination.nextUrl}}">Next</a>
    {{else}}
      <span>Next</span>
    {{/if}}
  </nav>
{{else}}
  <p>No memories found.</p>
{{/if}}
```

- [ ] **Step 3: Commit**

```bash
git add src/templates/
git commit -m "feat: add handlebars templates for memories page"
```

---

### Task 5: Create page route handler

**Files:**
- Create: `src/routes/pages/index.ts`

- [ ] **Step 1: Create page route**

Create `src/routes/pages/index.ts`:

```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery } from '../../plugins/repository.js';

export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const page = Math.max(1, request.query.page || 1);
    const limit = Math.min(100, Math.max(1, request.query.limit || 20));

    const query = {
      page,
      limit,
      category: request.query.category,
      tags: request.query.tags,
    };

    const { data, total } = request.server.memoryRepository.findAll(query);

    const totalPages = Math.ceil(total / limit);

    const buildUrl = (targetPage: number) => {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(limit));
      if (query.category) params.set('category', query.category);
      if (query.tags) params.set('tags', query.tags);
      return '/?' + params.toString();
    };

    return reply.view('memories', {
      memories: data,
      filters: {
        category: query.category || '',
        categoryAppointment: query.category === 'appointment',
        categoryNote: query.category === 'note',
        categoryTodo: query.category === 'todo',
        categoryPurchase: query.category === 'purchase',
        tags: query.tags || '',
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
        previousUrl: buildUrl(page - 1),
        nextUrl: buildUrl(page + 1),
      },
    });
  });
}
```

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/routes/pages/index.ts
git commit -m "feat: add memories page route at /"
```

---

### Task 6: Write E2E tests for the page

**Files:**
- Create: `test/routes/pages.test.ts`

- [ ] **Step 1: Write the test file**

Create `test/routes/pages.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Memories Page', () => {
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
      method: 'GET',
      url: '/',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should return HTML with memories', async () => {
    // Seed a memory
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Test memory',
        category: 'note',
        tags: ['test'],
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Test memory');
    expect(response.payload).toContain('note');
    expect(response.payload).toContain('test');
  });

  it('should support pagination', async () => {
    // Create 25 memories to force pagination
    for (let i = 0; i < 25; i++) {
      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: `Memory ${i}`,
          category: 'note',
        },
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/?page=2&limit=10',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Page 2 of');
    expect(response.payload).toContain('Previous');
    expect(response.payload).toContain('Next');
  });

  it('should filter by category', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Buy milk',
        category: 'purchase',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/?category=purchase',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Buy milk');
    expect(response.payload).not.toContain('Test memory');
  });

  it('should filter by tags', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/?tags=test',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Test memory');
  });
});
```

- [ ] **Step 2: Run page tests**

Run: `npm test`
Expected: All tests pass, including the new page tests.

- [ ] **Step 3: Commit**

```bash
git add test/routes/pages.test.ts
git commit -m "test: add e2e tests for memories page"
```

---

### Task 7: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass with no failures.

- [ ] **Step 2: Manual smoke test (optional)**

Run: `npm start`
Visit `http://localhost:3000/` in a browser.
Expected: Browser prompts for basic auth. After entering credentials, the memories page loads.

- [ ] **Step 3: Final commit (if any changes)**

If any fixes were needed during verification, commit them.

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] App-level basic auth — Task 2
- [x] @fastify/view with Handlebars — Task 3
- [x] Route at `/` — Task 5
- [x] Layout template — Task 4
- [x] Memories template with filters, list, pagination — Task 4
- [x] Pagination preserves filters — Task 5
- [x] Full details displayed — Task 4
- [x] E2E tests — Task 6
- [x] No regression in API — Task 2 Step 3

**2. Placeholder scan:**
- [x] No "TBD", "TODO", or vague instructions
- [x] All code blocks contain complete, runnable code
- [x] All file paths are exact

**3. Type consistency:**
- [x] `ListMemoriesQuery` type reused from repository
- [x] `reply.view()` is the standard @fastify/view method
- [x] Template variable names match between route and template

## Gaps

None identified.
