import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

export default fp(async function databasePlugin(fastify: FastifyInstance) {
  const dbPath = process.env.DATABASE_PATH || ':memory:';
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      -- Category list must stay in sync with src/plugins/memory-categories.ts
      category TEXT NOT NULL CHECK (category IN ('note', 'todo')),
      permanent INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (memory_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS briefings (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      triggered_at INTEGER NOT NULL,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('scheduled', 'manual'))
    );

    CREATE TABLE IF NOT EXISTS memory_actions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN ('completed', 'dismissed')),
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_actions_unique
      ON memory_actions(memory_id, action);
  `);

  // Migration: add permanent column to existing databases
  const columns = db.pragma('table_info(memories)') as ColumnInfo[];
  const hasPermanent = columns.some(c => c.name === 'permanent');
  if (!hasPermanent) {
    db.exec('ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: retire 'appointment' category (moved to Google Calendar)
  db.exec(`UPDATE memories SET category = 'note' WHERE category = 'appointment'`);

  // Pre-populate default tags
  db.exec(`
    INSERT OR IGNORE INTO tags (name) VALUES
      ('core'),
      ('identity'),
      ('family'),
      ('friend'),
      ('home'),
      ('preference'),
      ('food'),
      ('health'),
      ('holiday'),
      ('date'),
      ('work'),
      ('finance'),
      ('travel'),
      ('tech');
  `);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});
