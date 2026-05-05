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

const timezone = "America/New_York";

describe("formatEventLine", () => {
  it("formats a complete event with local times", () => {
    const event = makeEvent();
    const result = formatEventLine(event, timezone);
    expect(result).toBe("- evt-1 | 5:00 AM EDT - 5:30 AM EDT | Team Standup | Daily sync");
  });

  it("handles missing optional fields", () => {
    const event = makeEvent({
      description: undefined,
      start: { dateTime: undefined },
      end: { dateTime: undefined },
    });
    expect(formatEventLine(event, timezone)).toBe(
      "- evt-1 | no time - no time | Team Standup | "
    );
  });
});

describe("formatEvents", () => {
  it("returns empty array for no events", () => {
    expect(formatEvents([], timezone)).toEqual([]);
  });

  it("formats multiple events", () => {
    const events = [
      makeEvent({ id: "a", summary: "Event A" }),
      makeEvent({ id: "b", summary: "Event B" }),
    ];
    const result = formatEvents(events, timezone);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Event A");
    expect(result[1]).toContain("Event B");
  });
});

describe("formatCreateResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "new-1", summary: "New Meeting" });
    const result = formatCreateResponse("primary", event, timezone);
    expect(result).toContain(
      'Created event "New Meeting" on Google Calendar primary.'
    );
    expect(result).toContain("- new-1 |");
  });
});

describe("formatEditResponse", () => {
  it("returns summary line and event details", () => {
    const event = makeEvent({ id: "edit-1", summary: "Updated Meeting" });
    const result = formatEditResponse("work@example.com", "edit-1", event, timezone);
    expect(result).toContain(
      "Updated event edit-1 on Google Calendar work@example.com."
    );
    expect(result).toContain("- edit-1 |");
  });
});
