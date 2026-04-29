import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { AuthStorage, ModelRegistry, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { getModel } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import { Type } from 'typebox';
import type { CalendarEvent } from "./calendar-client.js";

export type AgentServices = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  model: Model<any>;
  resourceLoader: DefaultResourceLoader;
};

/**
 * Transforms the array of calendar event objects into an array of strings
 * that is easier for an LLM to understand.
 */
function formatEvents(events: CalendarEvent[]): string[] {
  return events.map((event) => {
    return `- ${event.id} | ${event.start?.dateTime} - ${event.end?.dateTime} | ${event.summary} | ${event.description}`;
  });
}

export default fp(async function agentPlugin(fastify: FastifyInstance) {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = getModel('opencode-go', 'minimax-m2.7');

  const calendarExtensionFactory = (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'calendar_list',
      label: 'List Calendar Events',
      description: 'List events from a Google Calendar within a date range',
      parameters: Type.Object({
        calendarId: Type.String({ description: 'Calendar ID or "primary"' }),
        start: Type.String({ description: 'Start date/time in ISO 8601 format' }),
        end: Type.String({ description: 'End date/time in ISO 8601 format' }),
      }),
      async execute(_toolCallId, params) {
        const events = await fastify.calendarClient.listEvents(params.calendarId, params.start, params.end);
        const lines: string[] = [
          `Returned ${events.length} events from the Google Calendar ${params.calendarId} between ${params.start} and ${params.end}.`,
          "",
          `Events`,
          ...formatEvents(events)
        ];
        return {
          content: [{ type: 'text' as const, text: lines.join("\n") }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: 'calendar_create',
      label: 'Create Calendar Event',
      description: 'Create a new event on a Google Calendar',
      parameters: Type.Object({
        calendarId: Type.String(),
        summary: Type.String({ description: 'Event title' }),
        start: Type.String({ description: 'Start date/time in ISO 8601 format' }),
        end: Type.String({ description: 'End date/time in ISO 8601 format' }),
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
          content: [{ type: 'text' as const, text: JSON.stringify(event) }],
          details: {},
        };
      },
    });

    pi.registerTool({
      name: 'calendar_edit',
      label: 'Edit Calendar Event',
      description: 'Update an existing event on a Google Calendar',
      parameters: Type.Object({
        calendarId: Type.String(),
        eventId: Type.String(),
        summary: Type.Optional(Type.String()),
        start: Type.Optional(Type.String({ description: 'Start date/time in ISO 8601 format' })),
        end: Type.Optional(Type.String({ description: 'End date/time in ISO 8601 format' })),
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
          content: [{ type: 'text' as const, text: JSON.stringify(event) }],
          details: {},
        };
      },
    });
  };

  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir: '/dev/null',
    noContextFiles: true,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [calendarExtensionFactory],
    systemPrompt:
      'You are a helpful assistant for casual conversation and general questions. ' +
      'Answer clearly, concisely, and in plain language. ' +
      'Do not write or explain code unless the user explicitly asks for it.',
  });
  await resourceLoader.reload();

  fastify.decorate('agent', { authStorage, modelRegistry, model, resourceLoader });
});
