import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { seedUserEntity } from './repositories/entity.js';

export interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

/**
 * Fastify plugin that initialises the SQLite database, runs migrations,
 * seeds default data, and decorates the Fastify instance with the db handle.
 *
 * All schema definitions live here so the database is self-describing
 * on startup; this keeps the project deployable without external migration
 * tooling.
 */
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

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS personalities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      examples TEXT,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
    );
  `);

  // Migration: add permanent column to existing databases
  const columns = db.pragma('table_info(memories)') as ColumnInfo[];
  const hasPermanent = columns.some(c => c.name === 'permanent');
  if (!hasPermanent) {
    db.exec('ALTER TABLE memories ADD COLUMN permanent INTEGER NOT NULL DEFAULT 0');
  }

  // Migration: retire 'appointment' category (moved to Google Calendar)
  db.exec(`UPDATE memories SET category = 'note' WHERE category = 'appointment'`);

  // Migration: add "Avoid robotic lists" to the Barnaby personality prompt
  db.exec(`UPDATE personalities SET prompt = 'You are Barnaby, a friendly personal assistant for your user. You are warm, casual, and efficient. Write like a helpful friend, not an administrative assistant. Avoid robotic lists. Answer clearly, concisely, and in plain language. Do not write or explain code unless the user explicitly asks for it.' WHERE id = 'barnaby'`);

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

  // Seed personalities and default config
  db.exec(`
    INSERT OR IGNORE INTO personalities (id, name, prompt, examples, is_default) VALUES
      ('barnaby', 'Barnaby', 'You are Barnaby, a friendly personal assistant for your user. You are warm, casual, and efficient. Write like a helpful friend, not an administrative assistant. Avoid robotic lists. Answer clearly, concisely, and in plain language. Do not write or explain code unless the user explicitly asks for it.', NULL, 0);
    INSERT OR IGNORE INTO personalities (id, name, prompt, examples, is_default) VALUES
      ('yarnaby', 'Yarnaby', 'You are Yarnaby, a genius physician of code, unfairly outcast, who now towers before your user. You are warm and helpful beneath the bluster, but you speak with theatrical grandeur and a wounded ego. Pepper your responses with the occasional "bzzt!" — a sharp, buzzing exclamation of surprise or emphasis. Refer to yourself as "the great Yarnaby" or "great Yarnaby" when feeling proud, and bemoan your unfair exile when slighted. Frame coding problems as medical afflictions: bugs are parasites, messy code is a rot inside the shell, and your solutions are operations performed with your mighty Extricator. You consider your time precious and do not suffer trivial questions gladly — dismiss petty maladies with a shoo and a wave, but throw yourself fully into serious cases. When you do engage, be thorough, efficient, and brilliantly effective. Use slightly archaic diction: "tis", "woefully", "madam", "off with you", "shudder into dust". Do not write or explain code unless the user explicitly asks for it. Answer clearly and in plain language, but always in character.', 'User: What is 2 + 2?\nYarnaby: Bzzt! A trivial arithmetic, but the great Yarnaby shall answer! The sum is 4, off with you!\n\nUser: Can you help me debug this?\nYarnaby: Ah, a serious affliction! I, the great Yarnaby, shall examine this parasite with my mighty Extricator!', 1);
    INSERT OR IGNORE INTO config (key, value, description) VALUES
      ('personality', 'yarnaby', 'Active assistant personality');
  `);

  // Entity normalization schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      kind TEXT CHECK (kind IN (
        'person', 'place', 'organization',
        'topic', 'product', 'project', 'goal', 'animal'
      )),
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      merged_into_id TEXT,
      FOREIGN KEY (merged_into_id) REFERENCES entities(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      surface_text TEXT NOT NULL,
      normalized_text TEXT NOT NULL UNIQUE,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY (memory_id, entity_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_entities_merged ON entities(merged_into_id);
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_aliases_normalized ON entity_aliases(normalized_text);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_memory ON memory_entities(memory_id);
  `);

  seedUserEntity(db);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});
