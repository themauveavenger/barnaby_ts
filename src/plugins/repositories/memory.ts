import type { Database } from 'better-sqlite3';
import { MEMORY_CATEGORY_NAMES, type MemoryCategory } from '../memory-categories.js';
import { extractEntities, type EntityRepository } from './entity.js';
import type { MemoryActionType } from './memory-action.js';

export interface Memory {
  id: string;
  content: string;
  category: MemoryCategory;
  tags: string[];
  permanent: boolean;
  createdAt: string; // ISO 8601
}

export interface CreateMemoryBody {
  content: string;
  category: MemoryCategory;
  tags?: string[];
  permanent?: boolean;
}

export interface UpdateMemoryBody {
  content?: string;
  tags?: string[];
}

export interface ListMemoriesQuery {
  category?: string;
  tags?: string;
  entity?: string;
  page?: number;
  limit?: number;
}

export type ResolvedMemory = Memory & {
  action: MemoryActionType;
  actionCreatedAt: string; // ISO 8601
};

export interface MemoryRepository {
  create(data: CreateMemoryBody): Memory;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  update(id: string, data: UpdateMemoryBody): Memory;
  delete(id: string): boolean;
  findForContext(): { permanent: Memory[]; recent: Memory[] };
  findRecent(days: number): Memory[];
  findResolvedRecent(days: number): ResolvedMemory[];
  findByTags(tags: string[], options?: { permanentOnly?: boolean }): Memory[];
  findByEntity(entityName: string, options?: { limit?: number }): Memory[];
}

interface MemoryRow {
  id: string;
  content: string;
  category: MemoryCategory;
  permanent: number;
  created_at: number;
  tag_names: string | null;
}

type ResolvedMemoryRow = MemoryRow & {
  action: MemoryActionType;
  action_created_at: number;
};

/**
 * Maps a raw database row to the domain Memory shape.
 *
 * Centralising this conversion keeps the repository decoupled from the
 * SQLite schema so column renames only need changing in one place.
 */
function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    content: row.content,
    category: row.category,
    tags: row.tag_names ? row.tag_names.split(',') : [],
    permanent: Boolean(row.permanent),
    createdAt: new Date(row.created_at).toISOString()
  };
}

/**
 * Maps a raw database row to the domain ResolvedMemory shape.
 *
 * Extends {@link rowToMemory} with the action state that represents the
 * terminal lifecycle of a Todo memory.
 */
function rowToResolvedMemory(row: ResolvedMemoryRow): ResolvedMemory {
  return {
    ...rowToMemory(row),
    action: row.action,
    actionCreatedAt: new Date(row.action_created_at).toISOString()
  };
}

/**
 * Finds active memories created within the last N days.
 *
 * "Active" means the memory has not been resolved (no completed or
 * dismissed action). Used to surface recent, still-relevant context.
 */
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

/**
 * Finds resolved memories created within the last N days.
 *
 * Resolved memories have a terminal action (completed or dismissed) and
 * are useful for showing what the user has recently finished.
 */
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

/**
 * Factory that creates the memory repository backed by SQLite.
 *
 * The memory repository depends on an {@link EntityRepository} so
 * that entity extraction and linking happens atomically inside the
 * same transaction as the memory insert.
 */
export function createMemoryRepository(db: Database, entityRepository: EntityRepository): MemoryRepository {
  return {
    /**
     * Creates a new memory, tags, and entity links in a single transaction.
     *
     * Entity extraction is bundled here so that every memory write is
     * atomic: either the memory, tags and entities are all persisted,
     * or nothing is.
     */
    create(data: CreateMemoryBody): Memory {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const content = data.content.trim();
      const category = data.category.toLowerCase();
      if (!MEMORY_CATEGORY_NAMES.includes(category as MemoryCategory)) {
        throw new Error(`Invalid category: ${data.category}`);
      }
      const permanent = data.permanent ? 1 : 0;
      const tags = [
        ...new Set(
          (data.tags || [])
            .map(t => t.toLowerCase().trim())
            .filter(Boolean)
        )
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

      const knownNames = entityRepository.getCanonicalNames();
      const entities = extractEntities(content, { knownNames });

      const transaction = db.transaction(() => {
        insertMemory.run(id, content, category, permanent, createdAt);
        for (const tag of tags) {
          insertTag.run(tag);
          linkTag.run(id, tag);
        }

        for (const entity of entities) {
          const normalized = entity.name.toLowerCase().trim();
          const existing = entityRepository.findByNormalizedText(normalized);
          if (existing) {
            entityRepository.linkMemoryToEntity(id, existing.entity.id);
            const now = Date.now();
            db.prepare('UPDATE entity_aliases SET last_seen = ? WHERE id = ?').run(now, existing.alias.id);
            db.prepare('UPDATE entities SET last_seen = ? WHERE id = ?').run(now, existing.entity.id);
          } else {
            const created = entityRepository.createEntity(entity.name, entity.kind ?? undefined);
            entityRepository.createAlias(created.id, entity.name);
            entityRepository.linkMemoryToEntity(id, created.id);
          }
        }
      });

      transaction();

      return this.findById(id)!;
    },

    /**
     * Retrieves a single memory by its primary key.
     */
    findById(id: string): Memory | null {
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

    /**
     * Lists memories with optional filters (category, tags, entity).
     *
     * Applies pagination so that the Admin UI and API stay performant
     * even as the memory table grows.
     */
    findAll(query: ListMemoriesQuery): { data: Memory[]; total: number } {
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (query.category) {
        conditions.push('m.category = ?');
        params.push(query.category.toLowerCase());
      }

      if (query.tags) {
        const tagList = query.tags
          .split(',')
          .map(t => t.trim().toLowerCase())
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

      if (query.entity) {
        const normalizedEntity = query.entity.toLowerCase().trim();
        const alias = entityRepository.findByNormalizedText(normalizedEntity);
        if (alias) {
          conditions.push('m.id IN (SELECT memory_id FROM memory_entities WHERE entity_id = ?)');
          params.push(alias.entity.id);
        } else {
          // Entity not found: return empty results
          return { data: [], total: 0 };
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

      const data = rows.map(row => rowToMemory(row));

      return { data, total };
    },

    /**
     * Returns permanent and recent memories for LLM context injection.
     *
     * Permanent memories are enduring facts (preferences, identity, etc.);
     * recent memories are active (non-resolved) entries within the
     * configured context window. This split lets the agent receive both
     * long-term and short-term context without duplication.
     */
    findForContext(): { permanent: Memory[]; recent: Memory[] } {
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
        permanent: permanentRows.map(row => rowToMemory(row)),
        recent: recentRows.map(row => rowToMemory(row))
      };
    },

    /**
     * Finds active memories created within the last N days.
     */
    findRecent(days: number): Memory[] {
      const rows = findActiveRecentRows(db, days);
      return rows.map(row => rowToMemory(row));
    },

    /**
     * Finds resolved memories created within the last N days.
     */
    findResolvedRecent(days: number): ResolvedMemory[] {
      const rows = findResolvedRecentRows(db, days);
      return rows.map(row => rowToResolvedMemory(row));
    },

    /**
     * Finds memories that match every requested tag.
     *
     * Uses a HAVING clause to enforce an intersection (AND) rather than
     * a union (OR), so that narrowing tags actually reduces results.
     */
    findByTags(tags: string[], options: { permanentOnly?: boolean } = {}): Memory[] {
      const normalizedTags = [
        ...new Set(
          tags
            .map(t => t.toLowerCase().trim())
            .filter(Boolean)
        )
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

      return rows.map(row => rowToMemory(row));
    },

    /**
     * Updates a memory's content and/or tags.
     *
     * Tags are fully replaced rather than merged so that the update
     * reflects the exact set the caller intended.
     */
    update(id: string, data: UpdateMemoryBody): Memory {
      const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
      if (!existing) {
        throw new Error(`Memory not found: ${id}`);
      }

      const setContent = db.prepare('UPDATE memories SET content = ? WHERE id = ?');
      const deleteMemoryTags = db.prepare('DELETE FROM memory_tags WHERE memory_id = ?');
      const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const transaction = db.transaction(() => {
        if (data.content !== undefined) {
          setContent.run(data.content.trim(), id);
        }

        if (data.tags !== undefined) {
          const normalizedTags = [
            ...new Set(
              data.tags
                .map(t => t.toLowerCase().trim())
                .filter(Boolean)
            )
          ];

          deleteMemoryTags.run(id);
          for (const tag of normalizedTags) {
            insertTag.run(tag);
            linkTag.run(id, tag);
          }
        }
      });

      transaction();

      return this.findById(id)!;
    },

    /**
     * Deletes a memory by its primary key.
     *
     * Foreign-key cascades on memory_tags, memory_actions and
     * memory_entities keep related rows in sync automatically.
     */
    delete(id: string): boolean {
      const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      return result.changes > 0;
    },

    /**
     * Finds all memories linked to a canonical entity (by name or alias).
     *
     * Resolves the supplied name through the alias table so that
     * searching for "josh" also finds memories that only mention "me".
     */
    findByEntity(entityName: string, options: { limit?: number } = {}): Memory[] {
      const normalized = entityName.toLowerCase().trim();
      const alias = entityRepository.findByNormalizedText(normalized);
      if (!alias) return [];

      const memoryIds = entityRepository.findMemoryIdsByEntityId(alias.entity.id);
      if (memoryIds.length === 0) return [];

      const placeholders = memoryIds.map(() => '?').join(',');
      const sql = `
        SELECT m.*, GROUP_CONCAT(t.name) as tag_names
        FROM memories m
        LEFT JOIN memory_tags mt ON m.id = mt.memory_id
        LEFT JOIN tags t ON mt.tag_id = t.id
        WHERE m.id IN (${placeholders})
        GROUP BY m.id
        ORDER BY m.created_at DESC
      `;

      const rows = db.prepare(sql).all(...memoryIds) as MemoryRow[];
      let memories = rows.map(row => rowToMemory(row));

      if (options.limit) {
        memories = memories.slice(0, options.limit);
      }

      return memories;
    }
  };
}
