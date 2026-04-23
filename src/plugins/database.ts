import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';

export default fp(async function databasePlugin(fastify: FastifyInstance) {
  const dbPath = process.env.DATABASE_PATH || ':memory:';
  const db = new Database(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('appointment', 'note', 'todo', 'purchase')),
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
  `);

  fastify.decorate('db', db);

  fastify.addHook('onClose', async () => {
    db.close();
  });
});
