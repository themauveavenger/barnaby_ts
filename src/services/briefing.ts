import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager } from '@mariozechner/pi-coding-agent';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { TZDate, tzName } from '@date-fns/tz';
import { add, format, sub } from 'date-fns';
import type { Memory, ResolvedMemory } from "../plugins/repository.js";

export type BriefingService = {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }, signal?: AbortSignal): Promise<void>;
};

function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatMemoryList(memories: Pick<Memory, "content">[]): string {
  return memories.map((m) => `- ${m.content}`).join('\n');
}

function formatResolvedList(memories: ResolvedMemory[]): string {
  return memories.map((m) => {
    const date = new Date(m.actionCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const action = m.action === 'completed' ? 'completed' : 'dismissed';
    return `- ${m.content} (${action} ${date})`;
  }).join('\n');
}

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing(options = {}, signal?: AbortSignal) {
      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        fastify.log.warn('TELEGRAM_CHAT_ID is not set, skipping briefing');
        return;
      }

      const chatId = Number(chatIdEnv);
      const triggerType = options.triggerType ?? 'scheduled';

      try {
        const { authStorage, modelRegistry, model, resourceLoader } = fastify.agent;

        const { session } = await createAgentSession({
          model,
          authStorage,
          modelRegistry,
          resourceLoader,
          sessionManager: SessionManager.inMemory(),
          tools: ['calendar_list', 'get_weather_forecast'],
        });
        session.setAutoRetryEnabled(false);

        const onAbort = () => {
          session.abort().catch(() => {});
        };
        signal?.addEventListener('abort', onAbort);
        if (signal?.aborted) {
          onAbort();
        }

        try {
          const timezone = fastify.timezone;
          const tzNow = TZDate.tz(timezone);
          const now = new Date();
          const today = format(tzNow, 'EEEE, MMMM d, yyyy');
          const timeOfDay = getTimeOfDay(tzNow.getHours());

          const previousBriefing = fastify.briefingRepository.findLatest();
          const previousContext = previousBriefing
            ? `\n\nHere is your previous briefing from ${new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US')} for reference. Try not to repeat the same information unless it is still relevant:\n\n${previousBriefing.content}`
            : '';

          const coreMemories = fastify.memoryRepository.findByTags(['core'], { permanentOnly: true });
          const recentMemories = fastify.memoryRepository.findRecent(7);

          const coreContext = coreMemories.length > 0
            ? `Core memories about the user:\n${formatMemoryList(coreMemories)}`
            : '';

          const resolvedMemories = fastify.memoryRepository.findResolvedRecent(7);

          const recentContext = recentMemories.length > 0
            ? `Recent notes and tasks (last 7 days):\n${formatMemoryList(recentMemories)}`
            : '';

          const resolvedContext = resolvedMemories.length > 0
            ? `Tasks already completed or dismissed (do not mention these again):\n${formatResolvedList(resolvedMemories)}`
            : '';

          const memoryContext = [coreContext, recentContext, resolvedContext].filter(Boolean).join('\n\n');

          const todayStart = new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), timezone);
          const yesterdayStart = sub(todayStart, { days: 1 });
          const yesterdayEnd = todayStart;
          const todayEnd = add(todayStart, { days: 1 });
          const weekStart = todayEnd;
          const weekEnd = add(todayStart, { days: 8 });

          const tzAbbr = tzName(timezone, now, 'short');
          const tzLong = tzName(timezone, now, 'longGeneric');

          const calendarContext = fastify.calendarIds.length > 0
            ? `Available calendars:\n${fastify.calendarIds.map((id) => `- ${id}`).join('\n')}`
            : '';

          const weatherLat = process.env.WEATHER_LATITUDE;
          const weatherLon = process.env.WEATHER_LONGITUDE;
          const weatherContext = weatherLat && weatherLon
            ? `Your fixed weather location is latitude ${weatherLat}, longitude ${weatherLon} (New Jersey, USA).`
            : '';

          const prompt = [
            `Today is ${today}. It is currently ${timeOfDay}. All times are in ${tzLong} (${timezone}, ${tzAbbr}).`,
            '',
            memoryContext,
            '',
            calendarContext,
            '',
            weatherContext,
            '',
            'INSTRUCTIONS:',
            'Use the calendar_list tool to fetch events for each available calendar across these three ranges:',
            `1. Yesterday:     start "${yesterdayStart.toISOString()}" end "${yesterdayEnd.toISOString()}"`,
            `2. Today:         start "${todayStart.toISOString()}"     end "${todayEnd.toISOString()}"`,
            `3. Next 7 days:   start "${weekStart.toISOString()}"      end "${weekEnd.toISOString()}"`,
            '',
            'Call get_weather_forecast and include a 1-2 sentence weather summary after your greeting.',
            'Mention the weather condition, high and low temperatures, approximately when the high will be reached, and whether rain is expected (with timing if available).',
            'Include the US Air Quality Index only if it is moderate or worse.',
            'If the weather tool returns an error, omit the weather section entirely — do not mention it.',
            '',
            'Generate a daily briefing based on those events and the notes above.',
            '- Start with a brief, warm greeting referencing the time of day.',
            '- Mention yesterday only if there were notable events worth following up on.',
            '- Highlight important upcoming events within the next 3 days.',
            '  It is okay to remind about the same event across multiple briefings, but vary how you phrase it.',
            '- If there are any US holidays coming up, you an let the user know about them even though they may not celebrate that particular one.',
            '- Use 2-3 short paragraphs total, max 150 words.',
            '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
            '- If no calendar events exist, do not mention the calendar at all.',
            '- If no memories or tasks exist, do not mention them at all.',
            '- Do not remind the user about any task listed in the "completed or dismissed" section — those are already handled.',
            '- Do not mention core memories unless the user explicitly asks you about them.',
            '- Never apologize for lack of information; just provide what you have.',
            '- If a tool returns an error, mention it briefly in plain English and move on.',
            '- Do not use emojis.',
            '- End with one brief, encouraging closing line.',
            '',
            'TONE: Casual, warm, and efficient. Avoid robotic lists. Write like a helpful friend.',
            previousContext,
          ].filter((s) => s !== '').join('\n');

          fastify.log.debug({ prompt }, "Built briefing prompt");

          await session.prompt(prompt);
          const responseText = session.getLastAssistantText() ?? '';

          await fastify.telegramClient.sendMessage(chatId, responseText);

          fastify.briefingRepository.create({
            content: responseText,
            triggerType,
          });
        } finally {
          signal?.removeEventListener('abort', onAbort);
          session.dispose();
        }
      } catch (error) {
        fastify.log.error(error, 'Failed to send briefing');
      }
    },
  };
}

export function registerBriefingJob(fastify: FastifyInstance): void {
  const briefingService = createBriefingService(fastify);
  const cronExpression = process.env.BRIEFING_CRON;

  if (!cronExpression) {
    fastify.log.warn('BRIEFING_CRON is not set, skipping briefing job registration');
    return;
  }

  const task = new AsyncTask(
    'briefing-task',
    async () => {
      await briefingService.sendBriefing();
    },
    (err: Error) => {
      fastify.log.error(err, 'Briefing cron task failed');
    }
  );

  const job = new CronJob(
    { cronExpression },
    task,
    { id: 'briefing-job', preventOverrun: true }
  );

  fastify.scheduler.addCronJob(job);
}
