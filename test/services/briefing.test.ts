import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { TZDate, tzName } from '@date-fns/tz';
import { add, format, sub } from 'date-fns';
import { createBriefingService, registerBriefingJob } from '../../src/services/briefing.js';

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
}));

import { createAgentSession } from '@mariozechner/pi-coding-agent';

function createMockFastify(overrides: Partial<FastifyInstance> = {}): FastifyInstance {
  const mockBriefingRepo = {
    create: vi.fn().mockReturnValue({}),
    findLatest: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue([]),
    findAllPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    delete: vi.fn().mockReturnValue(false),
  };

  const mockMemoryRepo = {
    create: vi.fn().mockReturnValue({}),
    findById: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue({ data: [], total: 0 }),
    delete: vi.fn().mockReturnValue(false),
    findForContext: vi.fn().mockReturnValue({ permanent: [], recent: [] }),
    findRecent: vi.fn().mockReturnValue([]),
    findResolvedRecent: vi.fn().mockReturnValue([]),
    findByTags: vi.fn().mockReturnValue([]),
  };

  const mockMemoryActionRepo = {
    create: vi.fn().mockReturnValue({}),
    findByMemoryIds: vi.fn().mockReturnValue(new Map()),
    delete: vi.fn().mockReturnValue(false),
  };

  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {},
    },
    calendarIds: ['test@example.com', 'family@group.calendar.google.com'],
    timezone: 'America/New_York',
    telegramClient: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    memoryRepository: mockMemoryRepo,
    memoryActionRepository: mockMemoryActionRepo,
    briefingRepository: mockBriefingRepo,
    scheduler: {
      addCronJob: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  } as unknown as FastifyInstance;
}

describe('briefing service', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.BRIEFING_CRON = '0 7 * * *';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendBriefing', () => {
    it('creates agent session with improved system prompt and sends result to Telegram', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Good morning! You have 2 events today.'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['calendar_list', 'get_weather_forecast'],
        }),
      );

      expect(fastify.memoryRepository.findByTags).toHaveBeenCalledWith(['core'], { permanentOnly: true });
      expect(fastify.memoryRepository.findRecent).toHaveBeenCalledWith(7);

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Today is');
      expect(prompt).toContain('It is currently');
      expect(prompt).toContain('Use the calendar_list tool');
      expect(prompt).toContain('Available calendars:');
      expect(prompt).toContain('Call get_weather_forecast');
      expect(prompt).toContain('weather summary');
      expect(prompt).toContain('test@example.com');
      expect(prompt).toContain('family@group.calendar.google.com');
      expect(prompt).toContain('Generate a daily briefing');
      expect(prompt).toContain('Start with a brief, warm greeting');
      expect(prompt).toContain('max 150 words');
      expect(prompt).toContain('Do not use emojis');
      expect(prompt).toContain('America/New_York');
      const timezone = fastify.timezone;
      const now = new Date();
      const tzNow = TZDate.tz(timezone);
      const todayStart = new TZDate(tzNow.getFullYear(), tzNow.getMonth(), tzNow.getDate(), timezone);
      const yesterdayStart = sub(todayStart, { days: 1 });
      const yesterdayEnd = todayStart;
      const todayEnd = add(todayStart, { days: 1 });
      const weekStart = todayEnd;
      const weekEnd = add(todayStart, { days: 8 });
      expect(prompt).toContain(`Yesterday:     start "${yesterdayStart.toISOString()}" end "${yesterdayEnd.toISOString()}"`);
      expect(prompt).toContain(`Today:         start "${todayStart.toISOString()}"     end "${todayEnd.toISOString()}"`);
      expect(prompt).toContain(`Next 7 days:   start "${weekStart.toISOString()}"      end "${weekEnd.toISOString()}"`);

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(
        12345,
        'Good morning! You have 2 events today.'
      );

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Good morning! You have 2 events today.',
        triggerType: 'scheduled',
      });

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disables auto-retry on the agent session', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(mockSession.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    });

    it('aborts and disposes the session when signal is triggered', async () => {
      const mockSession = {
        prompt: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      const controller = new AbortController();

      // Abort immediately
      controller.abort();

      try {
        await service.sendBriefing({}, controller.signal);
      } catch {
        // Expected to fail when aborted
      }

      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('includes core memories in the prompt when they exist', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing with memories'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        memoryRepository: {
          create: vi.fn().mockReturnValue({}),
          findById: vi.fn().mockReturnValue(null),
          findAll: vi.fn().mockReturnValue({ data: [], total: 0 }),
          delete: vi.fn().mockReturnValue(false),
          findForContext: vi.fn().mockReturnValue({ permanent: [], recent: [] }),
          findResolvedRecent: vi.fn().mockReturnValue([]),
          findByTags: vi.fn().mockReturnValue([
            { content: 'The user is vegetarian' },
            { content: 'The user lives in Portland' },
          ]),
          findRecent: vi.fn().mockReturnValue([]),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Core memories about the user:');
      expect(prompt).toContain('- The user is vegetarian');
      expect(prompt).toContain('- The user lives in Portland');
    });

    it('includes recent memories in the prompt when they exist', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing with recent memories'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        memoryRepository: {
          create: vi.fn().mockReturnValue({}),
          findById: vi.fn().mockReturnValue(null),
          findAll: vi.fn().mockReturnValue({ data: [], total: 0 }),
          delete: vi.fn().mockReturnValue(false),
          findForContext: vi.fn().mockReturnValue({ permanent: [], recent: [] }),
          findResolvedRecent: vi.fn().mockReturnValue([]),
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([
            { content: 'Buy milk' },
            { content: 'Call dentist' },
          ]),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Recent notes and tasks (last 7 days):');
      expect(prompt).toContain('- Buy milk');
      expect(prompt).toContain('- Call dentist');
    });

    it('omits memory sections when no memories exist', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing without memories'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).not.toContain('Core memories about the user:');
      expect(prompt).not.toContain('Recent notes and tasks');
    });

    it('includes resolved (completed/dismissed) memories in the prompt', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing with resolved'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        memoryRepository: {
          create: vi.fn().mockReturnValue({}),
          findById: vi.fn().mockReturnValue(null),
          findAll: vi.fn().mockReturnValue({ data: [], total: 0 }),
          delete: vi.fn().mockReturnValue(false),
          findForContext: vi.fn().mockReturnValue({ permanent: [], recent: [] }),
          findResolvedRecent: vi.fn().mockReturnValue([
            { content: 'Buy groceries', action: 'completed', actionCreatedAt: '2026-05-05T10:00:00.000Z' },
            { content: 'Call dentist', action: 'dismissed', actionCreatedAt: '2026-05-04T08:30:00.000Z' },
          ]),
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([]),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Tasks already completed or dismissed');
      expect(prompt).toContain('Buy groceries (completed');
      expect(prompt).toContain('Call dentist (dismissed');
      expect(prompt).toContain('do not mention these again');
    });

    it('skips when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.warn).toHaveBeenCalledWith('TELEGRAM_CHAT_ID is not set, skipping briefing');
      expect(createAgentSession).not.toHaveBeenCalled();
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('handles agent session failure gracefully', async () => {
      (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.error).toHaveBeenCalled();
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('handles telegram send failure gracefully', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Briefing text'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API down')),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(fastify.log.error).toHaveBeenCalled();
    });

    it('includes previous briefing context when one exists', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('New briefing'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const previousBriefing = {
        id: 'prev-1',
        content: 'Previous briefing content',
        triggeredAt: new Date(Date.now() - 86400000).toISOString(),
        triggerType: 'scheduled' as const,
      };

      const fastify = createMockFastify({
        briefingRepository: {
          create: vi.fn().mockReturnValue({}),
          findLatest: vi.fn().mockReturnValue(previousBriefing),
          findAll: vi.fn().mockReturnValue([previousBriefing]),
          findAllPaginated: vi.fn().mockReturnValue({ data: [previousBriefing], total: 1 }),
          delete: vi.fn().mockReturnValue(false),
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Previous briefing content');
      expect(prompt).toContain('Try not to repeat the same information');
      const expectedDate = new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US');
      expect(prompt).toContain(`from ${expectedDate}`);
    });

    it('saves manual briefings with correct trigger type', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Manual briefing'),
        dispose: vi.fn(),
        setAutoRetryEnabled: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing({ triggerType: 'manual' });

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Manual briefing',
        triggerType: 'manual',
      });
    });
  });

  describe('registerBriefingJob', () => {
    it('creates cron job with preventOverrun', () => {
      const fastify = createMockFastify();
      registerBriefingJob(fastify);

      expect(fastify.scheduler.addCronJob).toHaveBeenCalled();
      const job = (fastify.scheduler.addCronJob as any).mock.calls[0][0];
      expect(job.id).toBe('briefing-job');
      expect(job.preventOverrun).toBe(true);
      expect(job.schedule.cronExpression).toBe('0 7 * * *');
    });

    it('warns when BRIEFING_CRON is not set', () => {
      delete process.env.BRIEFING_CRON;
      const fastify = createMockFastify();
      registerBriefingJob(fastify);

      expect(fastify.log.warn).toHaveBeenCalledWith('BRIEFING_CRON is not set, skipping briefing job registration');
      expect(fastify.scheduler.addCronJob).not.toHaveBeenCalled();
    });
  });
});
