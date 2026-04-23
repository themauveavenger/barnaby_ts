import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import errorHandlerPlugin from '../../src/plugins/error-handler.js';

describe('error handler plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);

    app.get('/not-found', async () => {
      const { NotFoundError } = await import('../../src/plugins/error-handler.js');
      throw new NotFoundError('Resource not found');
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should format NotFoundError as 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/not-found',
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.statusCode).toBe(404);
    expect(body.error).toBe('Not Found');
    expect(body.message).toBe('Resource not found');
  });
});
