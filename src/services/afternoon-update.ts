import type { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { TZDate, tzName } from '@date-fns/tz';
import { add, format } from 'date-fns';
import { getTimeOfDay, buildMemoryContext, createAgentAndDeliver } from './telegram-utils.js';

export interface AfternoonUpdateService {
  sendUpdate(signal?: AbortSignal): Promise<void>;
}

export function createAfternoonUpdateService(fastify: FastifyInstance): AfternoonUpdateService {
  return {
    async sendUpdate(signal?: AbortSignal) {
      const timezone = fastify.timezone;
      const tzNow = TZDate.tz(timezone);
      const now = new Date();
      const today = format(tzNow, 'EEEE, MMMM d, yyyy');
      const timeOfDay = getTimeOfDay(tzNow.getHours());

      const previousBriefing = fastify.briefingRepository.findLatest();
      const previousContext = previousBriefing
        ? `\n\nHere is the most recent briefing (sent ${new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US')}) for reference. Do not repeat information from it unless something has changed or it requires an update:\n\n${previousBriefing.content}`
        : '';

      const memoryContext = buildMemoryContext(fastify);

      const todayStart = new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), timezone);
      const todayEnd = add(todayStart, { days: 1 });
      const weekStart = todayEnd;
      const weekEnd = add(todayStart, { days: 4 });

      const tzAbbr = tzName(timezone, now, 'short');
      const tzLong = tzName(timezone, now, 'longGeneric');

      const calendarContext = fastify.calendarIds.length > 0
        ? `Available calendars:\n${fastify.calendarIds.map(id => `- ${id}`).join('\n')}`
        : '';

      const prompt = [
        `Today is ${today}. It is currently ${timeOfDay}. All times are in ${tzLong} (${timezone}, ${tzAbbr}).`,
        '',
        memoryContext,
        '',
        calendarContext,
        '',
        'INSTRUCTIONS:',
        'Use the calendar_list tool to fetch events for each available calendar across these two ranges:',
        `1. Today:       start "${todayStart.toISOString()}"     end "${todayEnd.toISOString()}"`,
        `2. Next 3 days: start "${weekStart.toISOString()}"      end "${weekEnd.toISOString()}"`,
        '',
        'Generate a brief afternoon check-in based on those events and the notes above.',
        '- Start with a brief, warm greeting referencing the time of day.',
        '- Focus on what is ahead this afternoon and evening.',
        '- Highlight anything new or changed since the morning briefing.',
        '- If memories were added today, mention only newly relevant ones.',
        '- Use 1-2 short paragraphs, max 100 words.',
        '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
        '- If no calendar events exist, do not mention the calendar at all.',
        '- If no memories or tasks exist, do not mention them at all.',
        '- Do not remind the user about any task listed in the "completed or dismissed" section — those are already handled.',
        '- Do not mention core memories unless the user explicitly asks about them.',
        '- Never apologize for lack of information; just provide what you have.',
        '- If a tool returns an error, mention it briefly in plain English and move on.',
        '- Do not use emojis.',
        '- End with one brief, encouraging closing line.',
        previousContext
      ].filter(s => s !== '').join('\n');

      fastify.log.debug({ prompt }, 'Built afternoon update prompt');

      await createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt,
        signal
      });
    }
  };
}

export function registerAfternoonUpdateJob(fastify: FastifyInstance): void {
  const afternoonUpdateService = createAfternoonUpdateService(fastify);
  const cronExpression = process.env.AFTERNOON_UPDATE_CRON;

  if (!cronExpression) {
    fastify.log.warn('AFTERNOON_UPDATE_CRON is not set, skipping afternoon update job registration');
    return;
  }

  const task = new AsyncTask(
    'afternoon-update-task',
    async () => {
      await afternoonUpdateService.sendUpdate();
    },
    (err: Error) => {
      fastify.log.error(err, 'Afternoon update cron task failed');
    }
  );

  const job = new CronJob(
    { cronExpression },
    task,
    { id: 'afternoon-update-job', preventOverrun: true }
  );

  fastify.scheduler.addCronJob(job);
}
