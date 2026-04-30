import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { buildTestApp } from '../helper.js';
import { createAgentSession } from '@mariozechner/pi-coding-agent';

// Mock the pi SDK packages so tests don't need real API keys
const mockSession = {
  subscribe: vi.fn(),
  prompt: vi.fn(async (_prompt: string) => {}),
  getLastAssistantText: vi.fn(() => 'Hello from mock LLM'),
  dispose: vi.fn(),
};

const mockResourceLoader = {
  reload: vi.fn(async () => {}),
};

vi.mock('@mariozechner/pi-coding-agent', async () => {
  return {
    AuthStorage: {
      create: vi.fn(() => ({})),
    },
    ModelRegistry: {
      create: vi.fn(() => ({})),
    },
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader() {
      return mockResourceLoader;
    }),
    createAgentSession: vi.fn(async () => ({
      session: mockSession,
    })),
    SessionManager: {
      inMemory: vi.fn(() => ({})),
    },
  };
});

vi.mock('@mariozechner/pi-ai', async () => {
  return {
    getModel: vi.fn(() => ({
      id: 'kimi-k2.5',
      provider: 'opencode-go',
    })),
  };
});

describe('Chat API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    app.db.exec('DELETE FROM memories');
    mockSession.prompt.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject invalid credentials', async () => {
    const badAuth = 'Basic ' + Buffer.from('wrong:wrong').toString('base64');
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: badAuth },
      payload: { message: 'hello' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('should reject missing message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('should reject empty message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: '' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('should return a response for a valid message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('response');
    expect(typeof body.response).toBe('string');
    expect(body.response).toBe('Hello from mock LLM');
  });

  it('should include the current date in the prompt', async () => {
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(mockSession.prompt).toHaveBeenCalledWith(
      expect.stringContaining('Today is')
    );
  });

  it('should create an ephemeral session with no tools', async () => {
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        noTools: 'all',
        sessionManager: expect.anything(),
      })
    );
  });

  it('should dispose the session after use', async () => {
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it('should include core memories in the prompt when they exist', async () => {
    // Create a core memory
    app.memoryRepository.create({
      content: 'The user is vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'What should I eat?' },
    });

    const prompt = mockSession.prompt.mock.calls.at(-1)![0];
    expect(prompt).toContain('Core memories about the user:');
    expect(prompt).toContain('- The user is vegetarian');
  });

  it('should omit core memory section when no core memories exist', async () => {
    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'hello' },
    });

    const prompt = mockSession.prompt.mock.calls.at(-1)![0];
    expect(prompt).not.toContain('Core memories about the user:');
  });

  it('should place the user message after core memories', async () => {
    app.memoryRepository.create({
      content: 'The user is vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { authorization: authHeader },
      payload: { message: 'What should I eat?' },
    });

    const prompt = mockSession.prompt.mock.calls.at(-1)![0];
    const coreIndex = prompt.indexOf('Core memories about the user:');
    const messageIndex = prompt.indexOf('What should I eat?');
    expect(coreIndex).toBeLessThan(messageIndex);
  });
});
