import type { Database } from 'better-sqlite3';

export interface Config {
  key: string;
  value: string;
  description: string;
}

export interface ConfigRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export function createConfigRepository(db: Database): ConfigRepository {
  return {
    get(key: string): string | undefined {
      const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value;
    },
    set(key: string, value: string): void {
      const existing = db.prepare('SELECT description FROM config WHERE key = ?').get(key) as { description: string } | undefined;
      db.prepare('INSERT OR REPLACE INTO config (key, value, description) VALUES (?, ?, ?)').run(
        key,
        value,
        existing?.description ?? ''
      );
    }
  };
}
