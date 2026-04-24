# Memory Permanence & Context Endpoint — Design Document

**Date:** 2026-04-23
**Project:** Barnaby (Phase 1 extension)
**Scope:** Add permanent/time-based distinction to memories and a dedicated context retrieval endpoint

---

## 1. Overview

Barnaby's memories currently have no lifecycle distinction. Every memory is treated equally, which is inefficient when loading context for an LLM agent. This design introduces a `permanent` flag on memories:

- **Permanent memories** (e.g., preferences, family info, birthdays) are always relevant and should always be loaded into agent context.
- **Time-based memories** (e.g., "bought groceries", "dentist appointment") are only relevant for a window of time and should drop out of context automatically.

A new `GET /memories/context` endpoint returns the full set of memories that should be loaded into agent context: all permanent memories plus non-permanent memories from the last *N* days. All memory endpoints now return `createdAt` as an ISO 8601 string for human readability.

---

## 2. Data Model

### 2.1 SQLite Schema Change

```sql
ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0;
```

- `0` = time-based (default), `1` = permanent.
- Existing memories all become time-based, which is the safe conservative default.
- This is additive-only, consistent with the Phase 1 migration policy.

### 2.2 TypeScript Types

```typescript
type Memory = {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  permanent: boolean;   // NEW
  createdAt: string;    // ISO 8601 string (changed from number)
};

type CreateMemoryBody = {
  content: string;
  category: MemoryCategory;
  tags?: string[];
  permanent?: boolean;  // NEW, defaults to false
};
```

---

## 3. API Contract

### 3.1 POST /memories (Updated)

**Request:**
```http
POST /memories
Authorization: Basic <base64(username:password)>
Content-Type: application/json

{
  "content": "I prefer dark mode interfaces",
  "category": "note",
  "permanent": true,
  "tags": ["preference", "ui"]
}
```

- `permanent` is optional and defaults to `false`.

**Response (201 Created):**
```json
{
  "id": "018f...",
  "content": "I prefer dark mode interfaces",
  "category": "note",
  "permanent": true,
  "tags": ["preference", "ui"],
  "createdAt": "2025-04-23T14:00:00.000Z"
}
```

### 3.2 GET /memories/:id (Updated)

`createdAt` is now returned as an ISO 8601 string. No other changes.

### 3.3 GET /memories (Updated)

`createdAt` in each memory object is now an ISO 8601 string. No other changes.

### 3.4 DELETE /memories/:id

No changes.

### 3.5 GET /memories/context (NEW)

Returns all permanent memories + non-permanent memories from the last *N* days, both ordered by `createdAt DESC`.

**Request:**
```http
GET /memories/context
Authorization: Basic <base64(username:password)>
```

**Response (200 OK):**
```json
{
  "permanent": [
    {
      "id": "018f...",
      "content": "I prefer dark mode interfaces",
      "category": "note",
      "permanent": true,
      "tags": ["preference"],
      "createdAt": "2025-04-01T10:00:00.000Z"
    }
  ],
  "recent": [
    {
      "id": "018f...",
      "content": "Bought groceries",
      "category": "purchase",
      "permanent": false,
      "tags": [],
      "createdAt": "2025-04-23T09:00:00.000Z"
    }
  ]
}
```

- `permanent` array contains all memories where `permanent = 1`.
- `recent` array contains all memories where `permanent = 0` AND `created_at >= cutoff`.
- Both arrays are ordered by `createdAt DESC`.
- Splitting the response makes it easy for LLM integration to distinguish evergreen vs. transient memories.

---

## 4. Environment & Configuration

New environment variable:

| Variable | Description | Default |
|----------|-------------|---------|
| `CONTEXT_WINDOW_DAYS` | How many days back to include non-permanent memories in context | `30` |

The cutoff timestamp is computed as:
```typescript
const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
```

---

## 5. Repository Changes

The `MemoryRepository` interface is extended:

```typescript
interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };  // NEW
}
```

**`findForContext()` implementation notes:**
- Query 1: `SELECT ... FROM memories WHERE permanent = 1 ORDER BY created_at DESC`
- Query 2: `SELECT ... FROM memories WHERE permanent = 0 AND created_at >= ? ORDER BY created_at DESC`
- Both queries join tags via `memory_tags` and `tags`.
- The repository converts `created_at` (integer, ms) to ISO 8601 strings on the way out.

---

## 6. JSON Schema Updates

### 6.1 POST /memories Body Schema

```json
{
  "type": "object",
  "properties": {
    "content": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "category": { "type": "string", "enum": ["appointment", "note", "todo", "purchase"] },
    "permanent": { "type": "boolean", "default": false },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "default": []
    }
  },
  "required": ["content", "category"]
}
```

### 6.2 Response Serialization

All memory response schemas are updated to show `createdAt` as a string type. Fastify's JSON Schema types should reflect this.

---

## 7. Testing Strategy

1. **Create with `permanent: true`** — response includes `permanent: true`, value is persisted.
2. **Default `permanent: false`** — omitting the field defaults to `false`.
3. **`findForContext()` repository method** — returns correct split, respects `CONTEXT_WINDOW_DAYS`, ordered by `createdAt DESC`.
4. **`GET /memories/context`** — returns 200 with `permanent` and `recent` arrays.
5. **ISO 8601 timestamps** — all endpoints (`POST`, `GET /memories/:id`, `GET /memories`, `GET /memories/context`) return `createdAt` as an ISO string.
6. **Existing CRUD regression** — `findAll`, `findById`, `create` without `permanent`, and `delete` all still work.
7. **Database migration** — existing data survives the `ALTER TABLE` and defaults to `permanent = 0`.

---

## 8. Migration Strategy

The migration is a single additive statement executed by the `database` plugin on startup:

```sql
ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0;
```

- `ALTER TABLE ... ADD COLUMN` in SQLite is idempotent only when wrapped in a conditional check. Since SQLite does not support `IF NOT EXISTS` on `ADD COLUMN`, the plugin should use a `PRAGMA table_info(memories)` check or wrap in a `try/catch`.
- For simplicity and consistency with Phase 1's additive-only policy, we can run the `ALTER TABLE` unconditionally and catch the "duplicate column name" error silently.

---

## 9. Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| `permanent` as boolean, not category | Permanence is orthogonal to category type. Categories describe *what*; permanence describes *lifecycle*. |
| Dedicated `/memories/context` endpoint | Clear intent, testable, won't need awkward overloads on `GET /memories`. |
| `createdAt` as ISO 8601 string | User requested human-readable timestamps; ISO 8601 is unambiguous and sortable. |
| `CONTEXT_WINDOW_DAYS` env var | Global, simple to tune without code changes. |
| Split response into `permanent`/`recent` | Makes LLM integration straightforward to distinguish evergreen vs. transient context. |
| Default `permanent = false` | Conservative default; most memories are time-based. |

---

*End of document*
