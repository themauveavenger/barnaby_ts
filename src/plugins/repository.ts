import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';
export type MemoryActionType = 'completed' | 'dismissed';

export type Memory = {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  permanent: boolean;
  createdAt: string; // ISO 8601
};

export type MemoryAction = {
  id: string;
  memoryId: string;
  action: MemoryActionType;
  createdAt: string; // ISO 8601
};

export type CreateMemoryBody = {
  content: string;
  category: MemoryCategory;
  tags?: string[];
  permanent?: boolean;
};

export type ListMemoriesQuery = {
  category?: string;
  tags?: string;
  page?: number;
  limit?: number;
};

export type ResolvedMemory = Memory & {
  action: MemoryActionType;
  actionCreatedAt: string; // ISO 8601
};

export interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };
  findRecent(days: number): Memory[];
  findResolvedRecent(days: number): ResolvedMemory[];
  findByTags(tags: string[], options?: { permanentOnly?: boolean }): Memory[];
}

export interface MemoryActionRepository {
  create(memoryId: string, action: MemoryActionType): MemoryAction;
  findByMemoryIds(memoryIds: string[]): Map<string, MemoryAction[]>;
  delete(id: string): boolean;
}

type MemoryRow = {
  id: string;
  content: string;
  category: MemoryCategory;
  permanent: number;
  created_at: number;
  tag_names: string | null;
};

type ResolvedMemoryRow = MemoryRow & {
  action: MemoryActionType;
  action_created_at: number;
};

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    tags: row.tag_names ? row.tag_names.split(',') : [],
    permanent: Boolean(row.permanent),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToResolvedMemory(row: ResolvedMemoryRow): ResolvedMemory {
  return {
    ...rowToMemory(row),
    action: row.action,
    actionCreatedAt: new Date(row.action_created_at).toISOString(),
  };
}

function findActiveRecentRows(db: Database, days: number): MemoryRow[] {
  const effectiveDays = Number.isNaN(days) || days <= 0 ? 7 : days;
  const cutoff = Date.now() - effectiveDays * 24 * 60 * 60 * 1000;

  return db
    .prepare(
      `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
       FROM memories m
       LEFT JOIN memory_tags mt ON m.id = mt.memory_id
       LEFT JOIN tags t ON mt.tag_id = t.id
       LEFT JOIN memory_actions ma ON m.id = ma.memory_id
       WHERE m.permanent = 0 AND m.created_at >= ?
       GROUP BY m.id
       HAVING COUNT(ma.id) = 0
       ORDER BY m.created_at DESC`
    )
    .all(cutoff) as MemoryRow[];
}

function findResolvedRecentRows(db: Database, days: number): ResolvedMemoryRow[] {
  const effectiveDays = Number.isNaN(days) || days <= 0 ? 7 : days;
  const cutoff = Date.now() - effectiveDays * 24 * 60 * 60 * 1000;

  return db
    .prepare(
      `SELECT m.*, GROUP_CONCAT(t.name) as tag_names,
              ma.action, ma.created_at as action_created_at
       FROM memories m
       JOIN memory_actions ma ON m.id = ma.memory_id
       LEFT JOIN memory_tags mt ON m.id = mt.memory_id
       LEFT JOIN tags t ON mt.tag_id = t.id
       WHERE m.created_at >= ?
       GROUP BY m.id, ma.action
       ORDER BY m.created_at DESC`
    )
    .all(cutoff) as ResolvedMemoryRow[];
}

export function createMemoryActionRepository(db: Database): MemoryActionRepository {
  return {
    create(memoryId, action) {
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
        createdAt: new Date(createdAt).toISOString(),
      };
    },

    findByMemoryIds(memoryIds) {
      const map = new Map<string, MemoryAction[]>();
      if (memoryIds.length === 0) return map;

      const placeholders = memoryIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT id, memory_id, action, created_at FROM memory_actions WHERE memory_id IN (${placeholders})`
      ).all(...memoryIds) as Array<{ id: string; memory_id: string; action: MemoryActionType; created_at: number }>;

      for (const row of rows) {
        const action: MemoryAction = {
          id: row.id,
          memoryId: row.memory_id,
          action: row.action,
          createdAt: new Date(row.created_at).toISOString(),
        };
        const existing = map.get(row.memory_id) || [];
        existing.push(action);
        map.set(row.memory_id, existing);
      }

      return map;
    },

    delete(id) {
      const result = db.prepare('DELETE FROM memory_actions WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

export function createMemoryRepository(db: Database): MemoryRepository {
  return {
    create(data) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const content = data.content.trim();
      const category = data.category.toLowerCase() as MemoryCategory;
      const permanent = data.permanent ? 1 : 0;
      const tags = [
        ...new Set(
          (data.tags || [])
            .map((t) => t.toLowerCase().trim())
            .filter(Boolean)
        ),
      ];

      const insertMemory = db.prepare(
        'INSERT INTO memories (id, content, category, permanent, created_at) VALUES (?, ?, ?, ?, ?)'
      );
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO tags (name) VALUES (?)'
      );
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const transaction = db.transaction(() => {
        insertMemory.run(id, content, category, permanent, createdAt);
        for (const tag of tags) {
          insertTag.run(tag);
          linkTag.run(id, tag);
        }
      });

      transaction();

      return this.findById(id)!;
    },

    findById(id) {
      const row = db
        .prepare(
          `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
           FROM memories m
           LEFT JOIN memory_tags mt ON m.id = mt.memory_id
           LEFT JOIN tags t ON mt.tag_id = t.id
           WHERE m.id = ?
           GROUP BY m.id`
        )
        .get(id) as MemoryRow | undefined;

      if (!row) return null;

      return rowToMemory(row);
    },

    findAll(query) {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (query.category) {
        conditions.push('m.category = ?');
        params.push(query.category.toLowerCase());
      }

      if (query.tags) {
        const tagList = query.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (tagList.length > 0) {
          const placeholders = tagList.map(() => '?').join(',');
          conditions.push(`m.id IN (
            SELECT mt.memory_id
            FROM memory_tags mt
            JOIN tags t ON mt.tag_id = t.id
            WHERE t.name IN (${placeholders})
          )`);
          params.push(...tagList);
        }
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const countSql = `SELECT COUNT(*) as total FROM memories m ${whereClause}`;
      const countRow = db.prepare(countSql).get(...params) as { total: number };
      const total = countRow.total;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const offset = (page - 1) * limit;

      const dataSql = `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
                       FROM memories m
                       LEFT JOIN memory_tags mt ON m.id = mt.memory_id
                       LEFT JOIN tags t ON mt.tag_id = t.id
                       ${whereClause}
                       GROUP BY m.id
                       ORDER BY m.created_at DESC
                       LIMIT ? OFFSET ?`;

      const rows = db.prepare(dataSql).all(...params, limit, offset) as MemoryRow[];

      const data = rows.map((row) => rowToMemory(row));

      return { data, total };
    },

    findForContext() {
      const days = parseInt(process.env.CONTEXT_WINDOW_DAYS || '30', 10);
      const effectiveDays = Number.isNaN(days) ? 30 : days;

      const permanentRows = db
        .prepare(
          `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
           FROM memories m
           LEFT JOIN memory_tags mt ON m.id = mt.memory_id
           LEFT JOIN tags t ON mt.tag_id = t.id
           WHERE m.permanent = 1
           GROUP BY m.id
           ORDER BY m.created_at DESC`
        )
        .all() as MemoryRow[];

      const recentRows = findActiveRecentRows(db, effectiveDays);

      return {
        permanent: permanentRows.map((row) => rowToMemory(row)),
        recent: recentRows.map((row) => rowToMemory(row)),
      };
    },

    findRecent(days) {
      const rows = findActiveRecentRows(db, days);
      return rows.map((row) => rowToMemory(row));
    },

    findResolvedRecent(days) {
      const rows = findResolvedRecentRows(db, days);
      return rows.map((row) => rowToResolvedMemory(row));
    },

    findByTags(tags, options = {}) {
      const normalizedTags = [
        ...new Set(
          tags
            .map((t) => t.toLowerCase().trim())
            .filter(Boolean)
        ),
      ];
      if (normalizedTags.length === 0) return [];

      const placeholders = normalizedTags.map(() => '?').join(',');
      const permanentFilter = options.permanentOnly ? 'AND m.permanent = 1' : '';

      const sql = `
        WITH matching AS (
          SELECT m.id
          FROM memories m
          JOIN memory_tags mt ON m.id = mt.memory_id
          JOIN tags t ON mt.tag_id = t.id
          WHERE t.name IN (${placeholders})
            ${permanentFilter}
          GROUP BY m.id
          HAVING COUNT(DISTINCT t.name) = ?
        )
        SELECT m.*, GROUP_CONCAT(t.name) as tag_names
        FROM memories m
        JOIN matching mm ON m.id = mm.id
        LEFT JOIN memory_tags mt ON m.id = mt.memory_id
        LEFT JOIN tags t ON mt.tag_id = t.id
        GROUP BY m.id
        ORDER BY m.created_at DESC
      `;

      const params = [...normalizedTags, normalizedTags.length];
      const rows = db.prepare(sql).all(...params) as MemoryRow[];

      return rows.map((row) => rowToMemory(row));
    },

    delete(id) {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

export default fp(async function repositoryPlugin(fastify: FastifyInstance) {
  const repo = createMemoryRepository(fastify.db);
  const actionRepo = createMemoryActionRepository(fastify.db);
  fastify.decorate('memoryRepository', repo);
  fastify.decorate('memoryActionRepository', actionRepo);
});