import type { Database } from 'better-sqlite3';

export interface Personality {
  id: string;
  name: string;
  prompt: string;
  examples: string | null;
}

export interface PersonalityRepository {
  findAll(): Personality[];
  findById(id: string): Personality | null;
}

export function createPersonalityRepository(db: Database): PersonalityRepository {
  return {
    findAll() {
      const rows = db.prepare('SELECT id, name, prompt, examples FROM personalities').all() as Personality[];
      return rows;
    },
    findById(id) {
      const row = db.prepare('SELECT id, name, prompt, examples FROM personalities WHERE id = ?').get(id) as Personality | undefined;
      return row ?? null;
    }
  };
}
