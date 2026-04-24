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
| 3     | LLM Integration                                       | Not started |
| 4+    | Daily Briefings, Telegram, YNAB + MCP, Home Assistant | Not started |

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

## Memories

These can be anything I decide Barnaby needs to remember for me. Anything from "I have an appointment at 12:00pm" to "This movie was neat!". Memories will be timestamped and categorized. I'm planning to have a couple of buttons mapped to shortcuts that will set the category of a memory.

## Testing
- use vitest

## Authentication 
- use the @fastify/basic-auth package. We don't need anything fancy for 1 user