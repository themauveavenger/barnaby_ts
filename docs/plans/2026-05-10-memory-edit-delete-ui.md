# Memory Edit & Delete UI

**Date:** 2026-05-10

## Goal

Add inline editing and deletion of memories via the web UI, using proper RESTful
API verbs (PATCH/DELETE) with JavaScript `fetch()` on a dedicated edit page.

## Background

Memories can currently only be created and browsed via the web UI. The API has
`DELETE /memories/:id` but no PATCH/update. `GET /memories/:id` returns JSON —
nothing consumes it outside the test suite (it was for debugging), so it will be
repurposed as the edit page.

## Routes

| Route              | Method | Layer | Purpose                                      |
|--------------------|--------|-------|----------------------------------------------|
| `/`                | GET    | Page  | List/browse memories (existing, add edit links) |
| `/memories/new`    | GET    | Page  | Create form (existing)                       |
| `/memories/new`    | POST   | Page  | Handle create form (existing)                |
| `/memories/:id`    | GET    | Page  | Edit page for a single memory (**new**, replaces JSON endpoint) |
| `/memories/:id`    | PATCH  | API   | Update memory (JSON, **new**)                |
| `/memories/:id`    | DELETE | API   | Delete memory (JSON, existing)                |
| `/actions`         | POST   | Page  | Complete/dismiss action (existing)            |
| `/memories`        | GET    | API   | List memories (existing)                      |
| `/memories`        | POST   | API   | Create memory (existing)                      |
| `/memories/context`| GET    | API   | Context memories (existing)                   |

`GET /memories/:id` is removed as a JSON API endpoint. The only consumer was the
test suite.

## API: `PATCH /memories/:id`

Accepts JSON with optional fields:

```json
{ "content": "updated text", "tags": ["food", "groceries"] }
```

Both fields are optional (partial update). At least one must be present (enforced
in handler). Returns the updated memory as JSON. 404 if not found.

### Schema

```ts
export const updateMemorySchema = {
  params: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
    required: ['id'],
  },
  body: {
    type: 'object',
    properties: {
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      tags: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
  },
};
```

## Page: `GET /memories/:id`

Renders `memories/edit.hbs`. The template includes:

- `<textarea>` for content
- `<input>` for tags (comma-separated, like the create form)
- Category and permanent displayed as read-only text (not editable in scope)
- "Save" button → JS `fetch()` sends `PATCH /memories/:id`
- "🗑️ Delete" button → JS `fetch()` sends `DELETE /memories/:id`
- "Cancel" link back to `/?<filters>` (preserving filter state)
- Error display area for failed PATCH/DELETE responses

### JavaScript behavior

The `<script>` block in the template intercepts form submit and delete click:

- **PATCH success** → `window.location.href = '/?<filters>#memory-<id>'`
- **DELETE success** → `window.location.href = '/?<filters>'`
- **Error** → display error message in `<p id="error-msg">`

Auth is handled automatically by the browser (Basic Auth cookies/credentials on
same-origin requests).

### View model

```ts
type EditMemoryViewModel = {
  id: string;
  content: string;
  category: string;
  tags: string;        // comma-joined for the input field
  permanent: boolean;
  returnUrl: string;   // e.g., "/?category=todo&page=2"
};
```

Filter state (category, tags, page) is passed via query params to
`GET /memories/:id?category=...&tags=...&page=...` and forwarded to the
template as `returnUrl`.

## Page: `GET /` (list) changes

- Each `<tr>` gets `id="memory-<uuid>"` for anchor scrolling
- New "Actions" column header in the table
- Each row gets an ✏️ link: `<a href="/memories/<id>?category=...&tags=...&page=...">✏️</a>`
- Existing Complete/Dismiss action forms remain

## Repository: `update()`

```ts
update(id: string, data: { content?: string; tags?: string[] }): Memory;
```

- If `content` provided → update with trimmed value; if absent → keep existing
- If `tags` provided → replace tag set entirely (normalize, deduplicate,
  same as `create`); if absent → keep existing
- Transactional: content update + tag unlink/relink in one `db.transaction()`
- Returns updated memory via `findById(id)`
- Handler maps "not found" to 404

## Files to Add/Change

| File                                  | Action | Detail |
|---------------------------------------|--------|--------|
| `src/templates/memories/edit.hbs`     | Create | Edit page with form + inline JS for PATCH/DELETE |
| `src/templates/memories/index.hbs`    | Edit   | Add `id` to rows, add ✏️ edit links, add Actions column |
| `src/routes/pages/index.ts`           | Edit   | Add `GET /memories/:id` handler, extend view model types |
| `src/routes/memories/handlers.ts`     | Edit   | Add `updateMemory` handler |
| `src/routes/memories/schemas.ts`      | Edit   | Add `updateMemorySchema`, remove `getMemorySchema` |
| `src/routes/memories/index.ts`        | Edit   | Replace `GET /:id` with page route, add `PATCH /:id` API route |
| `src/plugins/repository.ts`           | Edit   | Add `update()` to interface + implementation |
| `test/routes/pages.test.ts`           | Edit   | Add tests for edit page, edit links on list page |
| `test/routes/memories.test.ts`        | Edit   | Remove `GET /memories/:id` JSON tests, add `PATCH /memories/:id` tests |
| `test/plugins/repository.test.ts`     | Edit   | Add tests for `update()` |

## Testing Strategy

### Repository tests (`test/plugins/repository.test.ts`)

- `update` changes content only
- `update` changes tags only
- `update` changes both content and tags
- `update` replaces tags entirely (not merges)
- `update` normalizes/deduplicates tags (same behavior as `create`)
- `update` trims content whitespace
- `update` on nonexistent ID throws
- `update` with empty tags array clears all tags

### API tests (`test/routes/memories.test.ts`)

- Remove `GET /memories/:id` JSON endpoint tests (no longer an API route)
- `PATCH /memories/:id` with `{ content }` updates content only
- `PATCH /memories/:id` with `{ tags }` updates tags only
- `PATCH /memories/:id` with both updates both
- `PATCH /memories/:id` returns updated memory as JSON
- `PATCH /memories/:id` on nonexistent ID returns 404
- `PATCH /memories/:id` with empty body returns 400
- `PATCH /memories/:id` with content exceeding 2000 chars returns 400
- Existing `DELETE /memories/:id` tests continue to pass

### Page tests (`test/routes/pages.test.ts`)

- `GET /memories/:id` returns 200 with edit form HTML
- `GET /memories/:id` includes current memory content and tags
- `GET /memories/:id` for nonexistent ID returns 404
- `GET /memories/:id` includes return URL with filter params
- `GET /` rows have `id="memory-<uuid>"` attributes
- `GET /` includes ✏️ edit links per row
- `GET /` edit link includes current filter params

## Order of Implementation

1. Add `update()` to `MemoryRepository` interface + implementation
2. Add repository tests for `update()`
3. Add `updateMemorySchema` to schemas, remove `getMemorySchema`
4. Add `updateMemory` handler + register `PATCH /:id` route
5. Remove `GET /:id` API route (replace `getMemory` registration with page route)
6. Update API tests: remove `GET /memories/:id` tests, add `PATCH` tests
7. Create `memories/edit.hbs` template
8. Update `memories/index.hbs` — add row IDs, edit links, Actions column
9. Add `GET /memories/:id` page handler in `routes/pages/index.ts`
10. Add page tests
11. Run `npm run test:minimal`