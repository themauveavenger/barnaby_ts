import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';

export type CalendarBody = {
  message: string;
};

function getCalendarList(): Array<{ id: string; name: string }> {
  try {
    return JSON.parse(process.env.CALENDAR_LIST || '[{"id":"primary","name":"Primary"}]');
  } catch {
    return [{ id: 'primary', name: 'Primary' }];
  }
}

export async function calendarHandler(
  request: FastifyRequest<{ Body: CalendarBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;
  const calendars = getCalendarList();

  const calendarContext = calendars
    .map((c) => `- ${c.name} (ID: ${c.id})`)
    .join('\n');

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  try {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const prompt = [
      `Today is ${today}.`,
      'You have access to Google Calendar tools.',
      `Available calendars:\n${calendarContext}`,
      'Use ISO 8601 format for all dates and times.',
      '',
      request.body.message,
    ].join('\n');

    await session.prompt(prompt);
    const responseText = session.getLastAssistantText() ?? '';
    return { result: responseText };
  } finally {
    session.dispose();
  }
}
