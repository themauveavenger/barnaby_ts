# API Endpoints

All routes require HTTP Basic Auth. The `Authorization` header is validated globally.

## Memories

### `GET /memories`

List memories with optional filtering and pagination.

**Query params:**
| Param    | Type    | Default | Description                        |
|----------|---------|---------|------------------------------------|
| category | string  | —       | Filter by category                 |
| tags     | string  | —       | Comma-separated tags to filter by  |
| page     | integer | 1       | Page number                        |
| limit    | integer | 20      | Results per page (max 100)         |

### `GET /memories/context`

Returns memories formatted for LLM context injection. Includes permanent memories and recent non-permanent memories within `CONTEXT_WINDOW_DAYS`.

### `GET /memories/:id`

Get a single memory by ID.

### `POST /memories`

Create a new memory.

**Body:**
```json
{
  "content": "string (1-2000 chars)",
  "category": "note | todo",
  "permanent": false,
  "tags": ["string"]
}
```

### `DELETE /memories/:id`

Delete a memory and its associated tags and actions (cascading).

### `POST /memories/:id/actions`

Create an action on a memory (complete or dismiss a todo).

**Body:**
```json
{
  "action": "completed | dismissed"
}
```

### `DELETE /memories/:id/actions/:actionId`

Delete an action from a memory.

---

## Briefing

### `GET /briefing`

List past briefings with pagination.

**Query params:**
| Param    | Type    | Default | Description        |
|----------|---------|---------|--------------------|
| page     | integer | 1       | Page number        |
| limit    | integer | 20      | Results per page   |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "content": "string",
      "triggeredAt": "ISO 8601",
      "triggerType": "scheduled | manual"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42 }
}
```

### `POST /briefing`

Trigger a manual briefing. Sent via Telegram to the configured `TELEGRAM_CHAT_ID`.

**Response (200):**
```json
{ "success": true, "message": "Briefing sent" }
```

**Response (504):**
```json
{ "success": false, "message": "Briefing generation timed out after 60 seconds" }
```

The timeout is configurable via `BRIEFING_TIMEOUT_MS` (default: 60000).

### `DELETE /briefing/:id`

Delete a stored briefing.

---

## Pages

### `GET /`

Server-rendered memories page with filtering, pagination, and a form to create new memories and resolve existing ones.

### `POST /`

Form submission to create a memory. Redirects back to `GET /`.

### `POST /actions`

Form submission to resolve a memory (complete or dismiss). Redirects back to `GET /`.
