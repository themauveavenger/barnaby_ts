import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildTestApp } from '../helper.js';

describe('Memories Page', () => {
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
      url: '/',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should return HTML with memories', async () => {
    // Seed a memory
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Test memory',
        category: 'note',
        tags: ['test'],
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Test memory');
    expect(response.payload).toContain('note');
    expect(response.payload).toContain('test');
  });

  it('should support pagination', async () => {
    // Create 25 memories to force pagination
    for (let i = 0; i < 25; i++) {
      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: `Memory ${i}`,
          category: 'note',
        },
      });
    }

    const response = await app.inject({
      method: 'GET',
      url: '/?page=2&limit=10',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Page 2 of');
    expect(response.payload).toContain('Previous');
    expect(response.payload).toContain('Next');
  });

  it('should filter by category', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Buy milk',
        category: 'purchase',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/?category=purchase',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Buy milk');
    expect(response.payload).not.toContain('Test memory');
  });

  it('should filter by tags', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/?tags=test',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Test memory');
  });
});
