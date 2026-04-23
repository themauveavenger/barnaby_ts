import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';

describe('database plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should decorate fastify with db', () => {
    expect(app.hasDecorator('db')).toBe(true);
  });

  it('should have created tables', () => {
    const tables = app.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('memories', 'tags', 'memory_tags')"
    ).all();
    expect(tables.length).toBe(3);
  });
});
