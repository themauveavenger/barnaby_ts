import type { FastifyInstance } from 'fastify';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { TZDate, tzName } from '@date-fns/tz';
import { add, format, sub } from 'date-fns';
import { getTimeOfDay, buildMemoryContext, createAgentAndDeliver } from './telegram-utils.js';
import { promptBuilder } from '../agent/prompt-builder.js';

export interface BriefingService {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }, signal?: AbortSignal): Promise<void>;
}

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing(options = {}, signal?: AbortSignal) {
      const triggerType = options.triggerType ?? 'scheduled';

      const timezone = fastify.timezone;
      const tzNow = TZDate.tz(timezone);
      const now = new Date();
      const today = format(tzNow, 'EEEE, MMMM d, yyyy');
      const timeOfDay = getTimeOfDay(tzNow.getHours());

      const previousBriefing = fastify.briefingRepository.findLatest();

      const memoryContext = buildMemoryContext(fastify);

      const todayStart = new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), timezone);
      const yesterdayStart = sub(todayStart, { days: 1 });
      const yesterdayEnd = todayStart;
      const todayEnd = add(todayStart, { days: 1 });
      const weekStart = todayEnd;
      const weekEnd = add(todayStart, { days: 8 });

      const tzAbbr = tzName(timezone, now, 'short');
      const tzLong = tzName(timezone, now, 'longGeneric');

      const weatherLatitude = process.env.WEATHER_LATITUDE;
      const weatherLongitude = process.env.WEATHER_LONGITUDE;

      const prompt = promptBuilder.briefing({
        today,
        timeOfDay,
        timezone,
        tzAbbr,
        tzLong,
        memoryContext,
        calendarIds: fastify.calendarIds,
        ...(weatherLatitude && weatherLongitude
          ? { weatherLatitude, weatherLongitude }
          : {}),
        ...(previousBriefing
          ? { previousBriefing: { content: previousBriefing.content, triggeredAt: previousBriefing.triggeredAt } }
          : {}),
        dateRanges: {
          yesterdayStart,
          yesterdayEnd,
          todayStart,
          todayEnd,
          weekStart,
          weekEnd
        }
      });

      fastify.log.debug({ prompt }, 'Built briefing prompt');

      await createAgentAndDeliver({
        fastify,
        tools: ['calendar_list', 'get_weather_forecast'],
        prompt,
        signal,
        saveToRepo: { triggerType }
      });
    }
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
