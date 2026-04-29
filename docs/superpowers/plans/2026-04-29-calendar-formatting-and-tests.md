# Calendar Agent Tools Output Formatting + Unit Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `calendar_create` and `calendar_edit` tool responses to use human-readable summary + stripped event details (matching `calendar_list` style), and add unit tests for all formatting logic.

**Architecture:** Extract pure formatting helper functions from the inline tool execute bodies so they can be unit-tested independently. The tools remain thin wrappers around `fastify.calendarClient` calls plus a formatting helper call.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/plugins/agent/extensions/google-calendar.ts` | Extension factory + tool registrations + pure formatting utilities (to be exported) |
| `test/plugins/agent/extensions/google-calendar.test.ts` | Unit tests for formatting utilities |

---

## Task 1: Extract Pure Formatting Utilities

**Files:**
- Modify: `src/plugins/agent/extensions/google-calendar.ts`

**Context:** `calendar_list` already builds a readable multi-line response. `calendar_create` and `calendar_edit` currently return `JSON.stringify(event)`. We want the same pattern for all three: a one-line summary, a blank line, then the stripped-down event data.

- [ ] **Step 1: Extract `formatEventLine` and export formatting helpers**

Refactor `formatEvents` to delegate to a new `formatEventLine`. Add `formatCreateResponse` and `formatEditResponse`. Export all three so tests can import them.

```typescript
export function formatEventLine(event: CalendarEvent): string {
  return `- ${event.id} | ${event.start?.dateTime} - ${event.end?.dateTime} | ${event.summary} | ${event.description}`;
}

export function formatEvents(events: CalendarEvent[]): string[] {
  return events.map(formatEventLine);
}

export function formatCreateResponse(calendarId: string, event: CalendarEvent): string {
  const lines = [
    `Created event "${event.summary}" on Google Calendar ${calendarId}.`,
    "",
    formatEventLine(event),
  ];
  return lines.join("\n");
}

export function formatEditResponse(calendarId: string, eventId: string, event: CalendarEvent): string {
  const lines = [
    `Updated event ${eventId} on Google Calendar ${calendarId}.`,
    "",
    formatEventLine(event),
  ];
  return lines.join("\n");
}
```

- [ ] **Step 2: Wire helpers into `calendar_create` and `calendar_edit`**

Update the `execute` blocks to call the new helpers instead of `JSON.stringify(event)`.

For `calendar_create`:
```typescript
async execute(_toolCallId, params) {
  const event = await fastify.calendarClient.createEvent(params.calendarId, {
    summary: params.summary,
    start: { dateTime: params.start },
    end: { dateTime: params.end },
    description: params.description,
  });
  return {
    content: [{ type: "text" as const, text: formatCreateResponse(params.calendarId, event) }],
    details: {},
  };
}
```

For `calendar_edit`:
```typescript
async execute(_toolCallId, params) {
  const updates: Record<string, unknown> = {};
  if (params.summary !== undefined) updates.summary = params.summary;
  if (params.start !== undefined) updates.start = { dateTime: params.start };
  if (params.end !== undefined) updates.end = { dateTime: params.end };
  if (params.description !== undefined) updates.description = params.description;

  const event = await fastify.calendarClient.updateEvent(params.calendarId, params.eventId, updates);
  return {
    content: [{ type: "text" as const, text: formatEditResponse(params.calendarId, params.eventId, event) }],
    details: {},
  };
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors

- [ ] **Step 4: Run existing test suite**

```bash
npm test
```
Expected: all 55 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/plugins/agent/extensions/google-calendar.ts
git commit -m "refactor(agent): extract calendar output formatters and use them in create/edit tools"
```

---

## Task 2: Add Unit Tests for Formatting Utilities

**Files:**
- Create: `test/plugins/agent/extensions/google-calendar.test.ts`

**Context:** These are pure functions with no Fastify or network dependencies, so tests import the helpers directly and assert on string output.

- [ ] **Step 1: Create test file with `formatEventLine` tests**

```typescript
import { describe, it, expect } from "vitest";
import { formatEventLine, formatEvents, formatCreateResponse, formatEditResponse } from "../../../../src/plugins/agent/extensions/google-calendar.js";
import type { CalendarEvent } from "../../../../src/plugins/calendar-client.js";

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    summary: "Team Standup",
    start: { dateTime: "2026-04-29T09:00:00Z" },
    end: { dateTime: "2026-04-29T09:30:00Z" },
    description: "Daily sync",
    ...overrides,
  };
}

describe("formatEventLine", () => {
  it("formats a complete event", () => {
    const event = makeEvent();
    expect(formatEventLine(event)).toBe(
      "- evt-1 | 2026-04-29T09:00:00Z - 2026-04-29T09:30:00Z | Team Standup | Daily sync"
    );
  });

  it("handles missing optional fields", () => {
    const event = makeEvent({ description: undefined, start: { dateTime: undefined }, end: { dateTime: undefined } });
    expect(formatEventLine(event)).toBe(
      "- evt-1 | undefined - undefined | Team Standup | undefined"
    );
  });
});
```

- [ ] **Step 2: Add `formatEvents` tests**

```typescript
describe("formatEvents", () => {
  it("returns empty array for no events", () => {
    expect(formatEvents([])).toEqual([]);
  });

  it("formats multiple events", () => {
    const events = [
      makeEvent({ id: "a", summary: "Event A" }),
      makeEvent({ id: "b", summary: "Event B" }),
    ];
    const result = formatEvents(events);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Event A");
    expect(result[1]).toContain("Event B");
  });
});
```

- [ ] **Step 3: Add `formatCreateResponse` tests**

```typescript
describe("formatCreateResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "new-1", summary: "New Meeting" });
    const result = formatCreateResponse("primary", event);
    expect(result).toContain('Created event "New Meeting" on Google Calendar primary.');
    expect(result).toContain("- new-1 |");
  });
});
```

- [ ] **Step 4: Add `formatEditResponse` tests**

```typescript
describe("formatEditResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "edit-1", summary: "Updated Meeting" });
    const result = formatEditResponse("work@example.com", "edit-1", event);
    expect(result).toContain("Updated event edit-1 on Google Calendar work@example.com.");
    expect(result).toContain("- edit-1 |");
  });
});
```

- [ ] **Step 5: Run new tests**

```bash
npx vitest run test/plugins/agent/extensions/google-calendar.test.ts
```
Expected: all 6 tests pass

- [ ] **Step 6: Run full test suite**

```bash
npm test
```
Expected: all tests pass (previous 55 + new 6)

- [ ] **Step 7: Commit**

```bash
git add test/plugins/agent/extensions/google-calendar.test.ts
git commit -m "test(agent): add unit tests for calendar formatting utilities"
```

---

## Self-Review Checklist

1. **Spec coverage:** Both requirements are covered — (a) refactor create/edit output formatting, (b) add unit tests.
2. **Placeholder scan:** No TBDs or vague steps. All code blocks contain exact implementation.
3. **Type consistency:** `CalendarEvent` type is reused from `calendar-client.js`. Helper signatures match usage in the source file.
