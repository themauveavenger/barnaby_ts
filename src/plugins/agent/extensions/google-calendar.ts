import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { FastifyInstance } from "fastify";
import { Type } from "typebox";
import { format } from "date-fns";
import { tz, TZDate, tzName } from "@date-fns/tz";
import type { CalendarEvent } from "../../calendar-client.js";

export function formatEventLine(event: CalendarEvent, timezone: string): string {
  const startTime = event.start?.dateTime ?? undefined;
  const endTime = event.end?.dateTime ?? undefined;
  const fmt = (iso: string | undefined) => {
    if (!iso) return "no time";
    const tzAbbr = tzName(timezone, new Date(iso), "short");
    return format(new TZDate(iso, timezone), "h:mm a", { in: tz(timezone) }) + " " + tzAbbr;
  };
  return `- ${event.id} | ${fmt(startTime)} - ${fmt(endTime)} | ${event.summary} | ${event.description ?? ""}`;
}

export function formatEvents(events: CalendarEvent[], timezone: string): string[] {
  return events.map((event) => formatEventLine(event, timezone));
}

export function formatCreateResponse(calendarId: string, event: CalendarEvent, timezone: string): string {
  const lines = [
    `Created event "${event.summary}" on Google Calendar ${calendarId}.`,
    "",
    formatEventLine(event, timezone),
  ];
  return lines.join("\n");
}

export function formatEditResponse(calendarId: string, eventId: string, event: CalendarEvent, timezone: string): string {
  const lines = [
    `Updated event ${eventId} on Google Calendar ${calendarId}.`,
    "",
    formatEventLine(event, timezone),
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
        try {
          const events = await fastify.calendarClient.listEvents(params.calendarId, params.start, params.end);
          const lines: string[] = [
            `Returned ${events.length} events from the Google Calendar ${params.calendarId} between ${params.start} and ${params.end}.`,
            "",
            `Events`,
            ...formatEvents(events, fastify.timezone),
          ];
          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: {},
          };
        } catch (error) {
          fastify.log.error(error, "Failed to list Google Calendar events");
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Failed to list events from Google Calendar ${params.calendarId} between ${params.start} and ${params.end}.\n${message}`,
              },
            ],
            details: {},
          };
        }
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
        try {
          const event = await fastify.calendarClient.createEvent(params.calendarId, {
            summary: params.summary,
            start: { dateTime: params.start },
            end: { dateTime: params.end },
            description: params.description,
          });
          return {
            content: [{ type: "text" as const, text: formatCreateResponse(params.calendarId, event, fastify.timezone) }],
            details: {},
          };
        } catch (error) {
          fastify.log.error(error, "Failed to create Google Calendar event");
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Failed to create event "${params.summary}" on Google Calendar ${params.calendarId}.\n${message}`,
              },
            ],
            details: {},
          };
        }
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
        try {
          const updates: Partial<CalendarEvent> = {};
          if (params.summary !== undefined) updates.summary = params.summary;
          if (params.start !== undefined) updates.start = { dateTime: params.start };
          if (params.end !== undefined) updates.end = { dateTime: params.end };
          if (params.description !== undefined) updates.description = params.description;

          const event = await fastify.calendarClient.updateEvent(params.calendarId, params.eventId, updates);
          return {
            content: [{ type: "text" as const, text: formatEditResponse(params.calendarId, params.eventId, event, fastify.timezone) }],
            details: {},
          };
        } catch (error) {
          fastify.log.error(error, "Failed to update Google Calendar event");
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Failed to update event ${params.eventId} on Google Calendar ${params.calendarId}.\n${message}`,
              },
            ],
            details: {},
          };
        }
      },
    });
  };
}
