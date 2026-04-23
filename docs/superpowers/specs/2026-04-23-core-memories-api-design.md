# Core Memories API — Design Document

**Date:** 2026-04-23  
**Project:** Barnaby (Phase 1)  
**Scope:** REST API for creating, listing, and deleting personal memories

---

## 1. Overview

Barnaby is a personal digital assistant. Phase 1 establishes the foundational **Memories API** — a Fastify-based REST service backed by SQLite that stores timestamped, categorized memories with optional tags. All endpoints are protected by HTTP Basic Auth.

This document covers architecture, data model, API contract, error handling, and testing strategy for Phase 1.

---

## 2. Architecture

### 2.1 Directory Structure

```
src/
  index.ts              # Entry point: builds and starts the server
  app.ts                # App factory: registers all plugins, returns FastifyInstance
  plugins/
    database.ts         # better-sqlite3 connection + schema migration
    auth.ts             # @fastify/basic-auth setup
    repository.ts       # MemoryRepository decorator (depends on database)
    error-handler.ts    # Global error response formatting
  routes/
    memories/
      index.ts          # Route definitions (GET, POST, DELETE /memories)
      handlers.ts       # Route handlers
      schemas.ts        # JSON Schema for validation/serialization
  types/
    fastify.d.ts        # TypeScript module augmentation for decorators
```

### 2.2 Plugin Registration Order

Plugins are registered sequentially to respect dependencies:

1. **`database`** — Opens SQLite connection, runs DDL migrations on startup.
2. **`auth`** — Registers `@fastify/basic-auth` with credentials from environment variables.
3. **`repository`** — Creates `MemoryRepository` instance and decorates the Fastify instance with it. Depends on `database`.
4. **`error-handler`** — Global error response formatting.
5. **`routes/memories`** — Registers memory routes. Depends on `repository` and `auth`.

### 2.3 Encapsulation Strategy

The `auth` plugin is registered **inside** the memories route plugin scope, not globally. This means:

- Only routes within the memories scope require authentication.
- Future public routes (e.g., Telegram webhook callbacks in Phase 2) can be registered at the root level without auth.
- Clean separation between protected and unprotected domains.

---

## 3. Data Model

### 3.1 SQLite Schema

```sql
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
```

**Rationale:**
- `CHECK` constraint enforces categories at the database layer without a separate lookup table.
- `tags` table deduplicates tag names.
- `memory_tags` join table enables many-to-many relationships.
- `ON DELETE CASCADE` on `memory_tags` ensures tag links are cleaned up automatically when a memory is deleted.
- `created_at` stored as integer (milliseconds since epoch) for simple sorting and indexing.

**Database Setup:**
On connection, the database plugin must execute:
```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
```
- `foreign_keys = ON` is required for `ON DELETE CASCADE` to function.
- `journal_mode = WAL` improves read concurrency and is recommended for better-sqlite3.

### 3.2 TypeScript Types

```typescript
// Domain types
type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';

type Memory = {
  id: string;           // UUID v4 (via crypto.randomUUID())
  content: string;
  category: MemoryCategory;
  tags: string[];
  createdAt: number;    // unix timestamp (ms)
};

// API shapes
type CreateMemoryBody = {
  content: string;
  category: MemoryCategory;
  tags?: string[];
};

type ListMemoriesQuery = {
  category?: string;
  tags?: string;        // comma-separated, e.g. "urgent,work"
  page?: number;        // default 1
  limit?: number;       // default 20, max 100
};
```

---

## 4. API Contract

### 4.1 POST /memories

Create a new memory.

**Request:**
```http
POST /memories
Authorization: Basic <base64(username:password)>
Content-Type: application/json

{
  "content": "Dentist appointment at 2pm",
  "category": "appointment",
  "tags": ["health", "reminder"]
}
```

**Response (201 Created):**
```json
{
  "id": "018f...",
  "content": "Dentist appointment at 2pm",
  "category": "appointment",
  "tags": ["health", "reminder"],
  "createdAt": 1713801600000
}
```

**Behavior:**
1. Fastify validates the request body against the JSON Schema.
2. Repository inserts the memory into the `memories` table.
3. For each tag: insert into `tags` table if it does not exist (`INSERT OR IGNORE`), then insert the link into `memory_tags`.
4. Return the full memory object with resolved tag names.

**Input Normalization:**
- `content` is trimmed of leading/trailing whitespace.
- `category` is lowercased before validation and storage.
- `tags` are lowercased, trimmed, and deduplicated. Empty tags after trimming are removed.

**Errors:**
- `400 Bad Request` — Invalid body (missing fields, invalid category, etc.)
- `500 Internal Server Error` — Database failure

---

### 4.2 GET /memories/:id

Retrieve a single memory by ID.

**Request:**
```http
GET /memories/018f...
Authorization: Basic <base64(username:password)>
```

**Response (200 OK):**
```json
{
  "id": "018f...",
  "content": "Dentist appointment at 2pm",
  "category": "appointment",
  "tags": ["health", "reminder"],
  "createdAt": 1713801600000
}
```

**Errors:**
- `400 Bad Request` — Invalid UUID format
- `404 Not Found` — Memory not found

---

### 4.3 GET /memories

List memories with optional filtering and pagination.

**Request:**
```http
GET /memories?category=appointment&tags=health&page=1&limit=20
Authorization: Basic <base64(username:password)>
```

**Response (200 OK):**
```json
{
  "data": [
    {
      "id": "018f...",
      "content": "Dentist appointment at 2pm",
      "category": "appointment",
      "tags": ["health", "reminder"],
      "createdAt": 1713801600000
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1
  }
}
```

**Query Parameters:**
| Param      | Type    | Required | Default | Description                          |
|------------|---------|----------|---------|--------------------------------------|
| `category` | string  | No       | —       | Filter by category                   |
| `tags`     | string  | No       | —       | Comma-separated list of tags to filter |
| `page`     | integer | No       | 1       | Page number (1-indexed)              |
| `limit`    | integer | No       | 20      | Items per page (max 100)             |

**Behavior:**
1. Fastify validates and coerces query parameters.
2. If `category` is provided, it is validated against the allowed enum values (`appointment`, `note`, `todo`, `purchase`). Invalid categories return `400`.
3. If `tags` is provided, each tag is validated to be a non-empty string. Invalid tags return `400`.
4. Repository queries `memories` with optional JOINs to `memory_tags` and `tags` for filtering.
5. Results are ordered by `created_at DESC` (newest first).
6. Pagination is applied at the database layer using `LIMIT` and `OFFSET`.

**Errors:**
- `400 Bad Request` — Invalid query parameters (including invalid category or empty/invalid tags)
- `500 Internal Server Error` — Database failure

---

### 4.4 DELETE /memories/:id

Delete a memory by ID.

**Request:**
```http
DELETE /memories/018f...
Authorization: Basic <base64(username:password)>
```

**Response:**
- `204 No Content` — Memory deleted successfully
- `404 Not Found` — Memory with the given ID does not exist

**Behavior:**
1. Fastify validates that `:id` is a valid UUID string.
2. Repository attempts to delete the memory. `ON DELETE CASCADE` cleans up `memory_tags` entries automatically.
3. If no rows were deleted, throw `NotFoundError`.

**Errors:**
- `400 Bad Request` — Invalid UUID format
- `404 Not Found` — Memory not found
- `500 Internal Server Error` — Database failure

---

## 5. JSON Schema Validation

### 5.1 POST /memories Body Schema

```json
{
  "type": "object",
  "properties": {
    "content": { "type": "string", "minLength": 1, "maxLength": 2000 },
    "category": { "type": "string", "enum": ["appointment", "note", "todo", "purchase"] },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "default": []
    }
  },
  "required": ["content", "category"]
}
```

### 5.2 GET /memories Querystring Schema

```json
{
  "type": "object",
  "properties": {
    "category": { "type": "string", "enum": ["appointment", "note", "todo", "purchase"] },
    "tags": { "type": "string" },
    "page": { "type": "integer", "minimum": 1, "default": 1 },
    "limit": { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }
  }
}
```

### 5.3 DELETE /memories/:id Params Schema

```json
{
  "type": "object",
  "properties": {
    "id": { "type": "string", "format": "uuid" }
  },
  "required": ["id"]
}
```

---

## 6. Authentication

All Phase 1 endpoints require HTTP Basic Authentication.

### 6.1 Configuration

- Package: `@fastify/basic-auth`
- Credentials stored in environment variables: `BASIC_AUTH_USERNAME`, `BASIC_AUTH_PASSWORD`
- Auth plugin registered inside the memories route plugin scope (not globally)

### 6.2 Behavior

- Unauthenticated requests receive `401 Unauthorized` with a `WWW-Authenticate: Basic` header.
- Invalid credentials receive `401 Unauthorized`.
- No session management — stateless per-request auth.

---

## 7. Error Handling

### 7.1 Error Response Format

All errors follow a consistent shape:

```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Memory not found"
}
```

### 7.2 Error Categories

| Status | Scenario                              | Handler                              |
|--------|---------------------------------------|--------------------------------------|
| 400    | JSON Schema validation failure        | Fastify built-in                     |
| 401    | Missing/invalid Basic Auth credentials| `@fastify/basic-auth`                |
| 404    | Memory not found (DELETE)             | Custom `NotFoundError`               |
| 500    | Unexpected database or server error   | Global `setErrorHandler`             |

### 7.3 Global Error Handler

A plugin (`src/plugins/error-handler.ts`) registers a global error handler via `app.setErrorHandler()`:

- Logs all errors via Pino (`request.log.error`).
- Returns structured error responses.
- Never leaks internal error details or stack traces in production.
- `400` errors pass through Fastify's validation message.
- `404` errors return the custom `NotFoundError` message.
- All other errors return generic `500`.

---

## 8. Database Access (Repository Pattern)

### 8.1 MemoryRepository Interface

```typescript
interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
}
```

### 8.2 Implementation Notes

- `create`: Normalizes input (lowercase/trim content, category, and tags; deduplicate tags). Inserts memory, then for each tag: `INSERT OR IGNORE INTO tags (name) VALUES (?)`, then `INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, ?)`.
- `findById`: Queries memory by ID with joined tags.
- `findAll`: Normalizes filter values, builds parameterized SQL dynamically based on which filters are present. Uses `LIMIT`/`OFFSET` for pagination.
- `delete`: `DELETE FROM memories WHERE id = ?`. Returns `true` if a row was deleted, `false` otherwise (used to throw `NotFoundError`).

### 8.3 Transaction Safety

Tag creation and memory insertion are wrapped in a SQLite transaction to ensure atomicity.

### 8.4 Plugin Encapsulation

All plugins that decorate the Fastify instance (`database`, `repository`, `error-handler`) use `fastify-plugin` to break encapsulation and make decorators available to sibling plugins and route handlers.

---

## 9. Testing Strategy

### 9.1 Framework

- **Test runner:** vitest
- **HTTP assertions:** Fastify's `inject()` method
- **Goal:** End-to-end tests that exercise the full request lifecycle (auth → validation → DB → response)

### 9.2 Test Categories

1. **Authentication:** Reject unauthenticated requests, accept valid credentials.
2. **Validation:** Reject invalid bodies, query params, and UUIDs.
3. **CRUD:** Create, list (with/without filters), and delete memories.
4. **Tag behavior:** Tags are created on-the-fly, deduplicated, and cleaned up on delete.
5. **Pagination:** Correct `LIMIT`/`OFFSET` behavior and total count.

### 9.3 Test Isolation

- Each test suite gets a fresh in-memory SQLite database (or a unique file-backed DB).
- Database migrations run before each test suite.
- No shared state between tests.

### 9.4 Test Helper

A `buildTestApp()` factory in `test/helper.ts` creates a Fastify instance with:
- In-memory SQLite
- Test auth credentials
- All plugins registered

---

## 10. Environment Configuration

Required environment variables (via `.env` file):

| Variable               | Description                          |
|------------------------|--------------------------------------|
| `PORT`                 | Server port (default: 3000)          |
| `DATABASE_PATH`        | Path to SQLite file (or `:memory:`)  |
| `BASIC_AUTH_USERNAME`  | Basic auth username                  |
| `BASIC_AUTH_PASSWORD`  | Basic auth password                  |

---

## 10.1 Graceful Shutdown

The application handles graceful shutdown on `SIGTERM` and `SIGINT`:

1. Stop accepting new connections.
2. Close the SQLite database connection.
3. Exit the process.

This is handled via Fastify's `close()` method, which shuts down the server and triggers `onClose` hooks registered by plugins.

### 10.2 Database Migrations

Migrations run automatically on application startup. To prevent data loss:

- Migrations are **additive only** — they create tables and indexes but never drop or alter existing data.
- Each migration is idempotent (e.g., `CREATE TABLE IF NOT EXISTS`).
- There is no down-migration or rollback mechanism in Phase 1.
- Schema changes are versioned by commit; if a breaking change is ever needed, a manual backup and migration script will be provided.

---

## 11. Future Considerations (Out of Scope for Phase 1)

The following are noted for context but are **explicitly not part of Phase 1**:

- Telegram bot integration (Phase 2)
- Google Calendar access
- YNAB integration via MCP
- Home Assistant integration
- HTML page for listing memories
- Voice memo processing
- Memory updates (PATCH)
- Full-text search in memory content
- Rate limiting
- HTTPS/TLS termination

---

## 12. Dependencies

### Production
- `fastify` — Web framework
- `@fastify/basic-auth` — HTTP Basic Auth
- `better-sqlite3` — SQLite driver
- `fastify-plugin` — Plugin encapsulation breaking

### Development
- `typescript` — TypeScript compiler
- `tsx` — TypeScript execution
- `vitest` — Test runner
- `@types/node`, `@types/better-sqlite3` — Type definitions

---

## 13. Open Questions / Decisions

| Decision | Rationale |
|----------|-----------|
| UUID v4 via `crypto.randomUUID()` | Native Node.js, no external dependency |
| Integer timestamps (ms) | Native JavaScript `Date.now()`, simple sorting |
| No PATCH endpoint | YAGNI — user explicitly does not want memory updates |
| Comma-separated tags in query | Simple, URL-safe, no need for repeated query params |
| Auth scoped to route plugin | Sets up pattern for public routes in Phase 2 |
| Synchronous repository | better-sqlite3 is synchronous by design; single-user app |
| `inject()` for testing | Fastify's native testing method, faster than real HTTP |
| Content max 2000 chars | Approximate proxy for 100 words; generous but bounded |
| Tag lowercase + trim | Consistent deduplication, `"Work"` == `"work"` |
| WAL mode + foreign keys | Required for CASCADE and better concurrency |
| Additive-only migrations | Prevents data loss between deployments |

---

*End of document*
