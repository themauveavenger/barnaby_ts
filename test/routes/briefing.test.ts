import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';

const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async (_prompt: string) => { void _prompt; }),
  getLastAssistantText: vi.fn(() => 'Manual briefing content'),
  dispose: vi.fn(),
  setAutoRetryEnabled: vi.fn(),
  abort: vi.fn().mockResolvedValue(undefined)
};

const mockResourceLoader = {
  reload: vi.fn(async () => { void 0; })
};

vi.mock('@earendil-works/pi-coding-agent', async () => {
  return {
    ModelRuntime: {
      create: vi.fn(async () => ({
        getModel: vi.fn(() => ({
          id: 'kimi-k2.6',
          provider: 'opencode-go'
        }))
      }))
    },
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
      return mockResourceLoader;
    }),
    createAgentSession: vi.fn(async () => ({ session: mockSession })),
    SessionManager: { inMemory: vi.fn(() => ({})) }
  };
});

describe('Briefing API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    app.db.exec('DELETE FROM briefings');
    vi.spyOn(app.telegramClient, 'sendMessage').mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /briefing', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/briefing'
      });
      expect(response.statusCode).toBe(401);
    });

    it('should trigger a manual briefing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/briefing',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Briefing sent');
    });

    it('should save manual briefing to repository', async () => {
      await app.inject({
        method: 'POST',
        url: '/briefing',
        headers: { authorization: authHeader }
      });

      const latest = app.briefingRepository.findLatest();
      expect(latest).not.toBeNull();
      expect(latest!.triggerType).toBe('manual');
    });
  });

  describe('POST /briefing/afternoon', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/briefing/afternoon'
      });
      expect(response.statusCode).toBe(401);
    });

    it('should trigger an afternoon update', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/briefing/afternoon',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Afternoon update sent');
    });

    it('should NOT save afternoon update to briefing repository', async () => {
      await app.inject({
        method: 'POST',
        url: '/briefing/afternoon',
        headers: { authorization: authHeader }
      });

      const latest = app.briefingRepository.findLatest();
      expect(latest).toBeNull();
    });
  });

  describe('GET /briefing', () => {
    it('should return empty list when no briefings exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/briefing',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toEqual([]);
      expect(body.pagination).toEqual({ page: 1, limit: 20, total: 0 });
    });

    it('should return paginated briefings', async () => {
      // Create some briefings directly
      app.briefingRepository.create({ content: 'First briefing', triggerType: 'manual' });
      app.briefingRepository.create({ content: 'Second briefing', triggerType: 'scheduled' });

      const response = await app.inject({
        method: 'GET',
        url: '/briefing?page=1&limit=10',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
      expect(body.data[0]).toHaveProperty('id');
      expect(body.data[0]).toHaveProperty('content');
      expect(body.data[0]).toHaveProperty('triggeredAt');
      expect(body.data[0]).toHaveProperty('triggerType');
    });

    it('should apply default pagination values', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/briefing',
        headers: { authorization: authHeader }
      });

      const body = response.json();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(20);
    });
  });

  describe('DELETE /briefing/:id', () => {
    it('should delete a briefing', async () => {
      const briefing = app.briefingRepository.create({
        content: 'Delete me',
        triggerType: 'manual'
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/briefing/${briefing.id}`,
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(204);
      expect(app.briefingRepository.findLatest()?.id).not.toBe(briefing.id);
    });

    it('should return 404 for non-existent briefing', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/briefing/00000000-0000-0000-0000-000000000000',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid uuid', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/briefing/not-a-uuid',
        headers: { authorization: authHeader }
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
