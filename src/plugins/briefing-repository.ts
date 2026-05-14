import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export interface Briefing {
  id: string;
  content: string;
  triggeredAt: string; // ISO 8601
  triggerType: 'scheduled' | 'manual';
}

export interface CreateBriefingBody {
  content: string;
  triggerType: 'scheduled' | 'manual';
}

export interface ListBriefingsQuery {
  page?: number;
  limit?: number;
}

export interface BriefingRepository {
  create(data: CreateBriefingBody): Briefing;
  findLatest(): Briefing | null;
  findAll(): Briefing[];
  findAllPaginated(query: ListBriefingsQuery): { data: Briefing[]; total: number };
  delete(id: string): boolean;
}

interface BriefingRow {
  id: string;
  content: string;
  triggered_at: number;
  trigger_type: 'scheduled' | 'manual';
}

function rowToBriefing(row: BriefingRow): Briefing {
  return {
    id: row.id,
    content: row.content,
    triggeredAt: new Date(row.triggered_at).toISOString(),
    triggerType: row.trigger_type
  };
}

export function createBriefingRepository(db: Database): BriefingRepository {
  return {
    create(data) {
      const id = crypto.randomUUID();
      const triggeredAt = Date.now();

      db.prepare(
        'INSERT INTO briefings (id, content, triggered_at, trigger_type) VALUES (?, ?, ?, ?)'
      ).run(id, data.content, triggeredAt, data.triggerType);

      const row = db
        .prepare('SELECT * FROM briefings WHERE id = ?')
        .get(id) as BriefingRow;

      return rowToBriefing(row);
    },

    findLatest() {
      const row = db
        .prepare('SELECT * FROM briefings ORDER BY triggered_at DESC, rowid DESC LIMIT 1')
        .get() as BriefingRow | undefined;

      if (!row) return null;
      return rowToBriefing(row);
    },

    findAll() {
      const rows = db
        .prepare('SELECT * FROM briefings ORDER BY triggered_at DESC, rowid DESC')
        .all() as BriefingRow[];

      return rows.map(row => rowToBriefing(row));
    },

    findAllPaginated(query: ListBriefingsQuery) {
      const countRow = db.prepare('SELECT COUNT(*) as total FROM briefings').get() as { total: number };
      const total = countRow.total;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 20));
      const offset = (page - 1) * limit;

      const rows = db
        .prepare('SELECT * FROM briefings ORDER BY triggered_at DESC, rowid DESC LIMIT ? OFFSET ?')
        .all(limit, offset) as BriefingRow[];

      return { data: rows.map(row => rowToBriefing(row)), total };
    },

    delete(id: string) {
      const result = db.prepare('DELETE FROM briefings WHERE id = ?').run(id);
      return result.changes > 0;
    }
  };
}

export default fp(async function briefingRepositoryPlugin(fastify: FastifyInstance) {
  const repo = createBriefingRepository(fastify.db);
  fastify.decorate('briefingRepository', repo);
});
