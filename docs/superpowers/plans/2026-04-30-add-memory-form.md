# Add Memory Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an HTML form to the memories browsing page (`GET /`) that allows creating new memories via `POST /`, with validation matching the `POST /memories` API endpoint.

**Architecture:** Add a `POST /` handler to the existing page routes file that parses form data, validates using the shared `createMemorySchema`, creates the memory via `memoryRepository`, and redirects to `/`. On validation failure, it re-renders the page with an error. The form is added to the existing `memories.hbs` template.

**Tech Stack:** Fastify, Handlebars, better-sqlite3, vitest

---

### Task 1: Write failing tests for `POST /`

**Files:**
- Modify: `test/routes/pages.test.ts`

- [ ] **Step 1: Add test for successful form submission**

Add the following test inside the `describe('Memories Page', () => { ... })` block:

```ts
  it('should create a memory from form submission and redirect to root', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=Form+memory&category=note&tags=test%2C+tag',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });
    expect(getResponse.payload).toContain('Form memory');
  });
```

- [ ] **Step 2: Add test for validation failure re-render**

Add the following test inside the same `describe` block:

```ts
  it('should re-render page with error on invalid form submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=&category=note&tags=test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Add Memory');
  });
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `npx vitest run test/routes/pages.test.ts`

Expected: FAIL — `POST /` returns 404 because the route does not exist yet.

- [ ] **Step 4: Commit**

```bash
git add test/routes/pages.test.ts
git commit -m "test(pages): add failing tests for memory creation form"
```

---

### Task 2: Add creation form to `src/templates/memories.hbs`

**Files:**
- Modify: `src/templates/memories.hbs`

- [ ] **Step 1: Insert creation form markup**

Add the following block **directly after** line 3 (`<p>Browse Barnaby's stored memories.</p>`):

```html
<h4>Add Memory</h4>

<form method="post" action="/">
  <label>
    Content:
    <textarea name="content" required maxlength="2000">{{form.content}}</textarea>
  </label>

  <label>
    Category:
    <select name="category" required>
      <option value="">-- Select --</option>
      <option value="appointment" {{#if form.categoryAppointment}}selected{{/if}}>Appointment</option>
      <option value="note" {{#if form.categoryNote}}selected{{/if}}>Note</option>
      <option value="todo" {{#if form.categoryTodo}}selected{{/if}}>Todo</option>
      <option value="purchase" {{#if form.categoryPurchase}}selected{{/if}}>Purchase</option>
    </select>
  </label>

  <label>
    <input type="checkbox" name="permanent" value="on" {{#if form.permanent}}checked{{/if}}>
    Permanent
  </label>

  <label>
    Tags:
    <input type="text" name="tags" value="{{form.tags}}" placeholder="comma-separated">
  </label>

  <button type="submit">Add Memory</button>
</form>
```

- [ ] **Step 2: Commit**

```bash
git add src/templates/memories.hbs
git commit -m "feat(templates): add memory creation form to memories page"
```

---

### Task 3: Implement `POST /` handler in `src/routes/pages/index.ts`

**Files:**
- Modify: `src/routes/pages/index.ts`

- [ ] **Step 1: Update imports and extract shared view-model builder**

Replace the top of the file (lines 1–75) with the following refactored content. The `formatDate` helper is unchanged. A new `buildViewModel` helper is extracted so both `GET` and `POST` can reuse it.

```ts
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery, CreateMemoryBody } from '../../plugins/repository.js';
import { listMemoriesSchema, createMemorySchema } from '../memories/schemas.js';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const year = isToday ? '' : ` ${date.getFullYear()}`;

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${weekday} ${month} ${day}${year} ${hours}:${minutes}${ampm}`;
}

async function buildViewModel(
  fastify: FastifyInstance,
  query: ListMemoriesQuery,
  error?: string,
  form?: Record<string, unknown>
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const repoQuery = {
    page,
    limit,
    category: query.category,
    tags: query.tags,
  };

  const { data, total } = fastify.memoryRepository.findAll(repoQuery);

  const totalPages = Math.ceil(total / limit);

  const buildUrl = (targetPage: number) => {
    const params = new URLSearchParams();
    params.set('page', String(targetPage));
    params.set('limit', String(limit));
    if (repoQuery.category) params.set('category', repoQuery.category);
    if (repoQuery.tags) params.set('tags', repoQuery.tags);
    return '/?' + params.toString();
  };

  const memories = data.map((memory) => ({
    ...memory,
    formattedDate: formatDate(memory.createdAt),
  }));

  return {
    memories,
    filters: {
      category: repoQuery.category || '',
      categoryAppointment: repoQuery.category === 'appointment',
      categoryNote: repoQuery.category === 'note',
      categoryTodo: repoQuery.category === 'todo',
      categoryPurchase: repoQuery.category === 'purchase',
      tags: repoQuery.tags || '',
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
    error,
    form: form
      ? {
          content: form.content,
          category: form.category,
          permanent: form.permanent,
          tags: form.tags,
          categoryAppointment: form.category === 'appointment',
          categoryNote: form.category === 'note',
          categoryTodo: form.category === 'todo',
          categoryPurchase: form.category === 'purchase',
        }
      : undefined,
  };
}
```

- [ ] **Step 2: Replace the route handler block**

Replace the `export default async function pageRoutes(fastify: FastifyInstance) { ... }` block with:

```ts
export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const viewModel = await buildViewModel(fastify, request.query);
    return reply.view('memories', viewModel);
  });

  fastify.post('/', {
    schema: createMemorySchema,
    attachValidation: true,
    preValidation: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      if (typeof body.permanent === 'string') {
        body.permanent = body.permanent === 'on';
      }
      if (typeof body.tags === 'string') {
        body.tags = (body.tags as string)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    },
  }, async (request: FastifyRequest<{ Body: CreateMemoryBody }>, reply: FastifyReply) => {
    if (request.validationError) {
      const body = request.body as Record<string, unknown>;
      const viewModel = await buildViewModel(
        fastify,
        {},
        request.validationError.message,
        {
          content: body.content,
          category: body.category,
          permanent: body.permanent === true,
          tags: body.tags,
        }
      );
      return reply.view('memories', viewModel);
    }

    request.server.memoryRepository.create(request.body);
    return reply.redirect('/');
  });
}
```

- [ ] **Step 3: Run the full test suite for the pages route**

Run: `npx vitest run test/routes/pages.test.ts`

Expected: All tests PASS, including the two new ones.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/pages/index.ts
git commit -m "feat(pages): add POST / handler for memory creation form"
```

---

## Self-Review

**Spec coverage:**
- Form added to `memories.hbs` → Task 2
- `POST /` handler with same validation → Task 3 (uses `createMemorySchema`)
- Redirect on success → Task 3 (`reply.redirect('/')`)
- Re-render on failure with error and pre-filled values → Task 3 (`attachValidation: true` + `buildViewModel` with `error` and `form`)
- Tests → Task 1

**Placeholder scan:** None found. All steps contain exact code, commands, and expected output.

**Type consistency:** `CreateMemoryBody` is imported from the same location used by the API handlers. `preValidation` mutates `request.body` before schema validation runs. `buildViewModel` passes `form` fields that match the Handlebars conditionals in the template.
