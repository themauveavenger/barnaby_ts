import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { buildTestApp } from '../helper.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async () => {}),
  getLastAssistantText: vi.fn(() => 'Created event "Dinner" on the family calendar.'),
  dispose: vi.fn(),
};

vi.mock('@mariozechner/pi-coding-agent', async () => {
  const actual = await vi.importActual<typeof import('@mariozechner/pi-coding-agent')>('@mariozechner/pi-coding-agent');
  return {
    ...actual,
    createAgentSession: vi.fn(async () => ({
      session: mockSession,
    })),
    SessionManager: {
      inMemory: vi.fn(() => ({})),
    },
  };
});

describe('Calendar API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    process.env.CALENDAR_IDS = 'test@example.com,family@group.calendar.google.com';
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockSession.prompt.mockClear();
    mockSession.getLastAssistantText.mockClear();
    mockSession.dispose.mockClear();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      payload: { message: 'list my events' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject missing message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return a result for a valid message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'create an event on the family calendar for May 15' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('result');
    expect(typeof body.result).toBe('string');
    expect(body.result).toBe('Created event "Dinner" on the family calendar.');
  });

  it('should create an agent session without noTools', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        noTools: 'all',
      })
    );
  });

  it('should include calendar context in the prompt', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'what is on my calendar today' },
    });

    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Today is')
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Available calendars:')
    );
    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('family@group.calendar.google.com')
    );
  });

  it('should dispose the session after use', async () => {
    await app.inject({
      method: 'POST',
      url: '/calendar/events',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(mockSession.dispose).toHaveBeenCalled();
  });
});
