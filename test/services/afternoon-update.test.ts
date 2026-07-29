import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createAfternoonUpdateService, registerAfternoonUpdateJob } from '../../src/services/afternoon-update.js';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({}))
  }
}));

vi.mock('../../src/agent/prompt-builder.js', () => ({
  promptBuilder: {
    briefing: vi.fn().mockReturnValue('MOCK PROMPT'),
    chat: vi.fn().mockReturnValue('MOCK PROMPT'),
    afternoonUpdate: vi.fn().mockReturnValue('MOCK PROMPT')
  }
}));

import { createAgentSession } from '@earendil-works/pi-coding-agent';
import { promptBuilder } from '../../src/agent/prompt-builder.js';
import type { AfternoonUpdateContext } from '../../src/agent/prompt-builder.js';

function createMockSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Good afternoon! You have a meeting at 3pm.'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function createMockFastify(overrides: Partial<FastifyInstance> = {}): FastifyInstance {
  const mockBriefingRepo = {
    create: vi.fn().mockReturnValue({}),
    findLatest: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue([]),
    findAllPaginated: vi.fn().mockReturnValue({ data: [], total: 0 }),
    delete: vi.fn().mockReturnValue(false)
  };

  const mockMemoryRepo = {
    create: vi.fn().mockReturnValue({}),
    findById: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue({ data: [], total: 0 }),
    delete: vi.fn().mockReturnValue(false),
    findForContext: vi.fn().mockReturnValue({ permanent: [], recent: [] }),
    findRecent: vi.fn().mockReturnValue([]),
    findResolvedRecent: vi.fn().mockReturnValue([]),
    findByTags: vi.fn().mockReturnValue([])
  };

  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
      resourceLoader: {}
    },
    calendarIds: ['test@example.com', 'family@group.calendar.google.com'],
    timezone: 'America/New_York',
    telegramClient: {
      sendMessage: vi.fn().mockResolvedValue(undefined)
    },
    memoryRepository: mockMemoryRepo,
    briefingRepository: mockBriefingRepo,
    scheduler: {
      addCronJob: vi.fn()
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    },
    ...overrides
  } as unknown as FastifyInstance;
}

describe('afternoon update service', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.AFTERNOON_UPDATE_CRON = '0 14 * * *';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendUpdate', () => {
    function lastAfternoonContext(): AfternoonUpdateContext {
      return vi.mocked(promptBuilder.afternoonUpdate).mock.calls[0][0];
    }

    it('creates agent session with calendar_list only and sends result', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['calendar_list']
        })
      );

      // Should NOT include weather tool
      const toolsArg = (createAgentSession as any).mock.calls[0][0].tools;
      expect(toolsArg).not.toContain('get_weather_forecast');

      // Caller delegates prompt assembly to PromptBuilder with the computed
      // context (two date ranges only, calendar IDs).
      expect(promptBuilder.afternoonUpdate).toHaveBeenCalledTimes(1);
      const context = lastAfternoonContext();
      expect(context).toMatchObject({
        timezone: 'America/New_York',
        memoryContext: '',
        calendarIds: ['test@example.com', 'family@group.calendar.google.com']
      });
      expect(context.dateRanges).toEqual(expect.objectContaining({
        todayStart: expect.any(Date),
        todayEnd: expect.any(Date),
        weekStart: expect.any(Date),
        weekEnd: expect.any(Date)
      }));
      expect(context.dateRanges).not.toHaveProperty('yesterdayStart');
      expect(context).not.toHaveProperty('previousBriefing');
      expect(mockSession.prompt).toHaveBeenCalledWith('MOCK PROMPT');

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(
        12345,
        'Good afternoon! You have a meeting at 3pm.'
      );

      // Afternoon updates should NOT be saved to repo
      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('passes the computed two-range dateRanges (no yesterday range) to PromptBuilder', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      const { dateRanges } = lastAfternoonContext();
      expect(Object.keys(dateRanges).sort()).toEqual(['todayEnd', 'todayStart', 'weekEnd', 'weekStart']);
      // weekStart immediately follows todayEnd (a continuous today + 3-day window).
      expect(dateRanges.weekStart.getTime()).toBe(dateRanges.todayEnd.getTime());
    });

    it('passes the previous briefing to PromptBuilder when one exists (preamble present)', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const previousBriefing = {
        id: 'prev-1',
        content: 'Morning briefing: You have a dentist appointment today.',
        triggeredAt: new Date(Date.now() - 86400000).toISOString(),
        triggerType: 'scheduled' as const
      };

      const fastify = createMockFastify({
        briefingRepository: {
          ...createMockFastify().briefingRepository,
          findLatest: vi.fn().mockReturnValue(previousBriefing)
        }
      });

      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      // Caller passes raw previous-briefing data; PromptBuilder owns the
      // preamble wording (present whenever previousBriefing is supplied).
      expect(lastAfternoonContext().previousBriefing).toEqual({
        content: 'Morning briefing: You have a dentist appointment today.',
        triggeredAt: previousBriefing.triggeredAt
      });
    });

    it('does not pass a previous briefing to PromptBuilder when none exists (preamble absent)', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      expect(lastAfternoonContext()).not.toHaveProperty('previousBriefing');
    });

    it('passes the memory context string from buildMemoryContext to PromptBuilder', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([{ content: 'I am vegetarian' }]),
          findRecent: vi.fn().mockReturnValue([{ content: 'Pick up dry cleaning' }]),
          findResolvedRecent: vi.fn().mockReturnValue([])
        }
      });

      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      const memoryContext = lastAfternoonContext().memoryContext;
      expect(memoryContext).toContain('Core memories about the user:');
      expect(memoryContext).toContain('- I am vegetarian');
      expect(memoryContext).toContain('Recent notes and tasks (last 7 days):');
      expect(memoryContext).toContain('- Pick up dry cleaning');
    });

    it('passes abort signal through to createAgentAndDeliver', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      const controller = new AbortController();

      // Abort after creation to test signal wiring
      controller.abort();

      try {
        await service.sendUpdate(controller.signal);
      } catch {
        // May throw due to abort
      }

      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('does not save to briefing repository even on success', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
    });

    it('passes timezone information to PromptBuilder', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createAfternoonUpdateService(fastify);
      await service.sendUpdate();

      expect(lastAfternoonContext().timezone).toBe('America/New_York');
    });
  });

  describe('registerAfternoonUpdateJob', () => {
    it('creates cron job with preventOverrun', () => {
      const fastify = createMockFastify();
      registerAfternoonUpdateJob(fastify);

      expect(fastify.scheduler.addCronJob).toHaveBeenCalled();
      const job = (fastify.scheduler.addCronJob as any).mock.calls[0][0];
      expect(job.id).toBe('afternoon-update-job');
      expect(job.preventOverrun).toBe(true);
      expect(job.schedule.cronExpression).toBe('0 14 * * *');
    });

    it('warns when AFTERNOON_UPDATE_CRON is not set', () => {
      delete process.env.AFTERNOON_UPDATE_CRON;
      const fastify = createMockFastify();
      registerAfternoonUpdateJob(fastify);

      expect(fastify.log.warn).toHaveBeenCalledWith('AFTERNOON_UPDATE_CRON is not set, skipping afternoon update job registration');
      expect(fastify.scheduler.addCronJob).not.toHaveBeenCalled();
    });
  });
});
