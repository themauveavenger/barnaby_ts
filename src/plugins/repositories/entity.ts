import type { Database } from 'better-sqlite3';
import nlp from 'compromise';
import type { FastifyBaseLogger } from 'fastify';

export type EntityKind
  = 'person'
    | 'place'
    | 'organization'
    | 'topic'
    | 'product'
    | 'project'
    | 'goal'
    | 'animal';

export interface Entity {
  id: string;
  canonicalName: string;
  kind: EntityKind | null;
  firstSeen: string;
  lastSeen: string;
  mergedIntoId: string | null;
}

export interface EntityAlias {
  id: string;
  entityId: string;
  surfaceText: string;
  normalizedText: string;
  firstSeen: string;
  lastSeen: string;
}

export interface EntityRepository {
  createEntity(canonicalName: string, kind?: EntityKind | null): Entity;
  createAlias(entityId: string, surfaceText: string): EntityAlias;
  findByNormalizedText(normalizedText: string): { entity: Entity; alias: EntityAlias } | null;
  findEntityById(id: string): Entity | null;
  findCanonicalEntityById(id: string): Entity | null;
  getCanonicalNames(): { name: string; kind: EntityKind | null }[];
  mergeEntities(survivorId: string, loserId: string): void;
  linkMemoryToEntity(memoryId: string, entityId: string): void;
  findMemoryIdsByEntityId(entityId: string): string[];
}

interface EntityRow {
  id: string;
  canonical_name: string;
  kind: EntityKind | null;
  first_seen: number;
  last_seen: number;
  merged_into_id: string | null;
}

interface EntityAliasRow {
  id: string;
  entity_id: string;
  surface_text: string;
  normalized_text: string;
  first_seen: number;
  last_seen: number;
}

/**
 * Maps a raw database row to the domain Entity shape.
 *
 * Centralising this conversion keeps the repository decoupled from the
 * SQLite schema so column renames only need changing in one place.
 */
function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    canonicalName: row.canonical_name,
    kind: row.kind,
    firstSeen: new Date(row.first_seen).toISOString(),
    lastSeen: new Date(row.last_seen).toISOString(),
    mergedIntoId: row.merged_into_id
  };
}

/**
 * Maps a raw database row to the domain EntityAlias shape.
 *
 * Centralising this conversion keeps the repository decoupled from the
 * SQLite schema so column renames only need changing in one place.
 */
function rowToAlias(row: EntityAliasRow): EntityAlias {
  return {
    id: row.id,
    entityId: row.entity_id,
    surfaceText: row.surface_text,
    normalizedText: row.normalized_text,
    firstSeen: new Date(row.first_seen).toISOString(),
    lastSeen: new Date(row.last_seen).toISOString()
  };
}

const KIND_TO_COMPROMISE_TAG = {
  person: 'FirstName',
  place: 'City',
  organization: 'Organization',
  topic: 'ProperNoun',
  product: 'ProperNoun',
  project: 'ProperNoun',
  goal: 'ProperNoun',
  animal: 'ProperNoun'
} as const satisfies Record<EntityKind, string>;

function buildLexicon(knownNames?: { name: string; kind: EntityKind | null }[]): Record<string, string> | undefined {
  if (!knownNames || knownNames.length === 0) return undefined;
  const lexicon: Record<string, string> = {};
  for (const { name, kind } of knownNames) {
    lexicon[name] = kind ? KIND_TO_COMPROMISE_TAG[kind] : 'ProperNoun';
  }
  return lexicon;
}

function stripTrailingPunctuation(name: string): string {
  return name.replace(/[.,;:!?]+$/, '').replace(/'s$/, '');
}

type NlpDoc = ReturnType<typeof nlp>;
// Sub-views (.people(), .places(), .match() results) share the base View type,
// which compromise doesn't export — derive it from match()'s return type.
type NlpView = ReturnType<NlpDoc['match']>;

const outArray = (view: NlpView): string[] => view.out('array') as string[];

const untaggedProperNouns = (doc: NlpDoc): string[] =>
  outArray(doc.match('#ProperNoun').not('#Person').not('#Place').not('#Organization'));

/**
 * Extracts potential entities from memory content using compromise's
 * part-of-speech tagging. Returns entities with inferred kinds
 * (person, place, organization) where possible.
 *
 * Falls back to an empty array if compromise throws.
 */
export function extractEntities(
  content: string,
  opts?: { knownNames?: { name: string; kind: EntityKind | null }[]; logger?: FastifyBaseLogger }
): { name: string; kind: EntityKind | null }[] {
  try {
    const doc = nlp(content, buildLexicon(opts?.knownNames));
    const seen = new Set<string>();
    const results: { name: string; kind: EntityKind | null }[] = [];

    const addResult = (name: string, kind: EntityKind | null) => {
      const cleaned = stripTrailingPunctuation(name);
      const normalized = cleaned.toLowerCase();
      if (!seen.has(normalized) && cleaned.length > 0) {
        seen.add(normalized);
        results.push({ name: cleaned, kind });
      }
    };

    const kindSources = [
      { names: outArray(doc.people()), kind: 'person' },
      { names: outArray(doc.places()), kind: 'place' },
      { names: outArray(doc.organizations()), kind: 'organization' }
    ] as const;

    for (const { names, kind } of kindSources) {
      for (const name of names) addResult(name, kind);
    }

    // Pass 2: remaining proper nouns not caught above
    for (const name of untaggedProperNouns(doc)) addResult(name, null);

    return results;
  } catch (err) {
    opts?.logger?.warn({ err }, 'entity extraction failed');
    return [];
  }
}

/**
 * Bootstraps the canonical user entity and its aliases on a fresh database.
 *
 * The user entity is created once per database lifecycle so that first-person
 * references like "me", "I" and "my" immediately resolve to the correct
 * canonical identity without waiting for the system to learn them organically.
 */
export function seedUserEntity(db: Database): void {
  const entityCount = db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
  if (entityCount.count > 0) return;

  const userName = process.env.USER_NAME || 'Josh';
  const now = Date.now();
  const userEntityId = crypto.randomUUID();

  db.prepare(
    'INSERT INTO entities (id, canonical_name, kind, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(userEntityId, userName, 'person', now, now);

  const aliases = ['me', 'i', 'my', 'myself', userName.toLowerCase(), 'you', 'your', 'yourself'];
  const insertAlias = db.prepare(
    'INSERT INTO entity_aliases (id, entity_id, surface_text, normalized_text, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const alias of aliases) {
    const aliasId = crypto.randomUUID();
    insertAlias.run(aliasId, userEntityId, alias, alias.toLowerCase(), now, now);
  }
}

/**
 * Factory that creates the entity repository backed by SQLite.
 *
 * Encapsulates all entity and alias CRUD so that the memory repository
 * can interact with entities through a narrow interface instead of raw SQL.
 */
export function createEntityRepository(db: Database): EntityRepository {
  let canonicalNamesCache: { name: string; kind: EntityKind | null }[] | null = null;

  return {
    /**
     * Creates a new canonical entity row.
     *
     * Every alias must point to exactly one canonical entity so that
     * entity-aware queries always resolve to a single identity.
     */
    createEntity(canonicalName: string, kind?: EntityKind | null): Entity {
      const id = crypto.randomUUID();
      const now = Date.now();

      db.prepare(
        'INSERT INTO entities (id, canonical_name, kind, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)'
      ).run(id, canonicalName, kind || null, now, now);

      canonicalNamesCache = null;
      return this.findEntityById(id)!;
    },

    /**
     * Creates a new alias that maps a surface text form to a canonical entity.
     *
     * Aliases are how the system tolerates different capitalisations,
     * nicknames and pronouns while still resolving to one entity.
     */
    createAlias(entityId: string, surfaceText: string): EntityAlias {
      const id = crypto.randomUUID();
      const now = Date.now();
      const normalized = surfaceText.toLowerCase().trim();

      db.prepare(
        'INSERT INTO entity_aliases (id, entity_id, surface_text, normalized_text, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(id, entityId, surfaceText, normalized, now, now);

      return this.findByNormalizedText(normalized)!.alias;
    },

    /**
     * Resolves a normalised text string to its alias and parent entity.
     *
     * Returns `null` if the alias does not exist or if its parent entity
     * has been merged into another, ensuring callers never link to a
     * defunct entity.
     */
    findByNormalizedText(normalizedText: string): { entity: Entity; alias: EntityAlias } | null {
      const aliasRow = db
        .prepare(
          `SELECT id, entity_id, surface_text, normalized_text, first_seen, last_seen
           FROM entity_aliases
           WHERE normalized_text = ?`
        )
        .get(normalizedText) as EntityAliasRow | undefined;

      if (!aliasRow) return null;

      const entityRow = db
        .prepare('SELECT * FROM entities WHERE id = ? AND merged_into_id IS NULL')
        .get(aliasRow.entity_id) as EntityRow | undefined;

      if (!entityRow) return null;

      return {
        alias: rowToAlias(aliasRow),
        entity: rowToEntity(entityRow)
      };
    },

    /**
     * Finds any entity by its primary key, including merged (defunct) ones.
     *
     * Exposed so that merge operations can read the loser's canonical name
     * even after it has been marked as merged.
     */
    findEntityById(id: string): Entity | null {
      const row = db
        .prepare('SELECT * FROM entities WHERE id = ?')
        .get(id) as EntityRow | undefined;

      if (!row) return null;
      return rowToEntity(row);
    },

    /**
     * Finds a live (non-merged) entity by its primary key.
     *
     * Filters out merged entities so that the rest of the codebase does
     * not accidentally create new links to a defunct identity.
     */
    findCanonicalEntityById(id: string): Entity | null {
      const row = db
        .prepare('SELECT * FROM entities WHERE id = ? AND merged_into_id IS NULL')
        .get(id) as EntityRow | undefined;

      if (!row) return null;
      return rowToEntity(row);
    },

    /**
     * Returns canonical names and kinds of all live entities.
     *
     * Used by {@link extractEntities} to pass known entities as lexicon
     * hints to compromise so that previously seen names are recognised
     * even in lowercase or unusual forms.
     */
    getCanonicalNames(): { name: string; kind: EntityKind | null }[] {
      if (!canonicalNamesCache) {
        const rows = db
          .prepare('SELECT canonical_name, kind FROM entities WHERE merged_into_id IS NULL')
          .all() as { canonical_name: string; kind: EntityKind | null }[];

        canonicalNamesCache = rows.map(r => ({ name: r.canonical_name, kind: r.kind }));
      }
      return canonicalNamesCache;
    },

    /**
     * Merges two entities into one, redirecting all aliases and memory links.
     *
     * Manual merging is the only way to correct false positives from the
     * heuristic extractor (e.g. "Sarah from work" vs "Sarah my sister").
     */
    mergeEntities(survivorId: string, loserId: string): void {
      const now = Date.now();

      const transaction = db.transaction(() => {
        // Move all aliases from loser to survivor
        db.prepare(
          'UPDATE entity_aliases SET entity_id = ?, last_seen = ? WHERE entity_id = ?'
        ).run(survivorId, now, loserId);

        // Move memory links from loser to survivor (ignore conflicts)
        const memoryIds = db
          .prepare('SELECT memory_id FROM memory_entities WHERE entity_id = ?')
          .all(loserId) as { memory_id: string }[];

        const insertLink = db.prepare(
          'INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)'
        );
        for (const { memory_id } of memoryIds) {
          insertLink.run(memory_id, survivorId);
        }

        // Delete old memory links
        db.prepare('DELETE FROM memory_entities WHERE entity_id = ?').run(loserId);

        // Mark loser as merged
        db.prepare(
          'UPDATE entities SET merged_into_id = ?, last_seen = ? WHERE id = ?'
        ).run(survivorId, now, loserId);

        // Update survivor last_seen
        db.prepare('UPDATE entities SET last_seen = ? WHERE id = ?').run(now, survivorId);

        // Ensure loser's canonical name is an alias of survivor
        const loser = this.findEntityById(loserId);
        if (loser) {
          const existingAlias = db
            .prepare('SELECT id FROM entity_aliases WHERE normalized_text = ?')
            .get(loser.canonicalName.toLowerCase()) as { id: string } | undefined;

          if (!existingAlias) {
            const aliasId = crypto.randomUUID();
            db.prepare(
              'INSERT INTO entity_aliases (id, entity_id, surface_text, normalized_text, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(aliasId, survivorId, loser.canonicalName, loser.canonicalName.toLowerCase(), now, now);
          }
        }
      });

      transaction();
      canonicalNamesCache = null;
    },

    /**
     * Associates a memory with a canonical entity.
     *
     * Uses INSERT OR IGNORE so that duplicate links are silently skipped,
     * keeping the association table free of redundant rows.
     */
    linkMemoryToEntity(memoryId: string, entityId: string): void {
      db.prepare(
        'INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)'
      ).run(memoryId, entityId);
    },

    /**
     * Returns all memory IDs linked to a given entity.
     *
     * Powers the reverse lookup needed by {@link MemoryRepository.findByEntity}.
     */
    findMemoryIdsByEntityId(entityId: string): string[] {
      const rows = db
        .prepare('SELECT memory_id FROM memory_entities WHERE entity_id = ?')
        .all(entityId) as { memory_id: string }[];

      return rows.map(r => r.memory_id);
    }
  };
}
