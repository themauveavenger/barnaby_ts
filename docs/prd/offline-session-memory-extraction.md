# PRD: Offline Session Memory Extraction

## Problem Statement

Barnaby only persists memories that the user explicitly saves via `/remember`. Everything said in regular Telegram conversations is lost when the LRU session cache expires. Follow-up questions, casual asides, and important facts mentioned in natural chat ("I'm allergic to shellfish," "my sister's birthday is March 3rd") evaporate after 15 minutes of inactivity. The user must consciously invoke `/remember` to preserve anything, which is unnatural and leads to an impoverished long-term memory.

## Solution

When a Telegram chat session expires (LRU cache eviction), export the full conversation to a JSONL file on disk. A scheduled cron job later scans for unprocessed files, filters out noise, and runs an LLM agent over the conversation to extract memories (facts, preferences, tasks, updates) that weren't explicitly saved. These are deduplicated against existing memories and written into the database via the same repository layer that `/remember` uses. The user gets passive memory accumulation from normal conversation without any change to the chat UX.

## User Stories

1. As a user, when I casually mention "I'm going to Japan in April" during normal chat, I want Barnaby to remember that without me typing `/remember`, so that the conversation feels natural.
2. As a user, when Barnaby extracts a memory from an old conversation, I want it to avoid creating a duplicate if I already `/remember`ed the same fact, so that my memory list doesn't get cluttered.
3. As a user, when the cron job processes a session file, I want to know which memories came from automatic extraction vs. explicit `/remember`, so that I can audit or correct the source later.
4. As a user, when a session processing job fails, I want the JSONL file to remain on disk and be retried later, so that no conversation is lost to a transient error.
5. As a user, when I review my memories in the Admin UI, I want to see a `source` indicator showing whether a memory was created by me (`/remember`) or by the session processor, so that I understand its provenance.
6. As a user, when the session processor extracts a memory about a person, I want it to benefit from entity normalization automatically, so that "Sarah from work" and "Sarah my sister" are handled correctly without extra processor logic.
7. As a developer, when I add a new memory from the session processor, I want it to be immediately searchable by keyword and semantic similarity, so that the new retrieval layer (PRD #3) works end-to-end.
8. As a user, when I explicitly `/remember` something during a session, I want the cron job to skip that session rather than re-process it, so that `/remember` remains the authoritative source and I don't get near-duplicate entries.
9. As a user, when the cron job runs overnight, I want it to process all accumulated files in a single batch without interfering with live conversations, so that the server stays responsive during the day.
10. As a developer, when I look at the codebase, I want the session processor to follow the same service + cron pattern as `briefing.ts` and `afternoon-update.ts`, so that the architecture stays consistent.

## Implementation Decisions

### 1. Session persistence strategy: filesystem + cron

When the LRU cache disposes a session, `SessionStore` calls `session.exportToJsonl()` and writes the result to disk in a single sequential write. A cron job later scans for new JSONL files and processes them.

**Not `SessionManager.create()` (persisted mode):** That mode appends every entry to disk during live conversations — dozens of small random writes. The Raspberry Pi 400's SD card is much happier with one write on eviction.

**Not a child process on dispose:** Adds IPC and lifecycle complexity without benefit. The filesystem approach gives free retry resilience — if processing fails, the file is still there for the next cron run.

### 2. Service location: `src/services/session-processor.ts`

Follows the existing `briefing.ts` / `afternoon-update.ts` pattern: a `createSessionProcessorService(deps)` factory plus `registerSessionProcessor(fastify)` that wires both the LRU `dispose` hook and the cron job.

### 3. Export path and file format

Env var `SESSION_EXPORT_PATH` defaults to the same directory as `DATABASE_URL` (e.g., next to `barnaby.db`). Files are named `{chatId}_{timestamp}.jsonl`.

On dispose, `session-store.ts` calls the Pi SDK's `session.exportToJsonl(outputPath)`, which writes the session header and all entries on the current branch as a linearized JSONL file. This is a single sequential write — much kinder to the SD card than per-entry append operations.

### 4. `/remember` sessions are not exported

`/remember` (`handleRemember`) creates its own `AgentSession`, calls `session.prompt()`, and disposes it immediately in a `finally` block. It never uses the LRU session cache in `session-store.ts` and therefore never triggers the `dispose` callback that writes JSONL files.

The export pipeline only processes chat sessions from `handleChat` that expire from the LRU cache after 15 minutes of inactivity. No skip detection is needed.

### 5. JSONL → LLM input: filter in Node.js

The raw JSONL contains noise that would distract the extraction LLM and bloat the context window. Node.js parses and filters before building the agent prompt:

| Keep | Discard |
|------|---------|
| `session` header (timestamp) | `model_change`, `thinking_level_change`, `label`, `session_info`, `custom` |
| `message` with `role: "user"` (text only) | `message` with `role: "toolResult"` (large API response payloads) |
| `message` with `role: "assistant"` (text only, strip `thinking`/`usage`) | `thinking` blocks inside assistant messages |
| `compaction` entries | `usage` objects inside assistant messages |
| | `bashExecution` entries |
| | Injected memory context in the first user message (redundant with DB) |

`compaction` entries are kept. Pi's compaction summaries are coding-oriented, but Barnaby sessions rarely auto-compact. In the uncommon case that a long session does compact, the summary may contain distilled facts worth extracting.

The filtered conversation is concatenated into a plain-text transcript with speaker prefixes (`User:`, `Assistant:`) for the LLM.

**Context window sizing:** Before implementing chunking, measure the filter's reduction ratio against real Pi session files (available at `~/.pi/agent/sessions/`). If pre-filtering consistently reduces transcripts below the LLM context window — likely for typical Telegram sessions — no chunking logic is needed. If long sessions exceed the limit after filtering, add a chunking step that splits the transcript at message boundaries and runs extraction per chunk. Chunking is explicitly v2 and not part of this PRD's scope.

### 6. No compaction on dispose

Pi's built-in `compact()` produces coding-oriented summaries (goals, progress, files touched). Wrong format for memory extraction. It also costs an extra LLM call on dispose. We do not trigger `compact()` ourselves. Any compaction entries already present in the JSONL are retained during filtering (Decision #5) and fed to the extraction LLM as potential source material.

### 7. Deduplication strategy: create-only in v1, with a `source` column

In v1, the processor agent extracts memories using `memory_create` only — no `memory_update`. The processor prompt is given the filtered transcript and a list of existing memories (via `memory_list`). Its instructions are explicit:

- Extract candidate memories from the conversation.
- Compare each candidate against the existing memory list.
- If a candidate is substantively the same as an existing memory, **do not create a new memory**.
- Only call `memory_create` for facts that are genuinely new or meaningfully different.

This is prompt-level deduplication, not tool-driven mutation. It reduces clutter without the correctness risks of LLM-driven updates (hallucinating memory IDs, conflating similar but distinct facts). Near-duplicates that still slip through are flagged for admin review via the `source` column.

**Deduplication v2 (future):** Once PRD #3's embedding-based search is available, add a post-extraction similarity check: after the processor creates memories, compare each new memory's embedding against existing ones. Flag near-duplicates for admin review rather than auto-mutating. Introduce `memory_update` as a processor tool only when proven reliable.

**Schema addition:** `memories` gets a `source TEXT NOT NULL DEFAULT 'remember'` column with values `'remember'` | `'session-processor'` | `'admin'`. The default is `'remember'` so existing code continues to work, but the `memory_create` tool and repository's `create()` method must be updated to accept an explicit `source` parameter. The `/remember` handler and session processor each set `source` appropriately rather than relying on the SQL default.

**Why not append-only:** Would preserve history but every read query (`findForContext`, `findRecent`) would need to resolve current versions. Start simple; add history later if proven necessary.

### 8. Processor agent tool set

The processor agent session is created with:
- `memory_list` — to retrieve existing memories for comparison.
- `memory_create` — to insert new memories with `source: 'session-processor'`.

No `memory_update` in v1 (see Decision #7). The `memory_update` tool is deferred to deduplication v2.

The agent does **not** need entity tools; entity extraction happens automatically inside `memoryRepository.create()` per PRD #2.

### 9. Cron schedule: configurable via env var

Same pattern as `BRIEFING_CRON` / `AFTERNOON_UPDATE_CRON`. Daily run, likely overnight. Sporadic usage means files accumulate harmlessly. If the env var is not set, the job does not register.

### 10. File cleanup after processing

After successful processing, files are moved to a `processed/` subdirectory within `SESSION_EXPORT_PATH`. If processing partially fails (e.g., LLM error mid-batch), the file stays in place for retry. A per-file retry counter or a dead-letter quarantine can be added later if needed.

### 11. Error handling

- **LLM call failure:** Log the error, leave the file in place. The next cron run will retry.
- **File I/O failure:** Same — do not delete or move the file.
- **Malformed JSONL:** Move to a `quarantine/` subdirectory and log an alert so it can be inspected manually.

## Integration with Other PRDs

- **PRD #1 (Session Support):** Builds directly on the LRU cache `dispose` callback introduced there. The `session-store.ts` module is updated to call `session.exportToJsonl(outputPath)` on dispose, writing the linearized session branch to disk.
- **PRD #2 (Entity Normalization):** **This PRD depends on PRD #2 being merged first.** `memoryRepository.create()` automatically extracts and links entities. The processor does not handle entities explicitly; it benefits from this layer transparently.
- **PRD #3 (Memory Retrieval):** New memories from the processor are immediately searchable by keyword (FTS5 triggers) and semantic search (embedding generated synchronously on write). The processor can use `memoryRepository.search()` or `memory_list` to ground deduplication in actual DB state.
- **PRD #5 (Personality):** The processor's extraction prompt should adopt the active personality's voice when summarizing memories. The prompt is loaded via the same `appendSystemPromptOverride` mechanism so it stays consistent with the runtime personality.

## Testing Decisions

- **Primary seam: the filtering logic.** Add unit tests (not e2e) for the JSONL parse-and-filter function in `src/services/session-processor.ts`. Use synthetic JSONL fixtures with mixed entry types. Assert that noise is stripped and the transcript format is correct.
- **Cron integration: e2e with `inject()`.** Instantiate `buildApp()` with an in-memory DB and a temp directory for `SESSION_EXPORT_PATH`. Drop a synthetic JSONL file, trigger the processor job, assert that `memoryRepository.findAll()` contains the expected new memory.
- **Deduplication test:** Seed the DB with a memory, run the processor over a transcript that contains the same fact phrased differently, assert that the processor's prompt instructs it to skip known facts. Accept that near-duplicates may still be created — the `source` column lets the admin identify and clean these up.
- **`/remember` not exported test:** Verify that `/remember` sessions (created and disposed directly by `handleRemember`) never appear in `SESSION_EXPORT_PATH`. Only LRU-expired chat sessions are processed.
- **Entity link test:** A processed transcript mentioning "Josh prefers dark mode" should create a memory linked to the user entity via `memory_entities`, verified by `memoryRepository.findByEntity('josh')`.
- **Migration test:** Start with a database at `user_version` 0, run the migrations, verify the `source` column exists on `memories` and the `user_version` pragma has been incremented. Start with a database already at the latest version and verify no ALTER statements run.

## Out of Scope

- Real-time processing (child process on dispose, WebSocket, or queue). The cron-batch approach is deliberate for SD-card health.
- Mid-session memory extraction (processing while the user is still chatting). Only expired sessions are processed.
- Admin UI for reviewing/processing individual files. The cron is fully automatic.
- Configurable per-session TTL for export (uses the same 15-minute LRU TTL as PRD #1).
- Automatic retry with backoff beyond "leave file for next cron run."
- Deleting old processed files (archival is manual for now).
- Exporting session files for human reading (the format is internal).
- Multi-user session separation (this is a single-user bot).

## Database Migrations

> **Sequencing note:** The migration framework itself must be implemented **first**, in its own commit, before any PRD that depends on schema changes (including this one). A separate design session will define the full framework, but the minimal `user_version` + ordered array approach described below is sufficient to unblock this PRD's `source` column.

Schema changes are tracked using SQLite's `user_version` pragma — a free integer in the database file header reserved for application use. Each migration is an ordered entry in a `migrations` array. On startup, the app reads `PRAGMA user_version` and runs all migrations with a higher version number, then sets `user_version` to the latest version.

```typescript
const migrations: Array<{ version: number; sql: string }> = [
  { version: 1, sql: 'ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0' },
  { version: 2, sql: "ALTER TABLE memories ADD COLUMN source TEXT NOT NULL DEFAULT 'remember'" },
];
```

The existing ad-hoc `ALTER TABLE` checks in `database.ts` (e.g., `hasPermanent`) are replaced by this migration system. The `CREATE TABLE` block runs for fresh installs (version 0). Migrations run in a transaction so a failure leaves the database unchanged and the `user_version` un-incremented.

This approach is simpler than a `migrations` table (no extra schema), idempotent by design, and well-established in the SQLite ecosystem.

## Further Notes

- The `source` column is a lightweight provenance marker. It does not affect retrieval ranking or filtering in v1, but it enables future features like "show me only auto-extracted memories" or "let me audit processor contributions."
- The processor's extraction prompt is the highest-leverage design choice. It should be stored in the database (or as a migration) so it can be tuned without code changes. A table like `prompt_templates(name, content)` may be warranted if other features (briefings, afternoon updates) also need runtime prompt tuning.
- The `@xenova/transformers` embedding model from PRD #3 is loaded at startup. The processor runs in the same process, so it can reuse the same provider instance for any embedding needs (e.g., embedding the transcript for semantic dedup queries).
- The processor's LLM call may be long (full conversation transcript). The existing `withTimeout` helper should be used, but with a longer timeout than the 45-second chat default if necessary.
- If a session contains tool results (weather, Wolfram, memory lookups), those results are filtered out of the transcript. The assistant's *reaction* to the result (the text it generated) is kept, which usually contains the salient fact.
- **Concurrent writes:** If a session is disposed while the cron is processing files, the JSONL could be partially written when the cron picks it up. Write to a `.tmp` suffix and rename atomically, or have the cron skip files modified within the last N seconds.
