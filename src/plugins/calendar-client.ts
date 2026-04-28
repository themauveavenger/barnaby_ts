import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { google } from 'googleapis';

export type CalendarEvent = {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  description?: string;
};

export type CalendarClient = {
  listEvents(calendarId: string, timeMin: string, timeMax: string): Promise<CalendarEvent[]>;
  createEvent(calendarId: string, event: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent>;
  updateEvent(calendarId: string, eventId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent>;
};

export default fp(async function calendarClientPlugin(fastify: FastifyInstance) {
  const auth = fastify.googleAuth.oauth2Client;
  const calendar = google.calendar({ version: 'v3', auth });

  const client: CalendarClient = {
    async listEvents(calendarId, timeMin, timeMax) {
      const res = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        singleEvents: true,
        orderBy: 'startTime',
      });
      return (res.data.items || []) as CalendarEvent[];
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
