import type { Database } from 'better-sqlite3';

export type MemoryActionType = 'completed' | 'dismissed';

export interface MemoryAction {
  id: string;
  memoryId: string;
  action: MemoryActionType;
  createdAt: string; // ISO 8601
}

export interface MemoryActionRepository {
  create(memoryId: string, action: MemoryActionType): MemoryAction;
  findByMemoryIds(memoryIds: string[]): Map<string, MemoryAction[]>;
  delete(id: string): boolean;
}

interface MemoryActionRow {
  id: string;
  memory_id: string;
  action: MemoryActionType;
  created_at: number;
}

/**
 * Factory that creates the memory-action repository backed by SQLite.
 *
 * Memory actions represent the terminal states of Todo memories
 * (completed or dismissed) and are kept separate from the memory row
 * itself so that a memory's history is preserved.
 */
export function createMemoryActionRepository(db: Database): MemoryActionRepository {
  return {
    /**
     * Records a terminal action against a Todo memory.
     *
     * Validates that the memory exists first to prevent orphaned action rows.
     */
    create(memoryId: string, action: MemoryActionType): MemoryAction {
      const memory = db.prepare('SELECT id FROM memories WHERE id = ?').get(memoryId);
      if (!memory) {
        throw new Error(`Memory not found: ${memoryId}`);
      }

      const id = crypto.randomUUID();
      const createdAt = Date.now();

      db.prepare(
        'INSERT INTO memory_actions (id, memory_id, action, created_at) VALUES (?, ?, ?, ?)'
      ).run(id, memoryId, action, createdAt);

      return {
        id,
        memoryId,
        action,
        createdAt: new Date(createdAt).toISOString()
      };
    },

    /**
     * Batches lookup of actions for a set of memory IDs.
     *
     * Returns a Map so that callers can perform O(1) lookups when
     * hydrating a list of ResolvedMemories.
     */
    findByMemoryIds(memoryIds: string[]): Map<string, MemoryAction[]> {
      const map = new Map<string, MemoryAction[]>();
      if (memoryIds.length === 0) return map;

      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, memory_id, action, created_at FROM memory_actions WHERE memory_id IN (${placeholders})`
      ).all(...memoryIds) as MemoryActionRow[];

      for (const row of rows) {
        const action: MemoryAction = {
          id: row.id,
          memoryId: row.memory_id,
          action: row.action,
          createdAt: new Date(row.created_at).toISOString()
        };
        const existing = map.get(row.memory_id) || [];
        existing.push(action);
        map.set(row.memory_id, existing);
      }

      return map;
    },

    /**
     * Deletes a memory action by its primary key.
     *
     * Returns whether a row was actually removed.
     */
    delete(id: string): boolean {
      const result = db.prepare('DELETE FROM memory_actions WHERE id = ?').run(id);
      return result.changes > 0;
    }
  };
}
