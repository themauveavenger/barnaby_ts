# Barnaby

A personal digital assistant. Barnaby remembers things, manages calendar events, sends daily briefings, and functions as a simple research assistant. All communication happens through a REST API and Telegram.

## Tech Stack

- **Runtime:** Node.js 24 LTS with TypeScript (ESM, no build step via `tsx`)
- **Server:** Fastify with `@fastify/basic-auth` (global auth on all routes)
- **Database:** SQLite via `better-sqlite3`
- **LLM:** `@mariozechner/pi-coding-agent` SDK with OpenCode Go provider (`minimax-m2.7`)
- **Templating:** Handlebars with PicoCSS (CDN) for the memories page
- **Telegram:** `grammy` with `@grammyjs/auto-retry`
- **Testing:** Vitest (run with `npm run test:minimal`)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCODE_API_KEY` | Yes | OpenCode Go API key (from [opencode.ai](https://opencode.ai/auth)) |
| `BASIC_AUTH_USERNAME` | Yes | HTTP Basic Auth username |
| `BASIC_AUTH_PASSWORD` | Yes | HTTP Basic Auth password |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID (for Calendar API) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Refresh token from one-time OAuth flow |
| `YNAB_ACCESS_TOKEN` | No² | YNAB personal access token (from [app.youneedabudget.com/settings/developer](https://app.youneedabudget.com/settings/developer)) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token (from [@BotFather](https://t.me/BotFather)) |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID (send `/start` to the bot to get it) |
| `BRIEFING_CRON` | Yes | Cron expression for daily briefing schedule (e.g. `0 8 * * *` for 8:00 AM) |
| `CALENDAR_IDS` | Yes | Comma-separated list of Google Calendar IDs (e.g. `primary,family@group.calendar.google.com`) |
| `TIMEZONE` | No | IANA timezone for date formatting (default: `America/New_York`) |
| `BRIEFING_TIMEOUT_MS` | No | Timeout for manual briefing generation in milliseconds (default: `60000`) |
| `DATABASE_PATH` | No | SQLite database file path (default: `:memory:`) |
| `CONTEXT_WINDOW_DAYS` | No | How many days of recent memories to include in context (default: `30`) |
| `HOST` | No | Server bind address (default: `127.0.0.1`) |
| `PORT` | No | Server port (default: `3000`) |
| `LOG_LEVEL` | No | Pino log level (default: `info`) |

² YNAB tools are implemented but not yet exposed through any user-facing endpoint.

## API Endpoints

See [src/routes/README.md](src/routes/README.md) for the full API reference.

Quick overview:

| Endpoint | Description |
|----------|-------------|
| `GET /` | Server-rendered memories page (browse, filter, create, resolve) |
| `GET/POST/DELETE /memories` | CRUD for memories |
| `POST /memories/:id/actions` | Complete or dismiss a memory |
| `GET /memories/context` | Memories formatted for LLM context |
| `POST /chat` | Chat with the LLM (no tools, safe mode) |
| `POST /calendar/events` | Natural language calendar operations |
| `GET/POST/DELETE /briefing` | List, trigger, or delete briefings |

## LLM Chat

`POST /chat` accepts `{ "message": string }` and returns `{ "response": string }`. The chat session has all tools disabled (`noTools: 'all'`), so the LLM can only respond from its training data and any core memories injected into the prompt context. Core memories tagged `core` + `permanent` are included automatically, along with today's date.

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  -d '{"message": "Say hello in one word"}'
```

## Google Calendar Integration

Barnaby can read, create, and edit events on your Google Calendars via the `POST /calendar/events` endpoint. The agent has three calendar tools: `calendar_list`, `calendar_create`, and `calendar_edit`. **There is no delete tool.**

### Setup

1. Create OAuth 2.0 credentials in the [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Calendar API**.
2. Run the one-time auth script:
   ```bash
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/get-google-refresh-token.ts
   ```
3. Add the printed refresh token to your `.env`.
4. List your available calendars:
   ```bash
   source .env && ./scripts/list-calendars.sh
   ```
5. Set `CALENDAR_IDS` in your `.env` as a comma-separated list.

```bash
curl -X POST http://localhost:3000/calendar/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  -d '{"message": "create an event on the family calendar for May 15 at 7pm"}'
```

## Telegram Bot

Barnaby communicates via Telegram for automated messages, daily briefings, and the `/remember` command. Built with `grammy`.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the API token.
2. Set `TELEGRAM_BOT_TOKEN` in your `.env`.
3. Send `/start` to your bot — it replies with your chat ID.
4. Set `TELEGRAM_CHAT_ID` in your `.env`.

### Commands

- `/start` — Returns your chat ID and setup confirmation.
- `/remember <text>` — Creates, lists, or resolves memories via the agent. Examples:
  ```
  /remember call the dentist on Friday
  /remember shellfish allergy
  /remember what todos do I have?
  ```

## Daily Briefings

Barnaby sends an AI-generated daily briefing via Telegram on a cron schedule. Set `BRIEFING_CRON` to a valid cron expression (e.g. `0 8 * * *` for 8:00 AM).

The briefing includes calendar events from yesterday, today, and the next 7 days along with recent memories and tasks. You can trigger a manual briefing via `POST /briefing`.

## YNAB Integration

Seven YNAB tools are implemented (`ynab_get_transactions`, `ynab_get_payee_history`, `ynab_create_transaction`, `ynab_split_transaction`, `ynab_approve_transaction`, `ynab_delete_transaction`, `ynab_flag_transaction`) but are **not yet exposed through any user-facing endpoint**. Set `YNAB_ACCESS_TOKEN` in your `.env` for when they are enabled.

## Memory Actions

Memories with the `todo` or `purchase` category can be acted on — marked `completed` (fulfilled) or `dismissed` (no longer relevant). Actions are stored in a separate `memory_actions` table with a unique constraint on `(memory_id, action)`, so a memory can have at most one of each action type.

- **`completed`** — The task has been fulfilled. Excluded from active tasks in briefings.
- **`dismissed`** — No longer relevant but not fulfilled. Stop reminding about it.

The memory row is **not deleted** — it persists for historical reference. Deleting a memory cascades to its actions.

## iOS Shortcuts (Memory Acquisition)

I use iOS Shortcuts to transcribe voice to text and POST directly to Barnaby's `/memories` endpoint. Requires the [Actions](https://sindresorhus.com/actions) app by Sindre Sorhus for extended HTTP actions with custom headers.

### Prerequisites

- Install the [Actions](https://sindresorhus.com/actions) app.
- Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` in your `.env`.

### Shortcut 1: Build Memory Payload

1. **Record Audio** — captures a voice memo.
2. **Transcribe Audio** — converts speech to text (built-in iOS action).
3. **Dictionary** — builds the request body with `content`, `category` (e.g. `note`), and `permanent` (`false`).

### Shortcut 2: New Memory

1. **Run Shortcut** → choose "Build Memory Payload".
2. **Get Contents of URL (Extended)** (from Actions app):
   - **Method**: `POST`
   - **URL**: `https://your-barnaby-server/memories`
   - **Headers**: `Authorization: Basic <base64>`, `Content-Type: application/json`
   - **Request Body**: `JSON` (output from Step 1)

### Tips

- Rename magic variables for clarity (tap any blue variable bubble → "Rename").
- Use `Base64 Encode` on `username:password` text to build the auth header dynamically.
- Create multiple "Build Memory Payload" variants for different categories like `appointment`, `todo`, or `purchase`.

## Roadmap

See [ROADMAP.md](ROADMAP.md).

## Deployment

See [docs/deployment.md](docs/deployment.md). Deploy updates with `./scripts/deploy.sh`.
