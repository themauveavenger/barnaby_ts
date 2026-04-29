import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import type { CalendarEvent } from "../../calendar-client.js";

export function formatEventLine(event: CalendarEvent): string {
  return `- ${event.id} | ${event.start?.dateTime} - ${event.end?.dateTime} | ${event.summary} | ${event.description}`;
}

/**
 * Transforms the array of calendar event objects into an array of strings
 * that is easier for an LLM to understand.
 */
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

export default function createCalendarExtension(fastify: FastifyInstance): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: "calendar_list",
      label: "List Calendar Events",
      description: "List events from a Google Calendar within a date range",
      parameters: Type.Object({
        calendarId: Type.String({ description: 'Calendar ID or "primary"' }),
        start: Type.String({ description: "Start date/time in ISO 8601 format" }),
        end: Type.String({ description: "End date/time in ISO 8601 format" }),
      }),
      async execute(_toolCallId, params) {
        const events = await fastify.calendarClient.listEvents(params.calendarId, params.start, params.end);
        const lines: string[] = [
          `Returned ${events.length} events from the Google Calendar ${params.calendarId} between ${params.start} and ${params.end}.`,
          "",
          `Events`,
          ...formatEvents(events),
        ];
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: "calendar_create",
      label: "Create Calendar Event",
      description: "Create a new event on a Google Calendar",
      parameters: Type.Object({
        calendarId: Type.String(),
        summary: Type.String({ description: "Event title" }),
        start: Type.String({ description: "Start date/time in ISO 8601 format" }),
        end: Type.String({ description: "End date/time in ISO 8601 format" }),
        description: Type.Optional(Type.String()),
      }),
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
      },
    });

    pi.registerTool({
      name: "calendar_edit",
      label: "Edit Calendar Event",
      description: "Update an existing event on a Google Calendar",
      parameters: Type.Object({
        calendarId: Type.String(),
        eventId: Type.String(),
        summary: Type.Optional(Type.String()),
        start: Type.Optional(Type.String({ description: "Start date/time in ISO 8601 format" })),
        end: Type.Optional(Type.String({ description: "End date/time in ISO 8601 format" })),
        description: Type.Optional(Type.String()),
      }),
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
      },
    });
  };
}
