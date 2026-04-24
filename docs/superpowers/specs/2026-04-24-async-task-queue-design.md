# Async Task Queue — Design

**Date:** 2026-04-24  
**Status:** Ideation / Approved for future implementation  
**Goal:** Enable Barnaby to accept tasks asynchronously from iOS Shortcuts, process them autonomously via the LLM agent, and report completion via Telegram.

---

## Philosophy

Barnaby shifts from a real-time chatbot to an assistant with a to-do list. The user fires off instructions and walks away. Barnaby works autonomously and reports back when finished.

This removes HTTP timeout pressure, allows the agent to perform multi-step research or operations, and provides a more natural personal-assistant workflow.

---

## API Contract

### `POST /tasks` — Enqueue a Task

**Request:**
```json
{
  "instruction": "Research the best mechanical keyboards under $200 and summarize"
}
```

**Response (202 Accepted):**
```json
{
  "taskId": "abc-123",
  "status": "pending"
}
```

### `GET /tasks/:id` — Check Task Status

**Response:**
```json
{
  "taskId": "abc-123",
  "status": "running",
  "instruction": "...",
  "result": null,
  "createdAt": "...",
  "completedAt": null
}
```

---

## Data Model

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);
```

---

## Worker Loop

A lightweight poller inside the Fastify process (no separate worker needed for single-user):

```ts
setInterval(async () => {
  const pending = db.prepare('SELECT * FROM tasks WHERE status = ?').all('pending');
  for (const task of pending) {
    await runTask(task);
  }
}, 5000); // poll every 5s
```

### `runTask` Flow

1. Mark task as `running`
2. Create agent session with appropriate tools enabled
3. Run the agent work loop with the user's instruction
4. Agent determines when it's "done" via the `finish` tool
5. Save result, mark as `done` or `failed`
6. Send Telegram notification

---

## Agent Behavior — The "Work Loop"

The agent receives a system prompt that tells it:

> "You are Barnaby, a personal assistant. You have been given a task. Complete it autonomously. Do not ask the user for clarification. Use your tools as needed. When you believe the task is complete, call the `finish` tool with your final response. If you cannot complete the task after reasonable effort, call `finish` with an explanation."

### The `finish` Tool

A custom tool the agent can call to signal completion:

```ts
{
  name: 'finish',
  description: 'Call this when the task is complete or you have given up',
  parameters: {
    result: 'string', // the final answer / summary
    status: 'done | failed'
  }
}
```

The worker watches for the `finish` tool call. When it sees it, the task is complete.

---

## Failure Handling

| Scenario | Behavior |
|----------|----------|
| Agent loops too long | Max iterations (e.g., 20 tool calls), then auto-finish with partial result |
| Agent crashes / throws | Task marked `failed`, error logged, Telegram sends "I ran into a problem" |
| Server restarts mid-task | On startup, scan `status = 'running'` tasks and resume or reset to `pending` |

---

## External Tool Access & Safety Controls

The agent will eventually need access to external services (YNAB, Google Calendar, etc.) via MCP servers or custom tools. This introduces risk: an autonomous agent with write access to budgets or calendars could make unintended changes.

**Design principles for tool access:**

- **Read-only by default** — The agent starts with read access to all integrations. Write access must be explicitly granted per-task or per-tool.
- **Confirmation gate for writes** — High-risk operations (creating transactions, deleting events) should require user confirmation. For the async workflow, this means the agent would pause and send a Telegram message like "I found 3 uncategorized transactions. Should I categorize them as 'Groceries'? Reply YES to proceed."
- **Dry-run mode** — Agents can preview what they would do before doing it. E.g., "Here's the YNAB transaction I would create: ... Does this look right?"
- **Tool-level allowlists** — The system controls which tools the agent gets per task type. A "research" task gets web search and file read. A "budget" task gets YNAB read. Only explicit "action" tasks get YNAB write.
- **Audit log** — All tool calls and their results are logged to the `tasks` table or a separate `task_events` table for review.

**Open question:** Should there be a Barnaby-specific MCP proxy that enforces these policies, or should the policies live in the agent's system prompt + tool wrappers? This needs prototyping.

---

## Integration with Existing Features

- **`/chat` remains synchronous** — Used for testing prompts, system prompt overrides, and quick questions. It does not trigger the task queue.
- **Memories** — The agent may create memories as part of task execution (e.g., "Remember that I researched mechanical keyboards"). This is a future enhancement.
- **iOS Shortcuts** — A new shortcut "Send Task to Barnaby" will POST to `/tasks` instead of `/memories` or `/chat`. Same auth, same payload shape, different endpoint.

---

## Open Questions (Intentionally TBD)

- What tools does the agent get in v1? Start with `read`, `bash`, `web_fetch`, then add YNAB/calendar tools later.
- What's the exact system prompt? Needs experimentation.
- Should tasks be retryable? Probably not for v1.
- Should we cap max runtime? Yes, probably a 5-minute wall-clock timeout.
- What does the Telegram message look like? Start simple: `Task complete: ${result}`.
- How do we safely give the agent write access to external services without unintended side effects? (See External Tool Access section above.)

---

## Out of Scope

- Real-time streaming to the client (Phase 3.4 covers this for `/chat`, not tasks)
- Multi-user support or task isolation
- Web UI for task queue management (can be added later)
- Scheduled/recurring tasks (Phase 4+)
