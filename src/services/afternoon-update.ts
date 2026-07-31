import type { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { TZDate, tzName } from '@date-fns/tz';
import { add, format } from 'date-fns';
import { getTimeOfDay, buildMemoryContext, MissingChatIdError } from './telegram-utils.js';
import { ALL_TOOLS, AFTERNOON_UPDATE_READONLY_TOOLS, runAgentSession } from '../agent/session-runner.js';
import { promptBuilder } from '../agent/prompt-builder.js';
import { setSession } from './telegram/session-store.js';

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

      const memoryContext = buildMemoryContext(fastify);

      const todayStart = new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), timezone);
      const todayEnd = add(todayStart, { days: 1 });
      const weekStart = todayEnd;
      const weekEnd = add(todayStart, { days: 4 });

      const tzAbbr = tzName(timezone, now, 'short');
      const tzLong = tzName(timezone, now, 'longGeneric');

      const prompt = promptBuilder.afternoonUpdate({
        today,
        timeOfDay,
        timezone,
        tzAbbr,
        tzLong,
        memoryContext,
        calendarIds: fastify.calendarIds,
        ...(previousBriefing
          ? { previousBriefing: { content: previousBriefing.content, triggeredAt: previousBriefing.triggeredAt } }
          : {}),
        dateRanges: {
          todayStart,
          todayEnd,
          weekStart,
          weekEnd
        }
      });

      fastify.log.debug({ prompt }, 'Built afternoon update prompt');

      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        throw new MissingChatIdError();
      }

      const chatId = Number(chatIdEnv);
      const { modelRuntime, model, resourceLoader } = fastify.agent;
      const { text, session } = await runAgentSession({
        modelRuntime,
        model,
        resourceLoader,
        tools: ALL_TOOLS,
        activeTools: AFTERNOON_UPDATE_READONLY_TOOLS,
        prompt,
        signal
      });

      try {
        await fastify.telegramClient.sendMessage(chatId, text);
        setSession(chatId, session);
      } catch (error) {
        session.dispose();
        throw error;
      }
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
