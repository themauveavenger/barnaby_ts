import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import { CronJob, AsyncTask } from 'toad-scheduler';
import createCalendarExtension from '../plugins/agent/extensions/google-calendar.js';
import createYnabExtension from '../plugins/agent/extensions/ynab/index.js';

export type BriefingService = {
  sendBriefing(): Promise<void>;
};

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing() {
      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        fastify.log.warn('TELEGRAM_CHAT_ID is not set, skipping briefing');
        return;
      }

      const chatId = Number(chatIdEnv);

      try {
        const { authStorage, modelRegistry, model } = fastify.agent;

        const resourceLoader = new DefaultResourceLoader({
          cwd: process.cwd(),
          agentDir: '/dev/null',
          noContextFiles: true,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          extensionFactories: [
            createCalendarExtension(fastify),
            createYnabExtension(fastify),
          ],
          systemPrompt:
            'You are Barnaby, a personal digital assistant. Generate a concise, friendly daily briefing. ' +
            'Include calendar events if any are scheduled today, and mention any important memories or tasks. ' +
            'Keep the briefing brief and actionable.',
        });
        await resourceLoader.reload();

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

          const prompt = `Generate a daily briefing for ${today}. Include relevant calendar events and any important memories.`;

          await session.prompt(prompt);
          const responseText = session.getLastAssistantText() ?? '';

          await fastify.telegramClient.sendMessage(chatId, responseText);
        } finally {
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
