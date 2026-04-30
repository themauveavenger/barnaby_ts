# Core Memory Context Injection — Design Document

**Date:** 2026-04-30
**Project:** Barnaby
**Scope:** Inject permanent memories tagged with `core` into every chat prompt so Barnaby has baseline knowledge about the user.

---

## 1. Overview

Barnaby is a personal digital assistant backed by a Fastify REST API and SQLite. Memories are stored with a `permanent` flag and tags. This design extends the chat handler to automatically fetch all permanent memories tagged with `core` and inject them into the LLM prompt as structured context.

No new tables or endpoints are introduced. The existing `memories`, `tags`, and `memory_tags` schema is sufficient.

---

## 2. Data Model

### 2.1 SQLite Schema

No schema changes. Core memories are regular memories with:

- `permanent = 1`
- a `core` tag in `memory_tags`

Example memory row:

| id | content | category | permanent | created_at |
|---|---|---|---|---|
| `abc123` | `The user is vegetarian.` | `note` | `1` | `1714500000000` |

Tags for this memory:

| name |
|---|
| `core` |
| `preference` |
| `food` |

### 2.2 Pre-populated Tags

On startup, the database plugin inserts a default set of tags if they do not already exist. This encourages consistency and gives the user a hint of what is available.

```sql
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
```

These are inserted after the `tags` table is created in the migration, inside the same migration block.

---

## 3. Prompt Assembly

### 3.1 Current Behavior

In `src/routes/chat/handlers.ts`, the prompt is assembled as:

```typescript
const today = new Date().toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
});
const prompt = [`Today is ${today}.`, '', request.body.message].join('\n');
```

### 3.2 New Behavior

The chat handler fetches core memories from the repository and injects them into the prompt before the user's message.

```typescript
const coreMemories = request.server.memoryRepository.findByTags(['core'], { permanentOnly: true });

const coreContext = coreMemories.length > 0
  ? ['Core memories about the user:', ...coreMemories.map(m => `- ${m.content}`)].join('\n')
  : '';

const prompt = [
  `Today is ${today}.`,
  '',
  coreContext,
  '',
  request.body.message,
].filter(Boolean).join('\n');
```

**Key decisions:**
- Core memories are fetched fresh on every request.
- Rendered as a simple bulleted list so the model can reference them naturally.
- If no core memories exist, the context section is omitted entirely to keep the prompt clean.

---

## 4. Repository Enhancement

### 4.1 New Method: `findByTags`

Added to the `MemoryRepository` interface:

```typescript
findByTags(tags: string[], options?: { permanentOnly?: boolean }): Memory[];
```

### 4.2 Implementation Notes

- Query `memories` joined with `memory_tags` and `tags`.
- Filter by tag names: a memory must have **all** specified tags (AND logic).
- If `permanentOnly` is true, additionally filter by `memories.permanent = 1`.
- Order results by `created_at DESC`.
- Return full `Memory` objects with resolved tag arrays.

### 4.3 SQL Sketch

```sql
SELECT m.*, GROUP_CONCAT(t.name) as tag_list
FROM memories m
JOIN memory_tags mt ON m.id = mt.memory_id
JOIN tags t ON mt.tag_id = t.id
WHERE t.name IN (?, ?, ...)
  AND m.permanent = 1
GROUP BY m.id
HAVING COUNT(DISTINCT t.name) = ?
ORDER BY m.created_at DESC;
```

Note: The `HAVING` clause ensures the memory has **all** requested tags, not just any of them.

---

## 5. API Changes

No new API endpoints. Only internal changes:

- `src/routes/chat/handlers.ts` — injects core memory context into the prompt.
- `src/plugins/repository.ts` — adds `findByTags` method.
- `src/plugins/database.ts` — inserts pre-populated tags on startup.

---

## 6. Testing Strategy

### 6.1 Repository Tests

- `findByTags(['core'], { permanentOnly: true })` returns only permanent memories tagged with `core`.
- `findByTags(['core', 'family'])` returns memories that have **both** tags.
- `findByTags(['nonexistent'])` returns an empty array.
- Memories without `core` tag are excluded.
- Non-permanent memories with `core` tag are excluded when `permanentOnly: true`.

### 6.2 Handler Tests

- Chat request with core memories present includes a bulleted list in the prompt.
- Chat request with no core memories omits the context section entirely.
- The `Today is ...` line is still present in all cases.
- The user's message is always the final part of the prompt.

### 6.3 E2E Regression

- Existing chat behavior is unchanged when no core memories exist.
- Existing memory CRUD endpoints are unaffected.

---

## 7. Decisions & Rationale

| Decision | Rationale |
|---|---|
| Reuse existing `permanent` flag + tags | No new tables, concepts, or migration complexity. The flag already exists for exactly this purpose. |
| Tag-based instead of new `core` category | More flexible. A core memory can still have a meaningful category (`note`, `todo`, etc.) while also being tagged `core`. |
| Pre-populate tags on startup | Encourages consistency, gives the user a hint of available tags, idempotent `INSERT OR IGNORE`. |
| Fetch core memories fresh on every request | Fast indexed query on a small table. No cache invalidation complexity. |
| Omit context section if no core memories | Keeps the prompt clean and avoids sending empty sections to the LLM. |
| AND logic for multi-tag queries | More precise. A query for `['core', 'family']` should mean "core memories about family," not "anything tagged core or family." |
| Render as bulleted list | Simple, human-readable, models handle this format well. |

---

## 8. Future Considerations (Out of Scope)

- A `POST /chat` handler that detects natural language patterns like "Remember that..." or "My name is..." and auto-creates `permanent: true` memories with the `core` tag.
- A dedicated web UI for managing core memories.
- Token budget / truncation if core memories grow very large.
- Prioritized inclusion of core memories by tag type (e.g., always include `health`, sometimes include `travel`).
- A system prompt update to explicitly instruct Barnaby to reference core memories when relevant.

---

*End of document*
