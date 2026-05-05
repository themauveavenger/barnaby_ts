import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import databasePlugin, { type ColumnInfo } from '../../src/plugins/database.js';

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

  it('should have memories table with permanent column', () => {
    const columns = app.db.pragma('table_info(memories)') as Array<ColumnInfo>;
    const permanent = columns.find((c) => c.name === 'permanent');
    expect(permanent).toBeDefined();
    expect(permanent!.type).toBe('INTEGER');
    expect(permanent!.notnull).toBe(1);
    expect(permanent!.dflt_value).toBe('0');
  });

  it('should pre-populate default tags on startup', () => {
    const rows = app.db.prepare('SELECT name FROM tags ORDER BY name').all() as Array<{ name: string }>;
    const names = rows.map((r) => r.name);

    expect(names).toContain('core');
    expect(names).toContain('identity');
    expect(names).toContain('family');
    expect(names).toContain('friend');
    expect(names).toContain('home');
    expect(names).toContain('preference');
    expect(names).toContain('food');
    expect(names).toContain('health');
    expect(names).toContain('holiday');
    expect(names).toContain('date');
    expect(names).toContain('work');
    expect(names).toContain('finance');
    expect(names).toContain('travel');
    expect(names).toContain('tech');
  });

  it('should migrate old schema by adding permanent column', async () => {
    const tmpDb = path.join(os.tmpdir(), `barnaby-test-${Date.now()}.db`);

    const db = new Database(tmpDb);
    db.exec(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.close();

    const prevDbPath = process.env.DATABASE_PATH;
    process.env.DATABASE_PATH = tmpDb;

    const migrateApp = Fastify({ logger: false });
    await migrateApp.register(databasePlugin);
    await migrateApp.ready();

    const columns = migrateApp.db.pragma('table_info(memories)') as Array<ColumnInfo>;
    const permanent = columns.find((c) => c.name === 'permanent');
    expect(permanent).toBeDefined();
    expect(permanent!.type).toBe('INTEGER');
    expect(permanent!.notnull).toBe(1);
    expect(permanent!.dflt_value).toBe('0');

    await migrateApp.close();

    if (prevDbPath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = prevDbPath;
    }
    fs.unlinkSync(tmpDb);
  });

  it('should have briefings table with correct columns', () => {
    const columns = app.db.pragma('table_info(briefings)') as Array<ColumnInfo>;
    const names = columns.map((c) => c.name);

    expect(names).toContain('id');
    expect(names).toContain('content');
    expect(names).toContain('triggered_at');
    expect(names).toContain('trigger_type');

    const triggerType = columns.find((c) => c.name === 'trigger_type');
    expect(triggerType).toBeDefined();
    expect(triggerType!.type).toBe('TEXT');
    expect(triggerType!.notnull).toBe(1);
  });
});
