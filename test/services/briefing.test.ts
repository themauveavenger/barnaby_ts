import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createBriefingService, registerBriefingJob } from '../../src/services/briefing.js';
import { getTimeOfDay, formatMemoryList, formatResolvedList, buildMemoryContext, MissingChatIdError } from '../../src/services/telegram-utils.js';
import { runAgentSession, ALL_TOOLS, BRIEFING_READONLY_TOOLS, EmptyResponseError as RunnerEmptyResponseError } from '../../src/agent/session-runner.js';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { Memory, ResolvedMemory } from '../../src/plugins/repository.js';
import { clearSessionStore, getSession } from '../../src/services/telegram/session-store.js';

import { promptBuilder } from '../../src/agent/prompt-builder.js';
import type { BriefingContext } from '../../src/agent/prompt-builder.js';

vi.mock('../../src/agent/prompt-builder.js', () => ({
  promptBuilder: {
    briefing: vi.fn().mockReturnValue('MOCK PROMPT'),
    chat: vi.fn().mockReturnValue('MOCK PROMPT'),
    afternoonUpdate: vi.fn().mockReturnValue('MOCK PROMPT')
  }
}));

vi.mock('../../src/agent/session-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agent/session-runner.js')>();
  return {
    ...actual,
    runAgentSession: vi.fn()
  };
});

function createMockSession(overrides: Partial<Record<string, unknown>> = {}): AgentSession {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Good morning! You have 2 events today.'),
    dispose: vi.fn(),
    setAutoRetryEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as AgentSession;
}

function mockRunAgentSession(session: AgentSession): void {
  vi.mocked(runAgentSession).mockResolvedValue({
    text: (session.getLastAssistantText() ?? '').trim(),
    session
  });
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

  const mockMemoryActionRepo = {
    create: vi.fn().mockReturnValue({}),
    findByMemoryIds: vi.fn().mockReturnValue(new Map()),
    delete: vi.fn().mockReturnValue(false)
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
    memoryActionRepository: mockMemoryActionRepo,
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

describe('briefing helpers', () => {
  describe('getTimeOfDay', () => {
    it('returns "morning" for hours before 12', () => {
      expect(getTimeOfDay(0)).toBe('morning');
      expect(getTimeOfDay(6)).toBe('morning');
      expect(getTimeOfDay(11)).toBe('morning');
    });

    it('returns "afternoon" for hours 12-16', () => {
      expect(getTimeOfDay(12)).toBe('afternoon');
      expect(getTimeOfDay(14)).toBe('afternoon');
      expect(getTimeOfDay(16)).toBe('afternoon');
    });

    it('returns "evening" for hours 17+', () => {
      expect(getTimeOfDay(17)).toBe('evening');
      expect(getTimeOfDay(20)).toBe('evening');
      expect(getTimeOfDay(23)).toBe('evening');
    });
  });

  describe('formatMemoryList', () => {
    it('formats a list of memories with dashes', () => {
      const memories: Pick<Memory, 'content'>[] = [
        { content: 'Buy milk' },
        { content: 'Call dentist' }
      ];
      expect(formatMemoryList(memories)).toBe('- Buy milk\n- Call dentist');
    });

    it('returns empty string for empty list', () => {
      expect(formatMemoryList([])).toBe('');
    });
  });

  describe('formatResolvedList', () => {
    it('formats resolved memories with action and date', () => {
      const memories: ResolvedMemory[] = [
        { content: 'Buy groceries', action: 'completed', actionCreatedAt: '2026-05-05T10:00:00.000Z', id: '1', category: 'todo', tags: [], permanent: false, createdAt: '2026-05-01T00:00:00.000Z' },
        { content: 'Call dentist', action: 'dismissed', actionCreatedAt: '2026-05-04T08:30:00.000Z', id: '2', category: 'todo', tags: [], permanent: false, createdAt: '2026-05-03T00:00:00.000Z' }
      ];
      const result = formatResolvedList(memories);
      expect(result).toContain('- Buy groceries (completed');
      expect(result).toContain('- Call dentist (dismissed');
    });

    it('returns empty string for empty list', () => {
      expect(formatResolvedList([])).toBe('');
    });
  });

  describe('buildMemoryContext', () => {
    it('returns empty string when no memories exist', () => {
      const fastify = createMockFastify();
      const result = buildMemoryContext(fastify);
      expect(result).toBe('');
    });

    it('includes core memories', () => {
      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([{ content: 'I am vegetarian' }]),
          findRecent: vi.fn().mockReturnValue([]),
          findResolvedRecent: vi.fn().mockReturnValue([])
        }
      });
      const result = buildMemoryContext(fastify);
      expect(result).toContain('Core memories about the user:');
      expect(result).toContain('- I am vegetarian');
    });

    it('includes recent memories', () => {
      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([{ content: 'Buy milk' }]),
          findResolvedRecent: vi.fn().mockReturnValue([])
        }
      });
      const result = buildMemoryContext(fastify);
      expect(result).toContain('Recent notes and tasks (last 7 days):');
      expect(result).toContain('- Buy milk');
    });

    it('includes resolved memories', () => {
      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([]),
          findResolvedRecent: vi.fn().mockReturnValue([
            { content: 'Buy groceries', action: 'completed', actionCreatedAt: '2026-05-05T10:00:00.000Z', id: '1', category: 'todo', tags: [], permanent: false, createdAt: '2026-05-01T00:00:00.000Z' }
          ])
        }
      });
      const result = buildMemoryContext(fastify);
      expect(result).toContain('Tasks already completed or dismissed');
      expect(result).toContain('- Buy groceries (completed');
    });

    it('combines all sections with double newlines', () => {
      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([{ content: 'Core fact' }]),
          findRecent: vi.fn().mockReturnValue([{ content: 'Recent note' }]),
          findResolvedRecent: vi.fn().mockReturnValue([
            { content: 'Done task', action: 'completed', actionCreatedAt: '2026-05-05T10:00:00.000Z', id: '1', category: 'todo', tags: [], permanent: false, createdAt: '2026-05-01T00:00:00.000Z' }
          ])
        }
      });
      const result = buildMemoryContext(fastify);
      expect(result).toContain('Core memories about the user:\n- Core fact');
      expect(result).toContain('Recent notes and tasks (last 7 days):\n- Recent note');
      expect(result).toContain('Tasks already completed or dismissed');
    });
  });
});

describe('briefing service', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.BRIEFING_CRON = '0 7 * * *';
    clearSessionStore();
    vi.mocked(runAgentSession).mockResolvedValue({
      text: 'Good morning! You have 2 events today.',
      session: createMockSession()
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendBriefing', () => {
    function lastBriefingContext(): BriefingContext {
      return vi.mocked(promptBuilder.briefing).mock.calls[0][0];
    }

    it('runs the briefing with the full registry and read-only active tools', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(runAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ALL_TOOLS,
          activeTools: BRIEFING_READONLY_TOOLS
        })
      );

      expect(fastify.memoryRepository.findByTags).toHaveBeenCalledWith(['core'], { permanentOnly: true });
      expect(fastify.memoryRepository.findRecent).toHaveBeenCalledWith(7);

      // Caller computes context and delegates prompt assembly to PromptBuilder.
      expect(promptBuilder.briefing).toHaveBeenCalledTimes(1);
      const context = lastBriefingContext();
      expect(context).toMatchObject({
        timezone: 'America/New_York',
        memoryContext: '',
        calendarIds: ['test@example.com', 'family@group.calendar.google.com']
      });
      expect(context.dateRanges).toEqual(expect.objectContaining({
        yesterdayStart: expect.any(Date),
        yesterdayEnd: expect.any(Date),
        todayStart: expect.any(Date),
        todayEnd: expect.any(Date),
        weekStart: expect.any(Date),
        weekEnd: expect.any(Date)
      }));
      // No weather configured, no previous briefing in this baseline.
      expect(context).not.toHaveProperty('weatherLatitude');
      expect(context).not.toHaveProperty('previousBriefing');

      expect(runAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'MOCK PROMPT' })
      );

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(
        12345,
        'Good morning! You have 2 events today.'
      );

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Good morning! You have 2 events today.',
        triggerType: 'scheduled'
      });

      expect(mockSession.dispose).not.toHaveBeenCalled();
    });

    it('passes weather location to PromptBuilder when configured', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      vi.stubEnv('WEATHER_LATITUDE', '40.7');
      vi.stubEnv('WEATHER_LONGITUDE', '-74.0');
      try {
        const fastify = createMockFastify();
        const service = createBriefingService(fastify);
        await service.sendBriefing();

        expect(lastBriefingContext()).toMatchObject({
          weatherLatitude: '40.7',
          weatherLongitude: '-74.0'
        });
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('caches the live session after delivering the briefing', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(getSession(12345)).toBe(mockSession);
    });

    it('passes core memories (as memory context) to PromptBuilder when they exist', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([
            { content: 'The user is vegetarian' },
            { content: 'The user lives in Portland' }
          ]),
          findRecent: vi.fn().mockReturnValue([]),
          findResolvedRecent: vi.fn().mockReturnValue([])
        }
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const memoryContext = lastBriefingContext().memoryContext;
      expect(memoryContext).toContain('Core memories about the user:');
      expect(memoryContext).toContain('- The user is vegetarian');
      expect(memoryContext).toContain('- The user lives in Portland');
    });

    it('passes recent memories (as memory context) to PromptBuilder when they exist', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([
            { content: 'Buy milk' },
            { content: 'Call dentist' }
          ]),
          findResolvedRecent: vi.fn().mockReturnValue([])
        }
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const memoryContext = lastBriefingContext().memoryContext;
      expect(memoryContext).toContain('Recent notes and tasks (last 7 days):');
      expect(memoryContext).toContain('- Buy milk');
      expect(memoryContext).toContain('- Call dentist');
    });

    it('passes an empty memory context when no memories exist', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(lastBriefingContext().memoryContext).toBe('');
    });

    it('passes resolved (completed/dismissed) memories as memory context', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify({
        memoryRepository: {
          ...createMockFastify().memoryRepository,
          findByTags: vi.fn().mockReturnValue([]),
          findRecent: vi.fn().mockReturnValue([]),
          findResolvedRecent: vi.fn().mockReturnValue([
            { content: 'Buy groceries', action: 'completed', actionCreatedAt: '2026-05-05T10:00:00.000Z' },
            { content: 'Call dentist', action: 'dismissed', actionCreatedAt: '2026-05-04T08:30:00.000Z' }
          ])
        }
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const memoryContext = lastBriefingContext().memoryContext;
      expect(memoryContext).toContain('Tasks already completed or dismissed');
      expect(memoryContext).toContain('Buy groceries (completed');
      expect(memoryContext).toContain('Call dentist (dismissed');
      expect(memoryContext).toContain('do not mention these again');
    });

    it('throws MissingChatIdError when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow(MissingChatIdError);
      expect(runAgentSession).not.toHaveBeenCalled();
    });

    it('propagates agent session creation failures', async () => {
      vi.mocked(runAgentSession).mockRejectedValue(new Error('LLM API down'));

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow('LLM API down');
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('propagates telegram send failures', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API down'))
        }
      });

      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow('Telegram API down');
      expect(mockSession.dispose).toHaveBeenCalled();
      expect(getSession(12345)).toBeUndefined();
    });

    it('passes the previous briefing (raw content + triggeredAt) to PromptBuilder when one exists', async () => {
      const mockSession = createMockSession();
      mockRunAgentSession(mockSession);

      const previousBriefing = {
        id: 'prev-1',
        content: 'Previous briefing content',
        triggeredAt: new Date(Date.now() - 86400000).toISOString(),
        triggerType: 'scheduled' as const
      };

      const fastify = createMockFastify({
        briefingRepository: {
          ...createMockFastify().briefingRepository,
          findLatest: vi.fn().mockReturnValue(previousBriefing)
        }
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      // Caller passes raw previous-briefing data; PromptBuilder owns the
      // preamble wording.
      expect(lastBriefingContext().previousBriefing).toEqual({
        content: 'Previous briefing content',
        triggeredAt: previousBriefing.triggeredAt
      });
    });

    it('saves manual briefings with correct trigger type', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue('Manual briefing')
      });
      mockRunAgentSession(mockSession);

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing({ triggerType: 'manual' });

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Manual briefing',
        triggerType: 'manual'
      });
    });

    it('propagates EmptyResponseError when agent returns empty', async () => {
      vi.mocked(runAgentSession).mockRejectedValue(new RunnerEmptyResponseError());

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow(RunnerEmptyResponseError);
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
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
