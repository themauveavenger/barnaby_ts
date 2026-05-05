import type { FastifyInstance } from 'fastify';
import { createAgentSession, DefaultResourceLoader, SessionManager } from '@mariozechner/pi-coding-agent';
import { AsyncTask, CronJob } from 'toad-scheduler';
import { BARNABY_PERSONALITY } from '../agent/personality.js';
import createCalendarExtension from '../plugins/agent/extensions/google-calendar.js';
import type { Memory } from "../plugins/repository.js";

export type BriefingService = {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }): Promise<void>;
};

function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatMemoryList(memories: Pick<Memory, "content">[]): string {
  return memories.map((m) => `- ${m.content}`).join('\n');
}

export function createBriefingService(fastify: FastifyInstance): BriefingService {
  return {
    async sendBriefing(options = {}) {
      const chatIdEnv = process.env.TELEGRAM_CHAT_ID;
      if (!chatIdEnv) {
        fastify.log.warn('TELEGRAM_CHAT_ID is not set, skipping briefing');
        return;
      }

      const chatId = Number(chatIdEnv);
      const triggerType = options.triggerType ?? 'scheduled';

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
          ],
          systemPrompt: BARNABY_PERSONALITY,
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
          const now = new Date();
          const today = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });
          const timeOfDay = getTimeOfDay(now.getHours());

          const previousBriefing = fastify.briefingRepository.findLatest();
          const previousContext = previousBriefing
            ? `\n\nHere is your previous briefing from ${new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US')} for reference. Try not to repeat the same information unless it is still relevant:\n\n${previousBriefing.content}`
            : '';

          const coreMemories = fastify.memoryRepository.findByTags(['core'], { permanentOnly: true });
          const recentMemories = fastify.memoryRepository.findRecent(7);

          const coreContext = coreMemories.length > 0
            ? `Core memories about the user:\n${formatMemoryList(coreMemories)}`
            : '';

          const recentContext = recentMemories.length > 0
            ? `Recent notes and tasks (last 7 days):\n${formatMemoryList(recentMemories)}`
            : '';

          const memoryContext = [coreContext, recentContext].filter(Boolean).join('\n\n');

          const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          const startIso = startOfDay.toISOString();
          const endIso = endOfDay.toISOString();

          const calendarContext = fastify.calendarIds.length > 0
            ? `Available calendars:\n${fastify.calendarIds.map((id) => `- ${id}`).join('\n')}`
            : '';

          const prompt = [
            `Today is ${today}. It is currently ${timeOfDay}.`,
            '',
            memoryContext,
            '',
            calendarContext,
            '',
            'INSTRUCTIONS:',
            '- Use the calendar_list tool to fetch today\'s events from each available calendar.',
            `  Use start: "${startIso}" and end: "${endIso}" for each query.`,
            '- Generate a daily briefing based on those events and the notes above.',
            '- Start with a brief, warm greeting referencing the time of day.',
            '- Use 2-3 short paragraphs total, max 150 words.',
            '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences.',
            '- If no calendar events exist today, do not mention the calendar at all.',
            '- If no memories or tasks exist, do not mention them at all.',
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
