import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createBriefingService, registerBriefingJob } from '../../src/services/briefing.js';
import { getTimeOfDay, formatMemoryList, formatResolvedList, buildMemoryContext, createAgentAndDeliver, MissingChatIdError, EmptyResponseError } from '../../src/services/telegram-utils.js';
import type { Memory, ResolvedMemory } from '../../src/plugins/repository.js';

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({}))
  }
}));

import { createAgentSession } from '@earendil-works/pi-coding-agent';

function createMockSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    getLastAssistantText: vi.fn().mockReturnValue('Good morning! You have 2 events today.'),
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

  describe('createAgentAndDeliver', () => {
    beforeEach(() => {
      process.env.TELEGRAM_CHAT_ID = '12345';
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('sends message and saves to repo when saveToRepo is provided', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      await createAgentAndDeliver({
        fastify,
        tools: ['calendar_list', 'get_weather_forecast'],
        prompt: 'Test prompt',
        saveToRepo: { triggerType: 'scheduled' }
      });

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ tools: ['calendar_list', 'get_weather_forecast'] })
      );
      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(12345, 'Good morning! You have 2 events today.');
      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Good morning! You have 2 events today.',
        triggerType: 'scheduled'
      });
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('sends message without saving when saveToRepo is omitted', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      await createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      });

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalled();
      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
    });

    it('throws MissingChatIdError when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;

      const fastify = createMockFastify();
      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      })).rejects.toThrow(MissingChatIdError);

      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it('throws EmptyResponseError when agent returns empty response', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue('')
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      })).rejects.toThrow(EmptyResponseError);

      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('throws EmptyResponseError when agent returns null response', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue(null)
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      })).rejects.toThrow(EmptyResponseError);

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('throws EmptyResponseError when agent returns whitespace-only response', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue('   ')
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      })).rejects.toThrow(EmptyResponseError);

      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('propagates session creation errors', async () => {
      (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

      const fastify = createMockFastify();
      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt'
      })).rejects.toThrow('LLM API down');

      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('propagates telegram send errors and does not save to repo', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API down'))
        }
      });

      await expect(createAgentAndDeliver({
        fastify,
        tools: ['calendar_list'],
        prompt: 'Test prompt',
        saveToRepo: { triggerType: 'scheduled' }
      })).rejects.toThrow('Telegram API down');

      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disposes session on abort signal', async () => {
      const mockSession = createMockSession({
        prompt: vi.fn().mockImplementation(async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
        })
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const controller = new AbortController();
      controller.abort();

      try {
        await createAgentAndDeliver({
          fastify,
          tools: ['calendar_list'],
          prompt: 'Test prompt',
          signal: controller.signal
        });
      } catch {
        // Expected to fail when aborted
      }

      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('does not save to repo when saveToRepo is provided but send fails', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram down'))
        }
      });

      try {
        await createAgentAndDeliver({
          fastify,
          tools: ['calendar_list'],
          prompt: 'Test prompt',
          saveToRepo: { triggerType: 'manual' }
        });
      } catch {
        // Expected
      }

      expect(fastify.briefingRepository.create).not.toHaveBeenCalled();
    });
  });
});

describe('briefing service', () => {
  beforeEach(() => {
    process.env.TELEGRAM_CHAT_ID = '12345';
    process.env.BRIEFING_CRON = '0 7 * * *';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('sendBriefing', () => {
    it('creates agent session with correct tools and sends result to Telegram', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['calendar_list', 'get_weather_forecast']
        })
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

      expect(fastify.telegramClient.sendMessage).toHaveBeenCalledWith(
        12345,
        'Good morning! You have 2 events today.'
      );

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Good morning! You have 2 events today.',
        triggerType: 'scheduled'
      });

      expect(mockSession.dispose).toHaveBeenCalled();
    });

    it('disables auto-retry on the agent session', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      expect(mockSession.setAutoRetryEnabled).toHaveBeenCalledWith(false);
    });

    it('includes core memories in the prompt when they exist', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

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

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Core memories about the user:');
      expect(prompt).toContain('- The user is vegetarian');
      expect(prompt).toContain('- The user lives in Portland');
    });

    it('includes recent memories in the prompt when they exist', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

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

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Recent notes and tasks (last 7 days):');
      expect(prompt).toContain('- Buy milk');
      expect(prompt).toContain('- Call dentist');
    });

    it('omits memory sections when no memories exist', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).not.toContain('Core memories about the user:');
      expect(prompt).not.toContain('Recent notes and tasks');
    });

    it('includes resolved (completed/dismissed) memories in the prompt', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

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

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Tasks already completed or dismissed');
      expect(prompt).toContain('Buy groceries (completed');
      expect(prompt).toContain('Call dentist (dismissed');
      expect(prompt).toContain('do not mention these again');
    });

    it('throws MissingChatIdError when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow(MissingChatIdError);
      expect(createAgentSession).not.toHaveBeenCalled();
    });

    it('propagates agent session creation failures', async () => {
      (createAgentSession as any).mockRejectedValue(new Error('LLM API down'));

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow('LLM API down');
      expect(fastify.telegramClient.sendMessage).not.toHaveBeenCalled();
    });

    it('propagates telegram send failures', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify({
        telegramClient: {
          sendMessage: vi.fn().mockRejectedValue(new Error('Telegram API down'))
        }
      });

      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow('Telegram API down');
    });

    it('includes previous briefing context when one exists', async () => {
      const mockSession = createMockSession();
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

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

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Previous briefing content');
      expect(prompt).toContain('Try not to repeat the same information');
      const expectedDate = new Date(previousBriefing.triggeredAt).toLocaleDateString('en-US');
      expect(prompt).toContain(`from ${expectedDate}`);
    });

    it('saves manual briefings with correct trigger type', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue('Manual briefing')
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing({ triggerType: 'manual' });

      expect(fastify.briefingRepository.create).toHaveBeenCalledWith({
        content: 'Manual briefing',
        triggerType: 'manual'
      });
    });

    it('propagates EmptyResponseError when agent returns empty', async () => {
      const mockSession = createMockSession({
        getLastAssistantText: vi.fn().mockReturnValue('')
      });
      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await expect(service.sendBriefing()).rejects.toThrow(EmptyResponseError);
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
