import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async (_prompt: string) => {}),
  getLastAssistantText: vi.fn(() => 'Manual briefing content'),
  dispose: vi.fn(),
};

const mockResourceLoader = {
  reload: vi.fn(async () => {}),
};

vi.mock('@mariozechner/pi-coding-agent', async () => {
  return {
    AuthStorage: { create: vi.fn(() => ({})) },
    ModelRegistry: { create: vi.fn(() => ({})) },
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
      return mockResourceLoader;
    }),
    createAgentSession: vi.fn(async () => ({ session: mockSession })),
    SessionManager: { inMemory: vi.fn(() => ({})) },
  };
});

vi.mock('@mariozechner/pi-ai', async () => {
  return {
    getModel: vi.fn(() => ({
      id: 'kimi-k2.6',
      provider: 'opencode-go',
    })),
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

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/briefing',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should trigger a manual briefing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/briefing',
      headers: { authorization: authHeader },
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
      headers: { authorization: authHeader },
    });

    const latest = app.briefingRepository.findLatest();
    expect(latest).not.toBeNull();
    expect(latest!.triggerType).toBe('manual');
  });
});
