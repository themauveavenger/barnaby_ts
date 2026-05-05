import type { FastifyRequest, FastifyReply } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';

export type CalendarBody = {
  message: string;
};

export async function calendarHandler(
  request: FastifyRequest<{ Body: CalendarBody }>,
  reply: FastifyReply
) {
  const { authStorage, modelRegistry, model, resourceLoader } = request.server.agent;
  const timezone = request.server.timezone;

  const calendarContext = request.server.calendarIds
    .map((id) => `- ${id}`)
    .join('\n');

  const { session } = await createAgentSession({
    model,
    authStorage,
    modelRegistry,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });

  try {
    const today = format(TZDate.tz(timezone), 'EEEE, MMMM d, yyyy');
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
