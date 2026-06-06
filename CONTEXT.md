# Domain Glossary

## Barnaby

The default assistant persona. Warm, casual, and efficient. One of several **Personalities** that can be configured as the active assistant voice.

## Personality

A switchable assistant persona defined by a name, system prompt, and optional speaking examples. Stored in the `personalities` table and selected via the `config` key `personality`. The active personality's prompt is appended to the LLM system prompt on every agent session. The default personality is `yarnaby` (seeded on startup). Other seeded personalities include `barnaby`.

## Active Personality

The personality currently configured for the assistant. Resolved by checking the `config` key `personality`, falling back to the `is_default = 1` row in the `personalities` table, and finally defaulting to `yarnaby`. Changing the active personality via the admin UI reloads the `resourceLoader` so the new system prompt takes effect immediately.

## Memory

Something Barnaby remembers for the user. Categorised as either a **Todo** (a task to do) or a **Note** (general information, facts, reminders). A third category, **Appointment**, exists in the codebase but is legacy — scheduled events belong in Google Calendar.

## Core Memory

A Memory representing an enduring fact about the user: identity, preferences, relationships, or standing instructions. Always included in LLM context regardless of age. Denoted by the `core` tag.

## Resolution

The terminal state of a Todo memory. Either **completed** (task fulfilled) or **dismissed** (no longer relevant). A memory can be resolved at most once. The memory row is preserved for historical reference. Distinct from deletion, which erases the memory entirely.

## Tag

A label attached to a Memory for organisation and retrieval. Tags follow conventions:

- **Domain:** `work`, `personal`, `health`, `finance`, `home`, `family`, `social`
- **Urgency:** `this-week`, `next-week`, `this-month`, `someday`
- **Person:** `person:<name>` (lowercase, no spaces) — used when a memory references a specific person
- **Core:** `core` — marks the memory as a Core Memory

## Briefing

An LLM-generated daily summary delivered via Telegram each morning. Covers upcoming calendar events, active tasks, and weather. Stored to provide continuity and avoid repetition in subsequent briefings.

## Afternoon Update

A lighter follow-up to the Briefing, delivered later in the day. Surfaces things needing attention and anything added since the morning Briefing.

## Telegram

The primary interface for interacting with Barnaby. Regular messages are conversational with read-only access to memories, calendar events, and Google Docs (Barnaby can search and resolve memories, list upcoming calendar events, and read documents from Drive). Slash commands (`/remember`, future `/ynab`, etc.) are focused interactions scoped to a specific domain.

## Admin UI

A secondary interface — server-rendered HTML pages for directly managing memories (browsing, filtering, creating, editing, resolving).
