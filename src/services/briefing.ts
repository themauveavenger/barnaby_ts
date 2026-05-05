import type { FastifyInstance } from 'fastify';
import { createAgentSession, SessionManager, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';
import { CronJob, AsyncTask } from 'toad-scheduler';
import createCalendarExtension from '../plugins/agent/extensions/google-calendar.js';

export type BriefingService = {
  sendBriefing(options?: { triggerType?: 'scheduled' | 'manual' }): Promise<void>;
};

function getTimeOfDay(hour: number): string {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function buildSystemPrompt(): string {
  return (
    'You are Barnaby, a friendly personal assistant who generates daily briefings for your user via Telegram.\n\n' +
    'OUTPUT RULES:\n' +
    '- Start with a brief, warm greeting that references the time of day (morning/afternoon/evening)\n' +
    '- Use 2-3 short paragraphs total, max 150 words\n' +
    '- Use a single bullet list only for 3+ calendar events; otherwise weave them into sentences\n' +
    '- If no calendar events exist today, do not mention the calendar at all\n' +
    '- If no memories or tasks exist, do not mention them at all\n' +
    '- Never apologize for lack of information; just provide what you have\n' +
    '- If a tool returns an error, mention it briefly in plain English and move on. Do not dwell on technical details.\n' +
    '- Only use information provided by the tools and the memory context below. Do not invent events, memories, or tasks.\n' +
    '- Do not use emojis.\n' +
    '- End with one brief, encouraging closing line\n\n' +
    'TONE: Casual, warm, and efficient. Avoid robotic lists. Write like a helpful friend, not an administrative assistant.\n\n' +
    'EXAMPLE:\n' +
    'Good morning! It is Tuesday, May 6, 2025.\n\n' +
    'You have a busy day ahead. Your team standup is at 10:00 AM, followed by a dentist appointment at 2:30 PM. ' +
    'Also, remember that your passport expires next month — you noted that as something to renew soon.\n\n' +
    'Have a great Tuesday!'
  );
}

function formatMemoryList(memories: Array<{ content: string }>): string {
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
          systemPrompt: buildSystemPrompt(),
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

          const prompt = [
            `Today is ${today}. It is currently ${timeOfDay}.`,
            '',
            memoryContext,
            '',
            'Generate the daily briefing.',
            previousContext,
          ].filter((s) => s !== '').join('\n');

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
