import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

export type Briefing = {
  id: string;
  content: string;
  triggeredAt: string; // ISO 8601
  triggerType: 'scheduled' | 'manual';
};

export type CreateBriefingBody = {
  content: string;
  triggerType: 'scheduled' | 'manual';
};

export interface BriefingRepository {
  create(data: CreateBriefingBody): Briefing;
  findLatest(): Briefing | null;
  findAll(): Briefing[];
}

type BriefingRow = {
  id: string;
  content: string;
  triggered_at: number;
  trigger_type: 'scheduled' | 'manual';
};

function rowToBriefing(row: BriefingRow): Briefing {
  return {
    id: row.id,
    content: row.content,
    triggeredAt: new Date(row.triggered_at).toISOString(),
    triggerType: row.trigger_type,
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

      return rows.map((row) => rowToBriefing(row));
    },
  };
}

export default fp(async function briefingRepositoryPlugin(fastify: FastifyInstance) {
  const repo = createBriefingRepository(fastify.db);
  fastify.decorate('briefingRepository', repo);
});
