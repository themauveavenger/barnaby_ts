import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import googleAuthPlugin from '../../src/plugins/google-auth.js';
import calendarClientPlugin from '../../src/plugins/calendar-client.js';

const mockList = vi.fn();
const mockInsert = vi.fn();
const mockPatch = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        list: mockList,
        insert: mockInsert,
        patch: mockPatch,
      },
    })),
  },
}));

describe('calendar-client plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';

    app = Fastify({ logger: false });
    await app.register(googleAuthPlugin);
    await app.register(calendarClientPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockList.mockReset();
    mockInsert.mockReset();
    mockPatch.mockReset();
  });

  it('should decorate fastify with calendarClient', () => {
    expect(app.hasDecorator('calendarClient')).toBe(true);
  });

  it('should list events via the Google Calendar API', async () => {
    mockList.mockResolvedValueOnce({
      data: { items: [{ id: '1', summary: 'Test Event' }] },
    });

    const events = await app.calendarClient.listEvents('primary', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    expect(events).toEqual([{ id: '1', summary: 'Test Event' }]);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: 'primary',
        timeMin: '2026-01-01T00:00:00Z',
        timeMax: '2026-01-02T00:00:00Z',
        singleEvents: true,
        orderBy: 'startTime',
      })
    );
  });

  it('should create an event via the Google Calendar API', async () => {
    mockInsert.mockResolvedValueOnce({
      data: { id: '2', summary: 'New Event' },
    });

    const event = await app.calendarClient.createEvent('primary', {
      summary: 'New Event',
      start: { dateTime: '2026-01-01T10:00:00Z' },
      end: { dateTime: '2026-01-01T11:00:00Z' },
    });
    expect(event).toEqual({ id: '2', summary: 'New Event' });
  });

  it('should update an event via the Google Calendar API', async () => {
    mockPatch.mockResolvedValueOnce({
      data: { id: '3', summary: 'Updated Event' },
    });

    const event = await app.calendarClient.updateEvent('primary', '3', { summary: 'Updated Event' });
    expect(event).toEqual({ id: '3', summary: 'Updated Event' });
  });
});
