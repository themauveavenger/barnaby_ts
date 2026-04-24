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
| 2     | Voice Memos + Web page for memories                   | Not started |
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

I will use iOS shortcuts to transcribe voice to text. The text will then be an input to a remote SSH script that runs on the same server where Barnaby is hosted. The SSH script will call the POST /memories route to insert a new memory into the database.

## Memories

These can be anything I decide Barnaby needs to remember for me. Anything from "I have an appointment at 12:00pm" to "This movie was neat!". Memories will be timestamped and categorized. I'm planning to have a couple of buttons mapped to shortcuts that will set the category of a memory.

## Testing
- use vitest

## Authentication 
- use the @fastify/basic-auth package. We don't need anything fancy for 1 user