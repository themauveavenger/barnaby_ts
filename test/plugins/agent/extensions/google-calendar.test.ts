import { describe, it, expect } from "vitest";
import {
  formatEventLine,
  formatEvents,
  formatCreateResponse,
  formatEditResponse,
} from "../../../../src/plugins/agent/extensions/google-calendar.js";
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
    const event = makeEvent({
      description: undefined,
      start: { dateTime: undefined },
      end: { dateTime: undefined },
    });
    expect(formatEventLine(event)).toBe(
      "- evt-1 | undefined - undefined | Team Standup | undefined"
    );
  });
});

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

describe("formatCreateResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "new-1", summary: "New Meeting" });
    const result = formatCreateResponse("primary", event);
    expect(result).toContain(
      'Created event "New Meeting" on Google Calendar primary.'
    );
    expect(result).toContain("- new-1 |");
  });
});

describe("formatEditResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "edit-1", summary: "Updated Meeting" });
    const result = formatEditResponse("work@example.com", "edit-1", event);
    expect(result).toContain(
      "Updated event edit-1 on Google Calendar work@example.com."
    );
    expect(result).toContain("- edit-1 |");
  });
});
