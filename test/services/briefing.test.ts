import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createBriefingService, registerBriefingJob } from '../../src/services/briefing.js';

const mockResourceLoader = {
  reload: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    inMemory: vi.fn(() => ({})),
  },
  DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
    return mockResourceLoader;
  }),
}));

import { createAgentSession, DefaultResourceLoader } from '@mariozechner/pi-coding-agent';

function createMockFastify(overrides: Partial<FastifyInstance> = {}): FastifyInstance {
  const mockBriefingRepo = {
    create: vi.fn().mockReturnValue({}),
    findLatest: vi.fn().mockReturnValue(null),
    findAll: vi.fn().mockReturnValue([]),
  };

  return {
    agent: {
      authStorage: {},
      modelRegistry: {},
      model: {},
    },
    telegramClient: {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
    briefingRepository: mockBriefingRepo,
    scheduler: {
      addCronJob: vi.fn(),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
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
      };

      (createAgentSession as any).mockResolvedValue({ session: mockSession });

      const fastify = createMockFastify();
      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const resourceLoaderCall = (DefaultResourceLoader as any).mock.calls[0][0];
      expect(resourceLoaderCall.systemPrompt).toContain('You are Barnaby');
      expect(resourceLoaderCall.systemPrompt).toContain('EXAMPLE');
      expect(resourceLoaderCall.systemPrompt).toContain('Only use information provided by the tools');
      expect(resourceLoaderCall.systemPrompt).toContain('If a tool returns an error');
      expect(resourceLoaderCall.systemPrompt).toContain('Do not use emojis');

      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('Today is')
      );
      expect(mockSession.prompt).toHaveBeenCalledWith(
        expect.stringContaining('It is currently')
      );

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
        },
      });

      const service = createBriefingService(fastify);
      await service.sendBriefing();

      const prompt = mockSession.prompt.mock.calls[0][0];
      expect(prompt).toContain('Previous briefing content');
      expect(prompt).toContain('Try not to repeat the same information');
    });

    it('saves manual briefings with correct trigger type', async () => {
      const mockSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        getLastAssistantText: vi.fn().mockReturnValue('Manual briefing'),
        dispose: vi.fn(),
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
