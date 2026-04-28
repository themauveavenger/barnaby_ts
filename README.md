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

## Roadmap

| Phase | Feature                                               | Status      |
|-------|-------------------------------------------------------|-------------|
| 1     | Core Memories API (CRUD + tags + auth)                | Done        |
| 2     | Voice Memos + Web page for memories                   | Done        |
| 3.1   | LLM Chat endpoint (basic send/receive via pi-mono)    | Done        |
| 3.2   | LLM with memory context                               | Not started |
| 3.3   | Multi-turn session persistence                        | Not started |
| 3.4   | Streaming chat responses                              | Not started |
| 4+    | Daily Briefings, Telegram, YNAB + MCP, Home Assistant | Not started |

## LLM Integration

Barnaby uses the `@mariozechner/pi-coding-agent` SDK (pi-mono) with the OpenCode Go provider. The `POST /chat` endpoint accepts a JSON body `{ "message": string }` and returns `{ "response": string }`.

### Environment Variables
- `OPENCODE_API_KEY` — your OpenCode Go API key (get from [opencode.ai](https://opencode.ai/auth))
- `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` — same auth as the rest of the API

### Example
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n 'user:pass' | base64)" \
  -d '{"message": "Say hello in one word"}'
```

Response: `{"response":"Hello"}`

### Notes
- Each request creates a fresh ephemeral in-memory session with no tool access.
- Local context files (e.g., `AGENTS.md`) are intentionally suppressed so the LLM only sees the user's message.
- Multi-turn conversations and memory-aware context are planned for Phase 3.2+.

## Planned Features
- "memories" for the assistant, stored in a database
  - to be created via api calls
- google calendar access to remind me of upcoming things
- finance access via ynab (mcp server?)
- communication via telegram
- daily summaries & briefings (think todo list) sent via telegram
- voice memos converted to memories
- uses ynab mcp server to perform ynab budget operations
  - creating & editing transactions
- integration with home assistant

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

Barnaby can be deployed to a Raspberry Pi on your home network, served behind nginx at `barnaby.pi.local`.

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
   ```

4. Copy the nginx config and enable it:
   ```bash
   sudo cp ~/barnaby_ts/scripts/nginx/barnaby.pi.local /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/barnaby.pi.local /etc/nginx/sites-enabled/
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

- Barnaby binds to `127.0.0.1:3001` internally to avoid conflicting with Pi-hole on port 80
- nginx reverse-proxies `barnaby.pi.local` → `127.0.0.1:3001`
- The systemd user service auto-restarts on failure

## Memories

These can be anything I decide Barnaby needs to remember for me. Anything from "I have an appointment at 12:00pm" to "This movie was neat!". Memories will be timestamped and categorized. I'm planning to have a couple of buttons mapped to shortcuts that will set the category of a memory.

## Testing
- use vitest

## Authentication 
- use the @fastify/basic-auth package. We don't need anything fancy for 1 user