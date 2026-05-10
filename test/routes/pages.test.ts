import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildTestApp } from '../helper.js';
import { MEMORY_CATEGORIES } from '../../src/plugins/memory-categories.js';

describe('Memories Page', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
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

    const now = new Date();
    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const month = now.toLocaleDateString('en-US', { month: 'long' });
    const day = now.getDate();
    let hours = now.getHours();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const formattedDatePrefix = `${weekday} ${month} ${day}`;
    expect(response.payload).toContain(formattedDatePrefix);
    expect(response.payload).toContain(ampm);
  });

  it('should support pagination', async () => {
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

    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Read book',
        category: 'note',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/?category=purchase',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Buy milk');
    expect(response.payload).not.toContain('Read book');
  });

  it('should filter by tags', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Tagged memory',
        category: 'note',
        tags: ['test'],
      },
    });

    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: {
        content: 'Untagged memory',
        category: 'note',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/?tags=test',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Tagged memory');
    expect(response.payload).not.toContain('Untagged memory');
  });

  it('should reject invalid query parameters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/?category=invalid',
      headers: { authorization: authHeader },
    });
    expect(response.statusCode).toBe(400);
  });

  it('should show empty state when no memories exist', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('No memories found');
  });

  it('should include a link to create new memory', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('/memories/new');
  });

  it('should not include the creation form on the list page', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('id="content-input"');
    expect(response.payload).not.toContain('id="category-input"');
  });

  it('should display action buttons for todo memories without actions', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Buy milk', category: 'todo' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Complete');
    expect(response.payload).toContain('Dismiss');
  });

  it('should display action buttons for purchase memories without actions', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Buy milk', category: 'purchase' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Bought');
    expect(response.payload).toContain('Dismiss');
  });

  it('should not display action buttons for note memories', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Random thought', category: 'note' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('Complete</button>');
    expect(response.payload).not.toContain('Dismiss</button>');
  });

  it('should not display action buttons for appointment memories', async () => {
    await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Dentist at 2pm', category: 'appointment' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('Complete</button>');
    expect(response.payload).not.toContain('Bought</button>');
    expect(response.payload).not.toContain('Dismiss</button>');
  });

  it('should display action status for completed memories', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Buy groceries', category: 'todo' },
    });
    const created = createRes.json();

    await app.inject({
      method: 'POST',
      url: `/memories/${created.id}/actions`,
      headers: { authorization: authHeader },
      payload: { action: 'completed' },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('Completed');
  });

  it('should create action via form submission and redirect', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/memories',
      headers: { authorization: authHeader },
      payload: { content: 'Call dentist', category: 'todo' },
    });
    const created = createRes.json();

    const response = await app.inject({
      method: 'POST',
      url: '/actions',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: `memoryId=${created.id}&actionType=completed`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');

    // Verify action was created
    const page = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });
    expect(page.payload).toContain('Completed');
  });
});

describe('New Memory Page', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  const authHeader = 'Basic ' + Buffer.from('test:test').toString('base64');

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should reject unauthenticated requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/new',
    });
    expect(response.statusCode).toBe(401);
  });

  it('should return HTML with the creation form', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/new',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('New Memory');
    expect(response.payload).toContain('id="content-input"');
    expect(response.payload).toContain('id="category-input"');
    expect(response.payload).toContain('action="/memories/new"');
  });

  it('should include all categories in the creation dropdown', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/new',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    for (const cat of MEMORY_CATEGORIES) {
      expect(response.payload).toContain(`value="${cat.name}"`);
      expect(response.payload).toContain(`>${cat.label}</option>`);
    }
  });

  it('should include a link back to memories list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/memories/new',
      headers: { authorization: authHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('href="/"');
  });

  it('should create a memory from form submission and redirect to root', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories/new',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=Form+memory&category=note&tags=test%2C+tag',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');

    const getResponse = await app.inject({
      method: 'GET',
      url: '/',
      headers: { authorization: authHeader },
    });
    expect(getResponse.payload).toContain('Form memory');
  });

  it('should re-render form with error on invalid form submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories/new',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=&category=note&tags=test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('New Memory');
  });

  it('should re-render form with error on invalid category in form submission', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories/new',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=Bad+category&category=invalid&tags=test',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('New Memory');
  });

  it('should preserve form values on validation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/memories/new',
      headers: {
        authorization: authHeader,
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: 'content=My+content&category=invalid&permanent=on&tags=fun%2C+games',
    });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toContain('My content');
    expect(response.payload).toContain('checked');
    expect(response.payload).toContain('fun, games');
  });
});