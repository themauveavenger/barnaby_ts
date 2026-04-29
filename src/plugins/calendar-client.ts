import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { type calendar_v3, google } from 'googleapis';

export type CalendarEvent = Pick<calendar_v3.Schema$Event, "id" | "summary" | "start" | "end" | "description">;

export type CalendarClient = {
  listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]>;
  createEvent(calendarId: string, event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent>;
  updateEvent(calendarId: string, eventId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
};

export default fp(async function calendarClientPlugin(fastify: FastifyInstance) {
  const auth = fastify.googleAuth.oauth2Client;
  const calendar = google.calendar({ version: 'v3', auth });

  const client: CalendarClient = {
    async listEvents(calendarId, timeMin, timeMax): Promise<CalendarEvent[]> {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return res.data.items || [];
    },

    async createEvent(calendarId, event) {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: event,
      });
      return res.data as CalendarEvent;
    },

    async updateEvent(calendarId, eventId, event) {
      const res = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody: event,
      });
      return res.data as CalendarEvent;
    },
  };

  fastify.decorate('calendarClient', client);
});
