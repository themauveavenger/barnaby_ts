import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Memories API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should create a memory', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Test memory',
        category: 'note',
        tags: ['test', 'important'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.content).toBe('Test memory');
    expect(body.category).toBe('note');
    expect(body.tags).toEqual(['test', 'important']);
    expect(body.id).toBeDefined();
    expect(body.createdAt).toBeDefined();
  });
});
