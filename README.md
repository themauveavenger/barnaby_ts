# Barnaby - a digital assistant... Sorta

A personal digital assistant because I need executive function. Barnaby will remember things for me, tell me when I have appointments, automate some of the tedious bits of the budgeting software YNAB (You Need A Budget), and also function as a simple research assistant.

Barnaby's primary method of communication is via Telegram API. If Barnaby sends an automated message (like a daily morning briefing), it will be through Telegram.

## Tech Stack
- Node.js 24 LTS
- Typescript
- ESM 
- fastify
- sqlite (via better-sqlite3)
- pi-mono (for the embedded agent sdk)
- PicoCSS for basic styling on the memories page

## Roadmap

| Phase | Feature                                               | Status      |
|-------|-------------------------------------------------------|-------------|
| 1     | Core Memories API (CRUD + tags + auth)                | Done        |
| 2     | Voice Memos + Web page for memories                   | Done        |
| 3.1   | LLM Chat endpoint (basic send/receive via pi-mono)    | Done        |
| 3.2   | LLM with memory context                               | Done        |
| 3.3   | Multi-turn session persistence                        | Not started |
| 3.4   | Streaming chat responses                              | Not started |
| 4     | Google Calendar integration (read/create/edit)        | Done        |
| 5.1   | Telegram Bot integration (send/receive)               | Done        |
| 5.2   | Daily Briefings via Telegram                          | Done        |
| 5.3   | YNAB integration (transactions, payees, splits)       | Done        |
| 5.4   | Home Assistant integration                            | Not started |

## LLM Integration

Barnaby uses the `@mariozechner/pi-coding-agent` SDK (pi-mono) with the OpenCode Go provider. The `POST /chat` endpoint accepts a JSON body `{ "message": string }` and returns `{ "response": string }`.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENCODE_API_KEY` | Yes | OpenCode Go API key (get from [opencode.ai](https://opencode.ai/auth)) |
| `BASIC_AUTH_USERNAME` | Yes | HTTP Basic Auth username |
| `BASIC_AUTH_PASSWORD` | Yes | HTTP Basic Auth password |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID (for Calendar API) |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret |
| `GOOGLE_REFRESH_TOKEN` | Yes | Refresh token from one-time OAuth flow |
| `YNAB_ACCESS_TOKEN` | Yes | YNAB personal access token (from [app.youneedabudget.com/settings/developer](https://app.youneedabudget.com/settings/developer)) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram Bot API token (from [@BotFather](https://t.me/BotFather)) |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID (send `/start` to the bot to get it) |
| `BRIEFING_CRON` | Yes | Cron expression for daily briefing schedule (e.g. `0 8 * * *` for 8:00 AM) |
| `CALENDAR_IDS` | Yes | Comma-separated list of Google Calendar IDs the agent can access (e.g. `primary,family@group.calendar.google.com`) |
| `BRIEFING_TIMEOUT_MS` | No | Timeout for manual briefing generation in milliseconds. Defaults to `60000` |
| `DATABASE_PATH` | No | SQLite database file path. Defaults to `:memory:` |
| `CONTEXT_WINDOW_DAYS` | No | How many days of recent memories to include in context. Defaults to `30` |
| `HOST` | No | Server bind address. Defaults to `127.0.0.1` |
| `PORT` | No | Server port. Defaults to `3000` |

### Example
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  -d '{"message": "Say hello in one word"}'
```

Response: `{"response":"Hello"}`

## Google Calendar Integration

Barnaby can read, create, and edit events on your Google Calendars via natural language through the `POST /calendar/events` endpoint.

### Setup

1. Create OAuth 2.0 credentials in the [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Calendar API**.
2. Run the one-time auth script:
   ```bash
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npx tsx scripts/get-google-refresh-token.ts
   ```
3. Add the printed refresh token to your `.env`.
4. (Optional) List your available calendars to get exact IDs:
   ```bash
   source .env && ./scripts/list-calendars.sh
   ```
5. Set `CALENDAR_IDS` in your `.env` as a comma-separated list so the agent knows which calendars it can use:
   ```
   CALENDAR_IDS=primary,family@group.calendar.google.com
   ```

### Endpoint

`POST /calendar/events` — accepts `{ "message": string }` natural language instruction.

```bash
curl -X POST http://localhost:3000/calendar/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  -d '{"message": "create an event on the family calendar for May 15 at 7pm"}'
```

Response: `{"result":"Created event 'Dinner' on the family calendar for May 15, 2026 at 7:00 PM."}`

### Security Notes
- The agent is given three tools: `calendar_list`, `calendar_create`, and `calendar_edit`.
- **There is no delete tool.** The agent cannot delete calendar events.
- The chat endpoint (`POST /chat`) still runs with `noTools: 'all'` and cannot access calendars.

## Telegram Bot Integration

Barnaby communicates via Telegram for automated messages and daily briefings. The bot is built with `grammy`.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the API token.
2. Set `TELEGRAM_BOT_TOKEN` in your `.env`.
3. Send `/start` to your bot to receive your `TELEGRAM_CHAT_ID`.
4. Set `TELEGRAM_CHAT_ID` in your `.env`.

### Bot Commands

- `/start` — Returns your chat ID and setup confirmation.

## Daily Briefings

Barnaby can send an AI-generated daily briefing via Telegram on a cron schedule.

### Setup

Set `BRIEFING_CRON` to a valid cron expression (e.g. `0 8 * * *` for 8:00 AM daily).

The briefing includes:
- Calendar events from yesterday (for follow-up), today, and the next 7 days
- Important memories and reminders
- A personalized summary generated by the LLM

You can also trigger a manual briefing via `POST /briefing`. This endpoint has a configurable timeout (`BRIEFING_TIMEOUT_MS`, default 60s) and returns `504` if generation takes too long.

## YNAB Integration

Barnaby can read and manage your YNAB budget via natural language through the `POST /chat` endpoint (when tools are enabled) or other tool-enabled flows.

### Setup

1. Get a personal access token from [YNAB Developer Settings](https://app.youneedabudget.com/settings/developer).
2. Set `YNAB_ACCESS_TOKEN` in your `.env`.

### Available YNAB Tools

The agent has access to 7 YNAB tools:
- `ynab_get_transactions` — Fetch transactions with filters
- `ynab_get_payee_history` — Get spending stats for a payee
- `ynab_create_transaction` — Create regular, transfer, or split transactions
- `ynab_split_transaction` — Split an existing transaction into multiple categories
- `ynab_approve_transaction` — Approve and optionally update a transaction
- `ynab_delete_transaction` — Delete a transaction
- `ynab_flag_transaction` — Flag/unflag transactions with colors

### Notes
- Each request creates a fresh ephemeral in-memory session with no tool access.
- Local context files (e.g., `AGENTS.md`) are intentionally suppressed so the LLM only sees the user's message.
- Multi-turn conversations are planned for Phase 3.3.

## Planned Features
- integration with home assistant
- MCP server support for external tool discovery

## How does Barnaby acquire new memories?

I use iOS Shortcuts to transcribe voice to text and POST directly to Barnaby's `/memories` endpoint. This requires the [Actions](https://sindresorhus.com/actions) app by Sindre Sorhus, which provides an extended "Get Contents of URL" action that supports custom headers (like Basic Auth) and JSON bodies.

No SSH script needed — the shortcut makes the HTTP POST directly from the device.

## iOS Shortcuts Notes

### Prerequisites

- Install the [Actions](https://sindresorhus.com/actions) app by Sindre Sorhus (provides the "Get Contents of URL (Extended)" action).
- Set `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` in your `.env` file.

### Shortcut 1: Build Memory Payload

This shortcut records audio, transcribes it, and builds the JSON payload.

1. **Record Audio** — captures a voice memo.
2. **Transcribe Audio** — converts speech to text (built-in iOS action).
3. **Dictionary** — builds the request body:
   - `content` → output of Transcribe Audio (magic variable)
   - `category` → `note`
   - `permanent` → `false`
   - `tags` → leave empty (omitted)

### Shortcut 2: New Memory

This shortcut calls "Build Memory Payload" and sends it to Barnaby.

1. **Run Shortcut** → choose "Build Memory Payload"
   - This returns the dictionary built above.
2. **Get Contents of URL (Extended)** (from Actions app):
   - **Method**: `POST`
   - **URL**: `https://your-barnaby-server/memories`
   - **Headers** (tap "+" to add each):
     - `Authorization` → `Basic <base64(username:password)>`
     - `Content-Type` → `application/json`
   - **Request Body**: `JSON`
   - **JSON Body**: output from Step 1 (the dictionary — Shortcuts auto-serializes it)

### Tips

- **Rename magic variables** for clarity: tap any blue variable bubble, choose "Rename". Good names: `MemoryPayload`, `TranscribedText`, `AuthHeader`.
- **Base64 encoding**: if you want to build the auth header dynamically, use the built-in `Base64 Encode` action on a `Text` containing `username:password`.
- **Category shortcuts**: you can create multiple "Build Memory Payload" variants (or pass category as input) for different memory types like `appointment`, `todo`, or `purchase`.

## Deployment (Raspberry Pi)

Barnaby can be deployed to a Raspberry Pi on your home network, served behind nginx at `barnaby.joshpiserver.local`.

### Prerequisites

- Raspberry Pi running nginx and Pi-hole
- Node.js managed by [`mise`](https://mise.jdx.dev/)
- SSH access as `joshjosh`

### Initial Setup (One-Time on the Pi)

1. Clone the repo:
   ```bash
   git clone <repo-url> ~/barnaby_ts
   ```

2. Run the setup script:
   ```bash
   ~/barnaby_ts/scripts/setup-pi.sh
   ```

3. Create the environment file at `~/.config/barnaby/.env`:
   ```
    PORT=3001
    DATABASE_PATH=/home/joshjosh/.local/share/barnaby/barnaby.db
    BASIC_AUTH_USERNAME=your_username
    BASIC_AUTH_PASSWORD=your_password
    CONTEXT_WINDOW_DAYS=30
    OPENCODE_API_KEY=your_key
    GOOGLE_CLIENT_ID=your_google_client_id
    GOOGLE_CLIENT_SECRET=your_google_client_secret
    GOOGLE_REFRESH_TOKEN=your_google_refresh_token
    CALENDAR_IDS=primary,family@group.calendar.google.com
    YNAB_ACCESS_TOKEN=your_ynab_token
    TELEGRAM_BOT_TOKEN=your_telegram_bot_token
    TELEGRAM_CHAT_ID=your_chat_id
    BRIEFING_CRON=0 8 * * *
   ```

4. Copy the nginx config and enable it:
   ```bash
   sudo cp ~/barnaby_ts/scripts/nginx/barnaby.joshpiserver.local /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/barnaby.joshpiserver.local /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

5. Start the service:
   ```bash
   systemctl --user start barnaby
   ```

### Deploying Updates

From your dev machine, run:
```bash
./scripts/deploy.sh
```

This SSHs into the Pi, pulls the latest code, installs dependencies via `mise`, and restarts the service.

### Database Safety

The SQLite database lives at `~/.local/share/barnaby/barnaby.db` — outside the git repo. The deploy script never touches this directory, so your data is safe across redeploys.

### Architecture Notes

- Barnaby binds to `127.0.0.1:3001` by default (via `HOST` env var), avoiding conflicts with Pi-hole on port 80 and exposure to the LAN
- nginx reverse-proxies `barnaby.joshpiserver.local` → `127.0.0.1:3001`
- The systemd user service auto-restarts on failure

## Memories

These can be anything I decide Barnaby needs to remember for me. Anything from "I have an appointment at 12:00pm" to "This movie was neat!". Memories will be timestamped and categorized. I'm planning to have a couple of buttons mapped to shortcuts that will set the category of a memory.

## Testing
- use vitest

## Authentication 
- use the @fastify/basic-auth package. We don't need anything fancy for 1 user