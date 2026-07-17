# Handoff: Session Processor Planning

**Date:** 2026-06-05
**Status:** Planning — no code changes yet

## Summary

Planning an offline session processing feature for Barnaby. The goal: when Telegram chat sessions expire (LRU cache eviction), export them to JSONL files on disk. A scheduled cron job later processes those files to extract memories (facts, preferences, tasks, updates) that weren't explicitly saved via `/remember`.

## Decisions Made

### 1. Session persistence strategy: filesystem + cron

**Chosen:** Keep `SessionManager.inMemory()`, call `session.exportToJsonl()` on the LRU cache `dispose` callback. A cron job later scans for new JSONL files and processes them.

**Why not `SessionManager.create()` (persisted mode):** That mode does `appendFileSync` per entry during live conversations — dozens of small random writes to SD card. `exportToJsonl` does a single sequential write on disposal. Much kinder to the Raspberry Pi 400's SD card.

**Why not child process on dispose:** Adds complexity (lifecycle, IPC, error propagation) without benefit. The LLM call is the expensive part either way. Filesystem approach gives retry resilience for free — if processing fails, the JSONL is still on disk for next cron run.

### 2. Service location: `src/services/session-processor.ts`

Follows existing pattern (`briefing.ts`, `afternoon-update.ts`): factory function + `registerSessionProcessor(fastify)` that wires the dispose hook and registers the cron job.

### 3. Cron schedule: configurable via env var

Same pattern as `BRIEFING_CRON` / `AFTERNOON_UPDATE_CRON`. Daily run, likely overnight. Sporadic usage means files accumulate harmlessly until the job runs. If env var not set, job doesn't register.

### 4. JSONL → LLM input: filter in Node.js first

The raw JSONL is full of noise (tool results, thinking blocks, usage metadata, etc.). Node.js should parse and filter before handing to the agent. Filter plan:

| Keep | Filter out |
|------|-----------|
| `session` header (for timestamp) | `model_change`, `thinking_level_change`, `label`, `session_info`, `custom` entries |
| `message` entries with `role: "user"` (text content only) | `message` entries with `role: "toolResult"` (the biggest bloat — full API responses) |
| `message` entries with `role: "assistant"` (text content only, strip `thinking` and `usage`) | `thinking` content blocks inside assistant messages |
| `compaction` entries (already-summarized context) | `usage` objects inside assistant messages |
| | `bashExecution` messages (won't appear in barnaby sessions but filter if present) |
| | The injected memory context in the first user message (redundant with DB) |

### 5. Compaction: not used for this purpose

Pi's built-in `compact()` produces summaries oriented toward coding task continuity (goals, progress, file operations). Wrong format for memory extraction. Also requires an extra LLM call on dispose. The cron job can read any compaction entries already in the JSONL — no need to trigger one.

### 6. Memory deduplication: mutate in place, not append-only

**Chosen:** Mutate existing memory rows in place via `memoryRepository.update()`. Add a `source` column (`'remember'` | `'session-processor'` | `'admin'`) to track origin.

**Not chosen:** Append-only `memory_updates` table. Would preserve history but adds complexity to every query (`findForContext`, `findRecent` must resolve current version). The harder problem is LLM deduplication logic, not schema. Start simple, add history later if proven necessary.

**Prompt discipline for dedup:** Ask the LLM to compare proposed memories against existing ones and explicitly say "update memory X" or "this is new". The dedup is a prompt problem, not a database problem.

## Current Database Schema (for reference)

```
memories(id PK, content, category [note|todo], permanent, created_at)
tags(id PK, name UNIQUE)
memory_tags(memory_id FK, tag_id FK, PK)
memory_actions(id PK, memory_id FK, action [completed|dismissed], created_at)
briefings(id PK, content, triggered_at, trigger_type [scheduled|manual])
```

Planned addition: `memories` gets a `source TEXT NOT NULL DEFAULT 'remember'` column.

## Key Files

| File | What it does |
|------|-------------|
| `src/services/telegram/session-store.ts` | LRU cache with 15-min TTL, `dispose` callback currently just calls `session.dispose()` |
| `src/services/telegram/chat.ts` | Creates `SessionManager.inMemory()` sessions, builds prompt, calls `session.prompt()` |
| `src/services/telegram/remember.ts` | `/remember` command — creates session with memory tools, disposes immediately |
| `src/services/briefing.ts` | Pattern to follow: `createBriefingService()` + `registerBriefingJob()` |
| `src/services/afternoon-update.ts` | Same pattern: `createAfternoonUpdateService()` + `registerAfternoonUpdateJob()` |
| `src/services/telegram-utils.ts` | `buildMemoryContext()`, `createAgentAndDeliver()` — agent session creation pattern |
| `src/plugins/agent/extensions/memory.ts` | Memory tools (`memory_create`, `memory_list`, `memory_resolve`) — existing CRUD, no dedup |
| `src/agent/memory-guidelines.ts` | Categorization/tagging rules fed to the LLM |
| `src/plugins/database.ts` | Schema definitions, migrations, tag seed data |
| `src/plugins/repository.ts` | Full repository interface — `update()` only supports `content` and `tags` currently |
| `src/app.ts` | `onReady` hook calls `registerHandlers`, `registerBriefingJob`, `registerAfternoonUpdateJob` |

## Pi Session Format (key points)

- JSONL, one entry per line
- Tree structure via `id`/`parentId`
- For processing, just walk the linear path (barnaby sessions don't branch)
- `exportToJsonl()` writes the active branch as a linear sequence (re-chains `parentId` to be sequential)
- Agent session has `.getBranch()` and `.getEntries()` for access, or you can parse the JSONL directly

## Open Questions

1. **Extraction prompt design** — What should the prompt look like? What persona/format should the LLM use to propose memories? How detailed should the comparison against existing memories be?
2. **What tools should the processor agent have?** — `memory_create` and `memory_list` at minimum. Should it have `memory_update` (doesn't exist yet)? Should it create memories directly or output proposals for a second pass?
3. **Should `/remember` sessions be processed?** — They're already explicitly saved. Probably skip them, but how to distinguish? (The session prompt starts with memory guidelines, and the tool set includes `memory_create`.)
4. **Session file location** — Where on disk? Next to `barnaby.db`? Configurable via env var?
5. **File cleanup** — After processing, move to a `processed/` subdirectory or delete?
6. **Error handling** — What if the processor LLM call fails? Retry? Log and skip?

## Suggested Skills

- **tdd** — When implementing the service, use test-driven development for the JSONL parsing/filtering logic
- **conventional-commit** — For commit messages as changes are made