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
  findDefault(): Personality | null;
}

export function createPersonalityRepository(db: Database): PersonalityRepository {
  return {
    findAll(): Personality[] {
      const rows = db.prepare('SELECT id, name, prompt, examples, is_default FROM personalities').all() as Personality[];
      return rows;
    },
    findById(id: string): Personality | null {
      const row = db.prepare('SELECT id, name, prompt, examples, is_default FROM personalities WHERE id = ?').get(id) as Personality | undefined;
      return row ?? null;
    },
    findDefault(): Personality | null {
      const row = db.prepare('SELECT id, name, prompt, examples, is_default FROM personalities WHERE is_default = 1 LIMIT 1').get() as Personality | undefined;
      return row ?? null;
    }
  };
}
