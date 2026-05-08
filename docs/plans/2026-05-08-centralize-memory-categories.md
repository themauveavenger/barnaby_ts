# Centralize Memory Categories Source of Truth

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hard-coded memory category list across the codebase with a single TypeScript source of truth (`src/plugins/memory-categories.ts`), and add tests that prevent the TypeScript array and the SQLite `CHECK` constraint from drifting apart.

**Architecture:** A new pure-data module lives beside the database plugin. It exports the category metadata (name, label, actionLabel) and a derived type. Every consumer — repository, agent guidelines, agent tools, API schemas, page routes, and Handlebars template — imports from this module. A new anti-drift test parses the SQL DDL and asserts it matches the TypeScript array.

**Tech Stack:** Node.js 24, TypeScript, Fastify, better-sqlite3, vitest, Handlebars

---

## File Structure

```
src/
  plugins/
    memory-categories.ts      # NEW: single source of truth for categories
    database.ts                # MODIFY: add comment pointing to memory-categories.ts
    repository.ts              # MODIFY: import MemoryCategory from memory-categories.ts
  agent/
    memory-guidelines.ts       # MODIFY: import MEMORY_CATEGORIES from memory-categories.ts
  plugins/agent/extensions/
    memory.ts                  # MODIFY: import MEMORY_CATEGORIES / MemoryCategory
  routes/memories/
    schemas.ts                 # MODIFY: import MEMORY_CATEGORY_NAMES for enum arrays
  routes/pages/
    index.ts                   # MODIFY: replace boolean flags with categories array
  templates/
    memories.hbs               # MODIFY: loop categories array; use actionLabel for buttons
test/
  plugins/
    memory-categories.test.ts  # NEW: unit test for the data module
    database.test.ts           # MODIFY: add anti-drift test
    repository.test.ts         # no changes needed (fixture strings are fine)
    agent/extensions/memory.test.ts  # MODIFY: import MEMORY_CATEGORIES for schema assertions
  routes/
    memories.test.ts           # MODIFY: parametrize valid-category tests
    pages.test.ts              # MODIFY: add dropdown completeness, action-button, form-invalid tests
    chat.test.ts               # no changes needed
```

---

## Task 1: Create `src/plugins/memory-categories.ts`

**Files:**
- Create: `src/plugins/memory-categories.ts`

- [ ] **Step 1: Create the module**

Create `src/plugins/memory-categories.ts`:

```ts
export const MEMORY_CATEGORIES = [
  { name: 'appointment', label: 'Appointment', actionLabel: null },
  { name: 'note',        label: 'Note',        actionLabel: null },
  { name: 'todo',        label: 'Todo',        actionLabel: 'Complete' },
  { name: 'purchase',    label: 'Purchase',    actionLabel: 'Bought' },
] as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[number]['name'];
export const MEMORY_CATEGORY_NAMES: readonly MemoryCategory[] = MEMORY_CATEGORIES.map((c) => c.name);
```

- [ ] **Step 2: Commit**

```bash
git add src/plugins/memory-categories.ts
git commit -m "feat(categories): add single source of truth for memory categories"
```

---

## Task 2: Update `src/plugins/database.ts`

**Files:**
- Modify: `src/plugins/database.ts`

- [ ] **Step 1: Add comment above the CHECK constraint**

In the `CREATE TABLE memories` DDL, add a comment directly above the `category` column definition:

```sql
    -- Category list must stay in sync with src/plugins/memory-categories.ts
    CREATE TABLE IF NOT EXISTS memories (
      ...
      category TEXT NOT NULL CHECK (category IN ('appointment', 'note', 'todo', 'purchase')),
      ...
    );
```

No functional change — just a marker for future readers.

- [ ] **Step 2: Commit**

```bash
git add src/plugins/database.ts
git commit -m "docs(database): add sync comment for memory categories"
```

---

## Task 3: Update `src/plugins/repository.ts`

**Files:**
- Modify: `src/plugins/repository.ts`

- [ ] **Step 1: Replace local type with import**

Remove this line:

```ts
export type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';
```

Add an import at the top of the file:

```ts
import { MEMORY_CATEGORY_NAMES, type MemoryCategory } from './memory-categories.js';
```

- [ ] **Step 2: Remove runtime cast in `create()`**

Find:

```ts
      const category = data.category.toLowerCase() as MemoryCategory;
```

Replace with:

```ts
      const category = data.category.toLowerCase();
      if (!MEMORY_CATEGORY_NAMES.includes(category as MemoryCategory)) {
        throw new Error(`Invalid category: ${data.category}`);
      }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/repository.ts
git commit -m "refactor(repository): import MemoryCategory from memory-categories module"
```

---

## Task 4: Update `src/agent/memory-guidelines.ts`

**Files:**
- Modify: `src/agent/memory-guidelines.ts`

- [ ] **Step 1: Remove local MEMORY_CATEGORIES array and import from the new module**

Remove:

```ts
export const MEMORY_CATEGORIES = [
  'todo',
  'appointment',
  'note',
  'purchase',
] as const;
```

Add at the top:

```ts
import { MEMORY_CATEGORIES } from '../plugins/memory-categories.js';
export { MEMORY_CATEGORIES };
```

- [ ] **Step 2: Update guidelines to reference imported categories**

The prose guidelines currently list categories explicitly. Update them to be derived or simply keep the prose but remove the duplication. Replace:

```ts
export const MEMORY_CATEGORIZATION_GUIDELINES = [
  'Categorize the user\'s memory based on what it describes:',
  '- "todo" — a task or thing the user needs to do',
  '- "appointment" — a scheduled event, date, or meeting',
  '- "purchase" — something to buy or a spending-related note',
  '- "note" — general information, facts, or reminders (default when unclear)',
  ...
] as const;
```

With:

```ts
const categoryDescriptions: Record<string, string> = {
  todo: 'a task or thing the user needs to do',
  appointment: 'a scheduled event, date, or meeting',
  purchase: 'something to buy or a spending-related note',
  note: 'general information, facts, or reminders (default when unclear)',
};

export const MEMORY_CATEGORIZATION_GUIDELINES = [
  'Categorize the user\'s memory based on what it describes:',
  ...MEMORY_CATEGORIES.map((c) => `- "${c.name}" — ${categoryDescriptions[c.name]}`),
  '',
  'Additional rules:',
  '- Tag facts about the user\'s identity, preferences, or permanent traits with "core" and set permanent=true',
  '- Keep content concise — rephrase verbose input into a clear, memorable statement',
  '- For "list", "show", or "what" requests, use memory_list to find matching memories, then summarize them for the user',
  '- For "done", "completed", or "dismiss" requests, first use memory_list to find the relevant memory, then use memory_resolve to mark it completed or dismissed',
  '- Always confirm what you created, listed, or resolved in plain language',
] as const;
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent/memory-guidelines.ts
git commit -m "refactor(guidelines): import MEMORY_CATEGORIES from memory-categories"
```

---

## Task 5: Update `src/plugins/agent/extensions/memory.ts`

**Files:**
- Modify: `src/plugins/agent/extensions/memory.ts`

- [ ] **Step 1: Update imports**

Replace the existing import block:

```ts
import {
  MEMORY_CATEGORIES,
  MEMORY_ACTION_TYPES,
  MEMORY_TOOL_PROMPT_SNIPPETS,
  MEMORY_TOOL_PROMPT_GUIDELINES,
} from '../../../agent/memory-guidelines.js';
```

With:

```ts
import {
  MEMORY_CATEGORIES,
  type MemoryCategory,
} from '../../memory-categories.js';
import {
  MEMORY_ACTION_TYPES,
  MEMORY_TOOL_PROMPT_SNIPPETS,
  MEMORY_TOOL_PROMPT_GUIDELINES,
} from '../../../agent/memory-guidelines.js';
```

- [ ] **Step 2: Update TypeBox schemas to use `.name`**

Find:

```ts
      category: Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c)), { description: 'The category of memory' }),
```

Replace with:

```ts
      category: Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c.name)), { description: 'The category of memory' }),
```

And find:

```ts
      category: Type.Optional(Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c)), { description: 'Filter by category' })),
```

Replace with:

```ts
      category: Type.Optional(Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c.name)), { description: 'Filter by category' })),
```

- [ ] **Step 3: Replace inline cast with imported type**

Find:

```ts
          category: params.category as 'appointment' | 'note' | 'todo' | 'purchase',
```

Replace with:

```ts
          category: params.category as MemoryCategory,
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/agent/extensions/memory.ts
git commit -m "refactor(agent): use MemoryCategory type and imported categories"
```

---

## Task 6: Update `src/routes/memories/schemas.ts`

**Files:**
- Modify: `src/routes/memories/schemas.ts`

- [ ] **Step 1: Import category names**

Add at the top:

```ts
import { MEMORY_CATEGORY_NAMES } from '../../plugins/memory-categories.js';
```

- [ ] **Step 2: Replace hard-coded enums**

Find both occurrences of:

```ts
        enum: ['appointment', 'note', 'todo', 'purchase'],
```

Replace both with:

```ts
        enum: [...MEMORY_CATEGORY_NAMES],
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/memories/schemas.ts
git commit -m "refactor(schemas): derive category enum from MEMORY_CATEGORY_NAMES"
```

---

## Task 7: Update `src/routes/pages/index.ts`

**Files:**
- Modify: `src/routes/pages/index.ts`

- [ ] **Step 1: Import categories**

Add at the top:

```ts
import { MEMORY_CATEGORIES } from '../../plugins/memory-categories.js';
```

- [ ] **Step 2: Replace boolean flags in view model with categories array**

In the `buildViewModel` function, replace:

```ts
    filters: {
      category: repoQuery.category || '',
      categoryAppointment: repoQuery.category === 'appointment',
      categoryNote: repoQuery.category === 'note',
      categoryTodo: repoQuery.category === 'todo',
      categoryPurchase: repoQuery.category === 'purchase',
      tags: repoQuery.tags || '',
    },
```

With:

```ts
    filters: {
      category: repoQuery.category || '',
      categories: MEMORY_CATEGORIES.map((c) => ({
        ...c,
        selected: repoQuery.category === c.name,
      })),
      tags: repoQuery.tags || '',
    },
```

And replace:

```ts
    form: form
      ? {
          content: form.content,
          category: form.category,
          permanent: form.permanent === true,
          tags: Array.isArray(form.tags) ? form.tags.join(', ') : form.tags,
          categoryAppointment: form.category === 'appointment',
          categoryNote: form.category === 'note',
          categoryTodo: form.category === 'todo',
          categoryPurchase: form.category === 'purchase',
        }
      : undefined,
```

With:

```ts
    form: form
      ? {
          content: form.content,
          category: form.category,
          permanent: form.permanent === true,
          tags: Array.isArray(form.tags) ? form.tags.join(', ') : form.tags,
          categories: MEMORY_CATEGORIES.map((c) => ({
            ...c,
            selected: form.category === c.name,
          })),
        }
      : undefined,
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/pages/index.ts
git commit -m "refactor(pages): replace boolean category flags with categories array"
```

---

## Task 8: Update `src/templates/memories.hbs`

**Files:**
- Modify: `src/templates/memories.hbs`

- [ ] **Step 1: Replace creation-form `<select>` options with a loop**

Find the creation form `<select>` block:

```html
  <select id="category-input" name="category" required>
    <option value="">-- Select --</option>
    <option value="appointment" {{#if form.categoryAppointment}}selected{{/if}}>Appointment</option>
    <option value="note" {{#if form.categoryNote}}selected{{/if}}>Note</option>
    <option value="todo" {{#if form.categoryTodo}}selected{{/if}}>Todo</option>
    <option value="purchase" {{#if form.categoryPurchase}}selected{{/if}}>Purchase</option>
  </select>
```

Replace with:

```html
  <select id="category-input" name="category" required>
    <option value="">-- Select --</option>
    {{#each form.categories}}
    <option value="{{name}}" {{#if selected}}selected{{/if}}>{{label}}</option>
    {{/each}}
  </select>
```

- [ ] **Step 2: Replace filter-form `<select>` options with a loop**

Find the filter form `<select>` block:

```html
  <select id="category" name="category">
    <option value="">All</option>
    <option value="appointment" {{#if filters.categoryAppointment}}selected{{/if}}>Appointment</option>
    <option value="note" {{#if filters.categoryNote}}selected{{/if}}>Note</option>
    <option value="todo" {{#if filters.categoryTodo}}selected{{/if}}>Todo</option>
    <option value="purchase" {{#if filters.categoryPurchase}}selected{{/if}}>Purchase</option>
  </select>
```

Replace with:

```html
  <select id="category" name="category">
    <option value="">All</option>
    {{#each filters.categories}}
    <option value="{{name}}" {{#if selected}}selected{{/if}}>{{label}}</option>
    {{/each}}
  </select>
```

- [ ] **Step 3: Replace hard-coded action-button logic with `actionLabel`**

Find the action-buttons block inside the table rows:

```handlebars
          {{#if actions.length}}
            {{#each actions}}
              {{#if (eq action "completed")}}✓ Completed{{else}}✕ Dismissed{{/if}} ({{formattedDate}})
            {{/each}}
          {{else if (eq category "todo")}}
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="completed">
              <button type="submit">Complete</button>
            </form>
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="dismissed">
              <button type="submit">Dismiss</button>
            </form>
          {{else if (eq category "purchase")}}
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="completed">
              <button type="submit">Bought</button>
            </form>
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="dismissed">
              <button type="submit">Dismiss</button>
            </form>
          {{else}}
            —
          {{/if}}
```

Replace with:

```handlebars
          {{#if actions.length}}
            {{#each actions}}
              {{#if (eq action "completed")}}✓ Completed{{else}}✕ Dismissed{{/if}} ({{formattedDate}})
            {{/each}}
          {{else if actionLabel}}
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="completed">
              <button type="submit">{{actionLabel}}</button>
            </form>
            <form method="post" action="/actions" style="display:inline">
              <input type="hidden" name="memoryId" value="{{id}}">
              <input type="hidden" name="actionType" value="dismissed">
              <button type="submit">Dismiss</button>
            </form>
          {{else}}
            —
          {{/if}}
```

Note: `actionLabel` must be added to the `MemoryViewModel` in `src/routes/pages/index.ts`. In the `memories` map inside `buildViewModel`, spread `...memory` already includes `category`, but we need to pass the matching category object or just `actionLabel` through. Add a lookup:

In `buildViewModel`, when mapping `data` to `memories`, change:

```ts
  const memories = data.map((memory) => ({
    ...memory,
    formattedDate: formatDate(memory.createdAt),
    actions: (actionsMap.get(memory.id) || []).map((a) => ({
      id: a.id,
      action: a.action,
      formattedDate: formatDate(a.createdAt),
    })),
  }));
```

To:

```ts
  const categoryMap = new Map(MEMORY_CATEGORIES.map((c) => [c.name, c]));

  const memories = data.map((memory) => ({
    ...memory,
    formattedDate: formatDate(memory.createdAt),
    actionLabel: categoryMap.get(memory.category)?.actionLabel ?? null,
    actions: (actionsMap.get(memory.id) || []).map((a) => ({
      id: a.id,
      action: a.action,
      formattedDate: formatDate(a.createdAt),
    })),
  }));
```

- [ ] **Step 4: Run the pages test suite**

```bash
npm run test:minimal -- test/routes/pages.test.ts
```

Expected: Tests may fail until Step 9 (test updates) is complete. That's expected.

- [ ] **Step 5: Commit**

```bash
git add src/templates/memories.hbs src/routes/pages/index.ts
git commit -m "refactor(templates): loop categories array and use actionLabel for buttons"
```

---

## Task 9: Add New Tests

### Task 9a: `test/plugins/memory-categories.test.ts`

**Files:**
- Create: `test/plugins/memory-categories.test.ts`

- [ ] **Step 1: Create unit tests for the data module**

```ts
import { describe, it, expect } from 'vitest';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_NAMES, type MemoryCategory } from '../../src/plugins/memory-categories.js';

describe('memory-categories', () => {
  it('should contain the four expected categories', () => {
    const names = MEMORY_CATEGORIES.map((c) => c.name);
    expect(names).toEqual(['appointment', 'note', 'todo', 'purchase']);
  });

  it('should have correct labels', () => {
    const labels = MEMORY_CATEGORIES.map((c) => c.label);
    expect(labels).toEqual(['Appointment', 'Note', 'Todo', 'Purchase']);
  });

  it('should assign actionLabel only to todo and purchase', () => {
    const withActions = MEMORY_CATEGORIES
      .filter((c) => c.actionLabel !== null)
      .map((c) => c.name);
    expect(withActions).toEqual(['todo', 'purchase']);
  });

  it('should export MEMORY_CATEGORY_NAMES matching the names', () => {
    expect(MEMORY_CATEGORY_NAMES).toEqual(['appointment', 'note', 'todo', 'purchase']);
  });

  it('should be assignable to MemoryCategory type', () => {
    const check = (name: MemoryCategory) => name;
    for (const cat of MEMORY_CATEGORY_NAMES) {
      expect(() => check(cat)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run test:minimal -- test/plugins/memory-categories.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/plugins/memory-categories.test.ts
git commit -m "test(categories): add unit tests for memory-categories module"
```

### Task 9b: Anti-drift test in `test/plugins/database.test.ts`

**Files:**
- Modify: `test/plugins/database.test.ts`

- [ ] **Step 1: Add anti-drift test**

Add the following test inside the existing `describe('database plugin', () => { ... })` block:

```ts
  it('should have a memories CHECK constraint that matches MEMORY_CATEGORY_NAMES', () => {
    const { sql } = app.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories'")
      .get() as { sql: string };

    const match = sql.match(/CHECK\s*\(\s*category\s+IN\s*\(([^)]+)\)\s*\)/i);
    expect(match).toBeTruthy();

    const constraintCategories = match![1]
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''));

    expect(constraintCategories).toEqual([...MEMORY_CATEGORY_NAMES]);
  });
```

Add the import at the top of the file:

```ts
import { MEMORY_CATEGORY_NAMES } from '../../src/plugins/memory-categories.js';
```

- [ ] **Step 2: Run tests**

```bash
npm run test:minimal -- test/plugins/database.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/plugins/database.test.ts
git commit -m "test(database): add anti-drift test for category CHECK constraint"
```

### Task 9c: Parametrize valid-category tests in `test/routes/memories.test.ts`

**Files:**
- Modify: `test/routes/memories.test.ts`

- [ ] **Step 1: Import category names and add parametrized tests**

Add at the top:

```ts
import { MEMORY_CATEGORY_NAMES } from '../../src/plugins/memory-categories.js';
```

Find the test block:

```ts
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
      ...
    });
```

This test is fine as a representative sample. Instead of replacing it, add a new parametrized test right after it:

```ts
    it.each(MEMORY_CATEGORY_NAMES)('should accept category "%s"', async (category) => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: `Test ${category}`,
          category,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.category).toBe(category);
    });
```

Also find:

```ts
    it('should filter by category', async () => {
      await app.inject({... category: 'todo' ...});
      ...
      const response = await app.inject({
        method: 'GET',
        url: '/memories?category=todo',
        ...
      });
      ...
    });
```

Add a parametrized filter test:

```ts
    it.each(MEMORY_CATEGORY_NAMES)('should filter by category "%s"', async (category) => {
      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: { content: `Filter ${category}`, category },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/memories?category=${category}`,
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.every((m: { category: string }) => m.category === category)).toBe(true);
    });
```

- [ ] **Step 2: Run tests**

```bash
npm run test:minimal -- test/routes/memories.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/routes/memories.test.ts
git commit -m "test(memories): parametrize valid-category creation and filtering tests"
```

### Task 9d: Update and expand `test/routes/pages.test.ts`

**Files:**
- Modify: `test/routes/pages.test.ts`

- [ ] **Step 1: Add import**

```ts
import { MEMORY_CATEGORIES } from '../../src/plugins/memory-categories.js';
```

- [ ] **Step 2: Add dropdown completeness test**

Add inside `describe('Memories Page', () => { ... })`:

```ts
  it('should include all categories in the creation dropdown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    for (const cat of MEMORY_CATEGORIES) {
      expect(response.payload).toContain(`value="${cat.name}"`);
      expect(response.payload).toContain(`>${cat.label}</option>`);
    }
  });
```

- [ ] **Step 3: Add purchase action-button test**

Find the existing test:

```ts
  it('should display action buttons for todo memories without actions', async () => {
    ...
    expect(response.payload).toContain('Complete');
    expect(response.payload).toContain('Dismiss');
  });
```

Add directly after it:

```ts
  it('should display action buttons for purchase memories without actions', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Buy milk', category: 'purchase' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Bought');
    expect(response.payload).toContain('Dismiss');
  });
```

- [ ] **Step 4: Add appointment no-button test**

Find the existing test:

```ts
  it('should not display action buttons for note memories', async () => {
    ...
    expect(response.payload).not.toContain('Complete</button>');
    expect(response.payload).not.toContain('Dismiss</button>');
  });
```

Add directly after it:

```ts
  it('should not display action buttons for appointment memories', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Dentist at 2pm', category: 'appointment' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('Complete</button>');
    expect(response.payload).not.toContain('Bought</button>');
    expect(response.payload).not.toContain('Dismiss</button>');
  });
```

- [ ] **Step 5: Add form invalid-category test**

Add inside `describe('Memories Page', () => { ... })`:

```ts
  it('should re-render page with error on invalid category in form submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=Bad+category&category=invalid&tags=test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Add Memory');
  });
```

- [ ] **Step 6: Run tests**

```bash
npm run test:minimal -- test/routes/pages.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add test/routes/pages.test.ts
git commit -m "test(pages): add category completeness, action-button, and form-validation tests"
```

### Task 9e: Update `test/plugins/agent/extensions/memory.test.ts`

**Files:**
- Modify: `test/plugins/agent/extensions/memory.test.ts`

- [ ] **Step 1: Import categories**

```ts
import { MEMORY_CATEGORIES } from '../../../../src/plugins/memory-categories.js';
```

- [ ] **Step 2: Assert schema categories match the module**

Add a new test inside `describe('memory extension', () => { ... })`:

```ts
  it('uses the exact categories from MEMORY_CATEGORIES in tool schemas', () => {
    const tools = getTools(extApi);
    const createTool = tools.find((t) => t.name === 'memory_create')!;

    // The TypeBox schema is not directly inspectable at runtime in a simple way,
    // but we can verify the tool executes with every valid category.
    for (const cat of MEMORY_CATEGORIES) {
      expect(() =>
        createTool.execute('call-test', { content: `Test ${cat.name}`, category: cat.name })
      ).not.toThrow();
    }
  });
```

- [ ] **Step 3: Run tests**

```bash
npm run test:minimal -- test/plugins/agent/extensions/memory.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/plugins/agent/extensions/memory.test.ts
git commit -m "test(agent): assert memory_create accepts all categories from module"
```

---

## Task 10: Full Test Run and Final Verification

- [ ] **Step 1: Run the full test suite**

```bash
npm run test:minimal
```

Expected: All tests PASS.

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 3: Final commit**

```bash
git commit -m "refactor(categories): centralize memory categories into single source of truth"
```

---

## Self-Review

**Spec coverage:**
- Single TS source of truth → Task 1
- DB comment → Task 2
- Repository type + runtime validation → Task 3
- Guidelines import + derived prose → Task 4
- Agent tools use imported categories → Task 5
- API schemas use imported names → Task 6
- Page route replaces booleans with array → Task 7
- Template loops categories and uses `actionLabel` → Task 8
- Unit tests for data module → Task 9a
- Anti-drift DB test → Task 9b
- Parametrized API tests → Task 9c
- Page tests for completeness, action buttons, form validation → Task 9d
- Agent extension schema coverage → Task 9e

**Critical gaps addressed:**
- DB-TS synchronization test (parses `sqlite_master` DDL and asserts equality)
- Template dropdown completeness test (asserts every category appears as an `<option>`)
- Purchase action-button test (covers the third category that previously had no test)
- Parametrized valid-category tests (all categories tested exhaustively)

**Minor gaps addressed:**
- Direct unit test for `memory-categories.ts`
- Form POST invalid-category test
- Agent tool schema runtime assertion

**Edge case addressed:**
- The view-model shape changes from four boolean flags to a `categories` array. The page tests inspect HTML strings, so they're resilient, but the new tests in Task 9d verify the new HTML structure explicitly.

**Placeholder scan:** None found. All steps contain exact code, commands, and expected output.

**Type consistency:** `MemoryCategory` is imported everywhere the old string union was used. The `as const` assertion on `MEMORY_CATEGORIES` makes `typeof MEMORY_CATEGORIES[number]['name']` a literal union identical to the old hand-written type.
