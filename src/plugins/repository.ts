import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export type MemoryCategory = 'appointment' | 'note' | 'todo' | 'purchase';

export type Memory = {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  permanent: boolean;
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

export interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };
}

type MemoryRow = {
  id: string;
  content: string;
  category: MemoryCategory;
  permanent: number;
  created_at: number;
  tag_names: string | null;
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

      let tagFilterClause = '';
      if (query.tags) {
        const tagList = query.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        if (tagList.length > 0) {
          const placeholders = tagList.map(() => '?').join(',');
          tagFilterClause = `AND m.id IN (
            SELECT mt.memory_id
            FROM memory_tags mt
            JOIN tags t ON mt.tag_id = t.id
            WHERE t.name IN (${placeholders})
          )`;
          params.push(...tagList);
        }
      }

      const whereClause = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';

      const countSql = `SELECT COUNT(*) as total FROM memories m ${whereClause} ${tagFilterClause}`;
      const countRow = db.prepare(countSql).get(...params) as { total: number };
      const total = countRow.total;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const offset = (page - 1) * limit;

      const dataSql = `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
                       FROM memories m
                       LEFT JOIN memory_tags mt ON m.id = mt.memory_id
                       LEFT JOIN tags t ON mt.tag_id = t.id
                       ${whereClause} ${tagFilterClause}
                       GROUP BY m.id
                       ORDER BY m.created_at DESC
                       LIMIT ? OFFSET ?`;

      const rows = db.prepare(dataSql).all(...params, limit, offset) as MemoryRow[];

      const data = rows.map(rowToMemory);

      return { data, total };
    },

    findForContext() {
      return { permanent: [], recent: [] };
    },

    delete(id) {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return result.changes > 0;
    },
  };
}

export default fp(async function repositoryPlugin(fastify: FastifyInstance) {
  const repo = createMemoryRepository(fastify.db);
  fastify.decorate('memoryRepository', repo);
});
