# Google Calendar Integration — Design

**Date:** 2026-04-28
**Status:** Draft
**Goal:** Integrate Google Calendar read/create/edit access into Barnaby via a dedicated `POST /calendar/events` endpoint, using natural language input parsed by the pi-coding-agent SDK with three custom calendar tools.

---

## Context

Barnaby is a Fastify-based personal assistant API with:
- SQLite via better-sqlite3
- Global basic auth via `@fastify/basic-auth`
- Plugin-based architecture
- E2E tests with Fastify `inject()` and vitest
- LLM integration via `@mariozechner/pi-coding-agent` SDK (OpenCode Go provider)

The user wants to access their personal Google Calendar and calendars shared with them. They want to read, create, and edit events via natural language (e.g., "create an event on the family calendar for May 15"). Delete operations must be impossible.

---

## Google Auth Setup

Google Calendar API requires OAuth 2.0 for private calendar access. API keys alone are insufficient.

### One-Time Setup Flow

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Calendar API** (APIs & Services → Library)
3. Create **OAuth 2.0 credentials** (APIs & Services → Credentials → Create Credentials → OAuth client ID)
   - Application type: **Desktop app** (or "Web application" with `http://localhost:3000` redirect)
4. Download the client JSON or note the **Client ID** and **Client Secret**
5. Run a one-time script (provided in the repo) to perform the OAuth flow:
   - Opens a browser for consent
   - Exchanges the authorization code for a **refresh token**
   - Prints the refresh token for storage in `.env`
6. Store credentials in `.env`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REFRESH_TOKEN=...
   ```

### Runtime Auth

The application uses the refresh token to request short-lived access tokens automatically via `google-auth-library`. No browser interaction is required after the initial setup.

---

## Components

### 1. `src/plugins/google-auth.ts` — Google Auth Plugin

A Fastify plugin that initializes a Google OAuth2 client using the environment credentials.

- Reads `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` from `process.env`
- Creates an `OAuth2Client` from `google-auth-library`
- Sets credentials using the refresh token
- Decorates the Fastify instance with `googleAuth: { oauth2Client: OAuth2Client }`
- Fails fast on startup if credentials are missing

### 2. `src/plugins/calendar-client.ts` — Calendar Client Plugin

A Fastify plugin that wraps the Google Calendar API v3 client.

- Uses `googleapis` (`calendar` API v3)
- Authenticates using `request.server.googleAuth.oauth2Client`
- Provides a thin wrapper around the API:
  - `listEvents(calendarId, timeMin, timeMax)` → `calendar.events.list`
  - `createEvent(calendarId, event)` → `calendar.events.insert`
  - `updateEvent(calendarId, eventId, event)` → `calendar.events.patch`
- **No `deleteEvent` method exists.** Delete is impossible at the API layer.
- Decorates the Fastify instance with `calendarClient`

### 3. `src/plugins/agent.ts` — Agent Plugin (updated)

Extend the existing agent plugin to register three custom calendar tools via `extensionFactories`.

The extension factories close over `fastify.calendarClient` (available because `calendarClientPlugin` is registered before `agentPlugin`). Each tool executes by calling into the wrapped Google Calendar API:

**Note:** The existing chat route passes `noTools: 'all'` to `createAgentSession`, so calendar tools remain disabled for chat. The calendar route creates a session without `noTools`, enabling the registered tools.

#### `calendar_list`
- **Label:** List Calendar Events
- **Parameters:**
  - `calendarId`: `string` — Calendar ID or `primary`
  - `start`: `string` — ISO date/time or natural language (agent normalizes)
  - `end`: `string` — ISO date/time or natural language
- **Returns:** Array of events (id, summary, start, end, description)

#### `calendar_create`
- **Label:** Create Calendar Event
- **Parameters:**
  - `calendarId`: `string`
  - `summary`: `string`
  - `start`: `string` — ISO date/time
  - `end`: `string` — ISO date/time
  - `description`: `string` (optional)
- **Returns:** Created event object

#### `calendar_edit`
- **Label:** Edit Calendar Event
- **Parameters:**
  - `calendarId`: `string`
  - `eventId`: `string`
  - `summary`: `string` (optional)
  - `start`: `string` (optional)
  - `end`: `string` (optional)
  - `description`: `string` (optional)
- **Returns:** Updated event object

**Security note:** No `calendar_delete` tool is registered. The agent has no concept of calendar deletion.

The agent's system prompt is updated to include:
- A list of available calendars (read from env/config at startup)
- Instructions to use ISO 8601 format for dates
- Guidance on resolving calendar names to `calendarId`s

### 4. `src/routes/calendar/index.ts` — Calendar Route

Registers `POST /calendar/events` with schema validation.

### 5. `src/routes/calendar/schemas.ts` — Request/Response Schemas

JSON Schema:

- **Request body:** `{ message: string }` — natural language instruction
- **Response (200):** `{ result: string }` — human-readable result from the agent
- **Response (400):** `{ error: string }` — validation or parse failure
- **Response (500):** `{ error: string }` — Google API or agent failure

### 6. `src/routes/calendar/handlers.ts` — Calendar Handler

Per-request flow:

1. Extract `{ message }` from request body
2. Resolve available calendars from config/env (e.g., `primary`, `family@group.calendar.google.com`)
3. Build a system prompt snippet with calendar list
4. Create an agent session with the three calendar tools enabled:
   ```ts
   const { session } = await createAgentSession({
     model,
     authStorage: request.server.agent.authStorage,
     modelRegistry: request.server.agent.modelRegistry,
     resourceLoader: request.server.agent.resourceLoader,
     sessionManager: SessionManager.inMemory(),
   });
   ```
5. Send the prompt: `"Available calendars: ...\n\n${message}"`
6. The agent parses the intent and calls the appropriate tool(s)
7. Extract the final text response from the session
8. Return `{ result: responseText }`

### 7. `src/types/fastify.d.ts` — TypeScript Augmentation

Update `FastifyInstance` to include:
- `googleAuth: { oauth2Client: OAuth2Client }`
- `calendarClient: CalendarClient`

### 8. `src/app.ts` — App Registration

Register `googleAuthPlugin` and `calendarClientPlugin` before the agent plugin (so the agent can reference them). Update `agentPlugin` registration to pass the calendar client context.

### 9. `scripts/get-google-refresh-token.ts` — One-Time Auth Script

A standalone script for the initial OAuth flow:
- Generates an OAuth URL with `access_type=offline` and `prompt=consent`
- Spins up a temporary HTTP server on localhost to capture the auth code
- Exchanges the code for tokens
- Prints the refresh token for `.env` insertion
- Run via: `npx tsx scripts/get-google-refresh-token.ts`

---

## Data Flow

```
POST /calendar/events { message: "create an event on the family calendar for May 15" }
  → schema validation (400 if invalid)
  → basic auth (401 if missing/wrong)
  → handler:
      build system prompt with calendar list
      createAgentSession({ model, authStorage, modelRegistry, resourceLoader })
      session.prompt("Available calendars: primary, family...\n\ncreate an event on the family calendar for May 15")
      agent decides to call calendar_create({ calendarId: "family...", summary: "...", start: "2026-05-15T...", end: "..." })
      calendarClient.createEvent(...) → Google Calendar API
      agent receives result, formulates human-readable response
      extract text from session
  → { result: "Created event '...' on the family calendar for May 15, 2026." }
```

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Missing Google credentials on startup | App throws on boot (fail fast) |
| Agent fails to parse intent (nonsense input) | Return 400 with `"Could not understand calendar request"` |
| Agent calls tool with invalid params | Google API returns 400; bubble as 500 with context |
| Google API rate limit / unavailable | Retry once with exponential backoff; then 500 |
| Calendar not found | Return 400 with `"Calendar not found"` |
| Event not found (edit) | Return 400 with `"Event not found"` |

**Retry policy:**
- Agent parse failure: retry once with a clearer system prompt
- Google API transient failures (5xx, rate limit): retry once with 1s delay
- Non-retryable errors (invalid calendar ID, auth revoked): fail immediately

---

## Testing

- E2E test for `POST /calendar/events` using Fastify `inject()`
- Mock `@mariozechner/pi-coding-agent` SDK to simulate agent tool calls
- Mock `googleapis` to simulate Google Calendar API responses
- Test cases:
  1. Create event — verify `calendar_create` tool is called with correct params
  2. List events — verify `calendar_list` tool is called
  3. Edit event — verify `calendar_edit` tool is called
  4. Invalid input — verify 400 when agent cannot parse
  5. Missing auth — verify 401 from basic auth

---

## API Contract

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | /calendar/events | `{ "message": string }` | `{ "result": string }` |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Refresh token from one-time auth |
| `CALENDAR_LIST` | No | JSON array of `{ id, name }` objects for available calendars. Defaults to `[{ id: "primary", name: "Primary" }]` |

---

## Scope Boundaries

### In Scope
- Google Calendar API integration (list, create, edit)
- OAuth 2.0 refresh-token auth
- Natural language → calendar action via pi-coding-agent SDK
- Three custom tools (`calendar_list`, `calendar_create`, `calendar_edit`)
- `POST /calendar/events` endpoint
- One-time auth helper script
- E2E tests with mocks

### Out of Scope
- Delete operations (intentionally impossible)
- Recurring events (pass through if agent specifies RRULE, but no special handling)
- Real-time sync / webhooks
- Calendar creation / sharing management
- Non-calendar agent features (e.g., "what's the weather")

---

## Dependencies

Add to `package.json`:
- `googleapis` — Google API client
- `google-auth-library` — OAuth2 client (may be pulled in by `googleapis`)

Install with `npm --save-exact` per project conventions.
