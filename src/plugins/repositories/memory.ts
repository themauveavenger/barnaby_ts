import type { Database } from 'better-sqlite3';
import { MEMORY_CATEGORY_NAMES, type MemoryCategory } from '../memory-categories.js';
import { extractEntities, normalizeText, type EntityRepository } from './entity.js';
import type { MemoryActionType } from './memory-action.js';
import type { EmbeddingProvider } from '../embedding-provider.js';

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
  q?: string;
}

export interface SearchOptions {
  query?: string;
  queryEmbedding?: number[];
  entityName?: string;
  category?: string;
  tags?: string[];
  limit?: number;
}

export type ResolvedMemory = Memory & {
  action: MemoryActionType;
  actionCreatedAt: string; // ISO 8601
};

export interface MemoryRepository {
  create(data: CreateMemoryBody): Promise<Memory>;
  findById(id: string): Memory | null;
  findAll(query: ListMemoriesQuery): { data: Memory[]; total: number };
  update(id: string, data: UpdateMemoryBody): Promise<Memory>;
  delete(id: string): boolean;
  search(options: SearchOptions): Promise<{ data: Memory[]; total: number }>;
  findForContext(contextText?: string): Promise<{ permanent: Memory[]; relevant: Memory[] }>;
  findRecent(days: number): Memory[];
  findResolvedRecent(days: number): ResolvedMemory[];
  findByTags(tags: string[], options?: { permanentOnly?: boolean }): Memory[];
  findByEntity(entityName: string, options?: { limit?: number; queryEmbedding?: number[] }): Memory[];
}

interface MemoryRow {
  id: string;
  content: string;
  category: MemoryCategory;
  permanent: number;
  created_at: number;
  embedding: string | null;
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
 * Builds a valid FTS5 MATCH expression from free-form user input.
 *
 * Each token is turned into a prefix query (`token*`) and tokens are
 * combined with `AND`. This gives the behaviour users expect from a
 * simple search box while avoiding FTS5 syntax errors from punctuation.
 */
function buildMatchExpression(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];

  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length === 0) {
    return '""';
  }

  return uniqueTokens.map(t => `${t}*`).join(' AND ');
}

/**
 * Computes the cosine similarity between two vectors.
 *
 * Vectors are assumed to be non-zero; if either is a zero vector the
 * similarity is 0. This is used by the brute-force semantic scan.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Parses a JSON-encoded embedding stored in the database.
 *
 * Keeps the JSON serialisation detail isolated so a future migration to
 * BLOB storage only needs to change this helper.
 */
function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Resolves an entity name to the set of memory IDs linked to it.
 *
 * Returns an empty set if the name does not match a known canonical
 * entity, signalling that no entity boost should be applied.
 */
function resolveEntityMemoryIds(
  entityRepository: EntityRepository,
  entityName?: string
): Set<string> {
  if (!entityName) return new Set();
  const normalized = normalizeText(entityName);
  const alias = entityRepository.findByNormalizedText(normalized);
  if (!alias) return new Set();
  return new Set(entityRepository.findMemoryIdsByEntityId(alias.entity.id));
}

/**
 * Searches memories using keyword, semantic, and recency signals.
 *
 * The method is the single public retrieval seam for ranked search:
 * - Keyword results come from the FTS5 index.
 * - Semantic results come from brute-force cosine similarity over stored
 *   embeddings.
 * - The hybrid score combines keyword, semantic, recency and entity boost.
 *
 * Category, tags and entity filters are applied before ranking so results
 * respect the caller's constraints.
 */
async function searchMemories(
  db: Database,
  entityRepository: EntityRepository,
  embeddingProvider: EmbeddingProvider | undefined,
  options: SearchOptions
): Promise<{ data: Memory[]; total: number }> {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.category) {
    conditions.push('m.category = ?');
    params.push(normalizeText(options.category));
  }

  if (options.tags && options.tags.length > 0) {
    const normalizedTags = options.tags.map(t => normalizeText(t)).filter(Boolean);
    if (normalizedTags.length > 0) {
      const placeholders = normalizedTags.map(() => '?').join(',');
      conditions.push(`m.id IN (
        SELECT mt.memory_id
        FROM memory_tags mt
        JOIN tags t ON mt.tag_id = t.id
        WHERE t.name IN (${placeholders})
      )`);
      params.push(...normalizedTags);
    }
  }

  if (options.entityName) {
    const normalized = normalizeText(options.entityName);
    const alias = entityRepository.findByNormalizedText(normalized);
    if (alias) {
      conditions.push('m.id IN (SELECT memory_id FROM memory_entities WHERE entity_id = ?)');
      params.push(alias.entity.id);
    } else {
      return { data: [], total: 0 };
    }
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
     FROM memories m
     LEFT JOIN memory_tags mt ON m.id = mt.memory_id
     LEFT JOIN tags t ON mt.tag_id = t.id
     ${whereClause}
     GROUP BY m.id`
  ).all(...params) as MemoryRow[];

  const keywordScores = new Map<string, number>();
  if (options.query) {
    const matchExpr = buildMatchExpression(options.query);
    const ftsRows = db.prepare(
      'SELECT memory_id, rank FROM memories_fts WHERE memories_fts MATCH ?'
    ).all(matchExpr) as { memory_id: string; rank: number }[];

    if (ftsRows.length > 0) {
      const scored = ftsRows.map(r => ({
        id: r.memory_id,
        raw: 1 / (1 + Math.abs(r.rank))
      }));
      const maxRaw = Math.max(...scored.map(s => s.raw));
      for (const s of scored) {
        keywordScores.set(s.id, s.raw / maxRaw);
      }
    }
  }

  let queryEmbedding = options.queryEmbedding;
  if (options.query && !queryEmbedding && embeddingProvider) {
    queryEmbedding = await embeddingProvider.embed(options.query);
  }

  const semanticScores = new Map<string, number>();
  if (queryEmbedding) {
    for (const row of rows) {
      const embedding = parseEmbedding(row.embedding);
      if (!embedding || embedding.length !== queryEmbedding.length) continue;
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      if (similarity > 0) {
        semanticScores.set(row.id, similarity);
      }
    }
  }

  const entityMemoryIds = resolveEntityMemoryIds(entityRepository, options.entityName);
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;

  const scored = rows.map(row => {
    const keywordScore = keywordScores.get(row.id) ?? 0;
    const semanticScore = semanticScores.get(row.id) ?? 0;
    const ageDays = (now - row.created_at) / msPerDay;
    const recencyScore = Math.exp(-ageDays / 30);
    const entityBoost = entityMemoryIds.has(row.id) ? 1 : 0;
    const combined =
      0.4 * keywordScore +
      0.4 * semanticScore +
      0.15 * recencyScore +
      0.05 * entityBoost;

    return { row, score: combined };
  });

  scored.sort((a, b) => b.score - a.score);

  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const total = scored.length;
  const data = scored.slice(0, limit).map(s => rowToMemory(s.row));

  return { data, total };
}

/**
 * Factory that creates the memory repository backed by SQLite.
 *
 * The memory repository depends on an {@link EntityRepository} so
 * that entity extraction and linking happens atomically inside the
 * same transaction as the memory insert. An optional
 * {@link EmbeddingProvider} enables semantic search; when absent the
 * repository degrades to keyword-only retrieval.
 */
export function createMemoryRepository(
  db: Database,
  entityRepository: EntityRepository,
  embeddingProvider?: EmbeddingProvider
): MemoryRepository {
  return {
    /**
     * Creates a new memory, tags, embedding and entity links in a single
     * transaction.
     *
     * Entity extraction is bundled here so that every memory write is
     * atomic: either the memory, tags, entities and embedding are all
     * persisted, or nothing is. The embedding is computed before the
     * transaction starts so the synchronous SQLite transaction never waits
     * on an async model call.
     */
    async create(data: CreateMemoryBody): Promise<Memory> {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const content = data.content.trim();
      const category = normalizeText(data.category);
      if (!MEMORY_CATEGORY_NAMES.includes(category as MemoryCategory)) {
        throw new Error(`Invalid category: ${data.category}`);
      }
      const permanent = data.permanent ? 1 : 0;
      const tags = [
        ...new Set(
          (data.tags || [])
            .map(t => normalizeText(t))
            .filter(Boolean)
        )
      ];

      const embedding = embeddingProvider
        ? JSON.stringify(await embeddingProvider.embed(content))
        : null;

      const insertMemory = db.prepare(
        'INSERT INTO memories (id, content, category, permanent, created_at, embedding) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertTag = db.prepare(
        'INSERT OR IGNORE INTO tags (name) VALUES (?)'
      );
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const entityNames = extractEntities(content);

      const transaction = db.transaction(() => {
        insertMemory.run(id, content, category, permanent, createdAt, embedding);
        for (const tag of tags) {
          insertTag.run(tag);
          linkTag.run(id, tag);
        }

        for (const entityName of entityNames) {
          const normalized = normalizeText(entityName);
          const existing = entityRepository.findByNormalizedText(normalized);
          if (existing) {
            entityRepository.linkMemoryToEntity(id, existing.entity.id);
            const now = Date.now();
            db.prepare('UPDATE entity_aliases SET last_seen = ? WHERE id = ?').run(now, existing.alias.id);
            db.prepare('UPDATE entities SET last_seen = ? WHERE id = ?').run(now, existing.entity.id);
          } else {
            const entity = entityRepository.createEntity(entityName);
            entityRepository.createAlias(entity.id, entityName);
            entityRepository.linkMemoryToEntity(id, entity.id);
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
        params.push(normalizeText(query.category));
      }

      if (query.tags) {
        const tagList = query.tags
          .split(',')
          .map(t => normalizeText(t))
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
        const normalizedEntity = normalizeText(query.entity);
        const alias = entityRepository.findByNormalizedText(normalizedEntity);
        if (alias) {
          conditions.push('m.id IN (SELECT memory_id FROM memory_entities WHERE entity_id = ?)');
          params.push(alias.entity.id);
        } else {
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
     * Returns permanent and semantically relevant memories for LLM context
     * injection.
     *
     * Permanent memories are enduring facts (preferences, identity, etc.).
     * The `relevant` array is populated by embedding the supplied
     * conversation text and ranking active non-permanent memories by
     * semantic similarity. When no conversation text or embedding provider
     * is available, relevant memories fall back to active recent entries so
     * callers always receive usable context.
     */
    async findForContext(contextText?: string): Promise<{ permanent: Memory[]; relevant: Memory[] }> {
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

      if (!contextText || !embeddingProvider) {
        const days = parseInt(process.env.CONTEXT_WINDOW_DAYS || '30', 10);
        const effectiveDays = Number.isNaN(days) ? 30 : days;
        const recentRows = findActiveRecentRows(db, effectiveDays);
        return {
          permanent: permanentRows.map(row => rowToMemory(row)),
          relevant: recentRows.map(row => rowToMemory(row))
        };
      }

      const queryEmbedding = await embeddingProvider.embed(contextText);
      const limit = parseInt(process.env.CONTEXT_RELEVANT_LIMIT || '20', 10);
      const effectiveLimit = Number.isNaN(limit) ? 20 : limit;

      const rows = db.prepare(
        `SELECT m.*, GROUP_CONCAT(t.name) as tag_names
         FROM memories m
         LEFT JOIN memory_tags mt ON m.id = mt.memory_id
         LEFT JOIN tags t ON mt.tag_id = t.id
         LEFT JOIN memory_actions ma ON m.id = ma.memory_id
         WHERE m.permanent = 0
         GROUP BY m.id
         HAVING COUNT(ma.id) = 0`
      ).all() as MemoryRow[];

      const scored = rows
        .map(row => {
          const embedding = parseEmbedding(row.embedding);
          const semanticScore = embedding && embedding.length === queryEmbedding.length
            ? cosineSimilarity(queryEmbedding, embedding)
            : 0;
          return { row, score: semanticScore };
        })
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, effectiveLimit)
        .map(s => rowToMemory(s.row));

      return {
        permanent: permanentRows.map(row => rowToMemory(row)),
        relevant: scored
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
            .map(t => normalizeText(t))
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
     * Deletes a memory by its primary key.
     *
     * Foreign-key cascades on memory_tags, memory_actions and
     * memory_entities keep related rows in sync automatically. The FTS5
     * delete trigger removes the memory from the keyword index.
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
     * When a query embedding is supplied, entity-linked memories are
     * additionally ranked by semantic similarity.
     */
    findByEntity(entityName: string, options: { limit?: number; queryEmbedding?: number[] } = {}): Memory[] {
      const normalized = normalizeText(entityName);
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
      `;

      const rows = db.prepare(sql).all(...memoryIds) as MemoryRow[];
      let memories = rows.map(row => rowToMemory(row));

      if (options.queryEmbedding) {
        const queryEmbedding = options.queryEmbedding;
        memories = memories
          .map(memory => {
            const row = rows.find(r => r.id === memory.id);
            const embedding = row ? parseEmbedding(row.embedding) : null;
            const score = embedding && embedding.length === queryEmbedding.length
              ? cosineSimilarity(queryEmbedding, embedding)
              : 0;
            return { memory, score };
          })
          .sort((a, b) => b.score - a.score)
          .map(s => s.memory);
      } else {
        memories.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      if (options.limit) {
        memories = memories.slice(0, options.limit);
      }

      return memories;
    },

    /**
     * Updates a memory's content and/or tags and regenerates its embedding.
     *
     * Tags are fully replaced rather than merged so that the update
     * reflects the exact set the caller intended. The FTS5 update trigger
     * keeps the keyword index in sync automatically.
     */
    async update(id: string, data: UpdateMemoryBody): Promise<Memory> {
      const existing = db.prepare('SELECT id FROM memories WHERE id = ?').get(id);
      if (!existing) {
        throw new Error(`Memory not found: ${id}`);
      }

      const newContent = data.content !== undefined ? data.content.trim() : undefined;
      let embedding: string | null | undefined;
      if (newContent !== undefined && embeddingProvider) {
        embedding = JSON.stringify(await embeddingProvider.embed(newContent));
      }

      const setContent = embedding !== undefined
        ? db.prepare('UPDATE memories SET content = ?, embedding = ? WHERE id = ?')
        : db.prepare('UPDATE memories SET content = ? WHERE id = ?');
      const deleteMemoryTags = db.prepare('DELETE FROM memory_tags WHERE memory_id = ?');
      const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
      const linkTag = db.prepare(
        'INSERT INTO memory_tags (memory_id, tag_id) VALUES (?, (SELECT id FROM tags WHERE name = ?))'
      );

      const transaction = db.transaction(() => {
        if (newContent !== undefined) {
          if (embedding !== undefined) {
            setContent.run(newContent, embedding, id);
          } else {
            setContent.run(newContent, id);
          }
        }

        if (data.tags !== undefined) {
          const normalizedTags = [
            ...new Set(
              data.tags
                .map(t => normalizeText(t))
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
     * Ranked search over memories.
     *
     * Delegates to {@link searchMemories} so that keyword, semantic and
     * hybrid scoring live in one place.
     */
    search(options: SearchOptions): Promise<{ data: Memory[]; total: number }> {
      return searchMemories(db, entityRepository, embeddingProvider, options);
    }
  };
}
