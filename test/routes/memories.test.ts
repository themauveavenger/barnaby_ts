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

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories',
      });
      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid credentials', async () => {
      const badAuth = 'Basic ' + Buffer.from('wrong:wrong').toString('base64');
      const response = await app.inject({
        method: 'GET',
        url: '/memories',
        headers: { authorization: badAuth },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /memories', () => {
    it('should create a memory with tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Dentist at 2pm',
          category: 'appointment',
          tags: ['health', 'reminder'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.content).toBe('Dentist at 2pm');
      expect(body.category).toBe('appointment');
      expect(body.tags).toContain('health');
      expect(body.tags).toContain('reminder');
      expect(body.id).toBeDefined();
      expect(body.createdAt).toBeDefined();
    });

    it('should deduplicate and normalize tags', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Buy milk',
          category: 'purchase',
          tags: ['Shop', 'shop', 'SHOP'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.tags).toEqual(['shop']);
    });

    it('should reject invalid category', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Test',
          category: 'invalid',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject missing content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          category: 'note',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /memories/:id', () => {
    it('should retrieve a memory by id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Find me',
          category: 'note',
        },
      });
      const created = createRes.json();

      const response = await app.inject({
        method: 'GET',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(created.id);
      expect(body.content).toBe('Find me');
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/00000000-0000-0000-0000-000000000000',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should return 400 for invalid uuid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories/not-a-uuid',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /memories', () => {
    it('should list memories with pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?page=1&limit=10',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.limit).toBe(10);
    });

    it('should filter by category', async () => {
      await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Category filter test',
          category: 'todo',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/memories?category=todo',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.every((m: { category: string }) => m.category === 'todo')).toBe(true);
    });

    it('should reject invalid category in query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/memories?category=invalid',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /memories/:id', () => {
    it('should delete a memory', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Delete me',
          category: 'note',
        },
      });
      const created = createRes.json();

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(deleteRes.statusCode).toBe(204);

      const getRes = await app.inject({
        method: 'GET',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      expect(getRes.statusCode).toBe(404);
    });

    it('should return 404 for non-existent memory', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/memories/00000000-0000-0000-0000-000000000000',
        headers: { authorization: authHeader },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should clean up tags on delete (cascade)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/memories',
        headers: { authorization: authHeader },
        payload: {
          content: 'Tag cleanup test',
          category: 'note',
          tags: ['cleanup-test'],
        },
      });
      const created = createRes.json();

      await app.inject({
        method: 'DELETE',
        url: `/memories/${created.id}`,
        headers: { authorization: authHeader },
      });

      // Verify memory_tags rows are gone (would cause 404 above, but let's be explicit)
      const tagCount = app.db
        .prepare('SELECT COUNT(*) as count FROM memory_tags WHERE memory_id = ?')
        .get(created.id) as { count: number };
      expect(tagCount.count).toBe(0);
    });
  });
});
