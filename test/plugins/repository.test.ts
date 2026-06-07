import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import repositoryPlugin from '../../src/plugins/repository.js';
import type { Memory, ResolvedMemory } from '../../src/plugins/repository.js';

describe('repository plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.register(repositoryPlugin);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should decorate fastify with memoryRepository', () => {
    expect(app.hasDecorator('memoryRepository')).toBe(true);
  });

  it('should create and retrieve a memory', () => {
    const created = app.memoryRepository.create({
      content: 'Test memory',
      category: 'note',
      tags: ['test']
    });

    expect(created.content).toBe('Test memory');
    expect(created.category).toBe('note');
    expect(created.tags).toEqual(['test']);
    expect(created.permanent).toBe(false);
    expect(created.id).toBeDefined();
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601

    const found = app.memoryRepository.findById(created.id);
    expect(found).not.toBeNull();
    expect(found!.content).toBe('Test memory');
    expect(found!.permanent).toBe(false);
  });

  it('should create a permanent memory', () => {
    const created = app.memoryRepository.create({
      content: 'Permanent memory',
      category: 'note',
      permanent: true
    });

    expect(created.permanent).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found!.permanent).toBe(true);
  });

  it('should deduplicate tags', () => {
    const created = app.memoryRepository.create({
      content: 'Dupes',
      category: 'todo',
      tags: ['work', 'WORK', 'work']
    });

    expect(created.tags).toEqual(['work']);
  });

  it('should delete a memory', () => {
    const created = app.memoryRepository.create({
      content: 'To delete',
      category: 'note'
    });

    const deleted = app.memoryRepository.delete(created.id);
    expect(deleted).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found).toBeNull();
  });

  describe('update', () => {
    it('should update content only', () => {
      const created = app.memoryRepository.create({
        content: 'Original content',
        category: 'note',
        tags: ['keep-me']
      });

      const updated = app.memoryRepository.update(created.id, { content: 'Updated content' });
      expect(updated.content).toBe('Updated content');
      expect(updated.tags).toEqual(['keep-me']);
      expect(updated.id).toBe(created.id);
    });

    it('should update tags only', () => {
      const created = app.memoryRepository.create({
        content: 'Keep this content',
        category: 'note'
      });

      const updated = app.memoryRepository.update(created.id, { tags: ['new-tag'] });
      expect(updated.content).toBe('Keep this content');
      expect(updated.tags).toEqual(['new-tag']);
    });

    it('should update both content and tags', () => {
      const created = app.memoryRepository.create({
        content: 'Original',
        category: 'note',
        tags: ['old']
      });

      const updated = app.memoryRepository.update(created.id, { content: 'Updated', tags: ['new'] });
      expect(updated.content).toBe('Updated');
      expect(updated.tags).toEqual(['new']);
    });

    it('should replace tags entirely, not merge', () => {
      const created = app.memoryRepository.create({
        content: 'Tag replace',
        category: 'note',
        tags: ['old1', 'old2']
      });

      const updated = app.memoryRepository.update(created.id, { tags: ['replacement'] });
      expect(updated.tags).toEqual(['replacement']);
    });

    it('should normalize and deduplicate tags on update', () => {
      const created = app.memoryRepository.create({
        content: 'Dedup update',
        category: 'note'
      });

      const updated = app.memoryRepository.update(created.id, { tags: ['Foo', 'foo', 'FOO'] });
      expect(updated.tags).toEqual(['foo']);
    });

    it('should trim content whitespace on update', () => {
      const created = app.memoryRepository.create({
        content: 'Original',
        category: 'note'
      });

      const updated = app.memoryRepository.update(created.id, { content: '  Trimmed  ' });
      expect(updated.content).toBe('Trimmed');
    });

    it('should clear tags with empty array', () => {
      const created = app.memoryRepository.create({
        content: 'Clear my tags',
        category: 'note',
        tags: ['remove-me']
      });

      const updated = app.memoryRepository.update(created.id, { tags: [] });
      expect(updated.tags).toEqual([]);
    });

    it('should throw for nonexistent memory', () => {
      expect(() => {
        app.memoryRepository.update('00000000-0000-0000-0000-000000000000', { content: 'Nope' });
      }).toThrow('Memory not found');
    });
  });

  it('should find memories for context', () => {
    const permanent = app.memoryRepository.create({
      content: 'I like dark mode',
      category: 'note',
      permanent: true
    });

    const recent = app.memoryRepository.create({
      content: 'Recent thing',
      category: 'note'
    });

    // Make an old memory by updating created_at directly
    const old = app.memoryRepository.create({
      content: 'Old thing',
      category: 'note'
    });
    app.db
      .prepare('UPDATE memories SET created_at = ? WHERE id = ?')
      .run(Date.now() - 31 * 24 * 60 * 60 * 1000, old.id);

    const context = app.memoryRepository.findForContext();

    expect(context.permanent.map((m: Memory) => m.id)).toContain(permanent.id);
    expect(context.recent.map((m: Memory) => m.id)).toContain(recent.id);
    expect(context.recent.map((m: Memory) => m.id)).not.toContain(old.id);
    expect(context.permanent.map((m: Memory) => m.id)).not.toContain(recent.id);
  });

  it('should find memories by tags with AND logic', () => {
    const coreFamily = app.memoryRepository.create({
      content: 'My partner is Alex',
      category: 'note',
      permanent: true,
      tags: ['core', 'family']
    });

    const coreFood = app.memoryRepository.create({
      content: 'I am vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food']
    });

    const nonCore = app.memoryRepository.create({
      content: 'Just a regular note',
      category: 'note',
      tags: ['work']
    });

    const results = app.memoryRepository.findByTags(['core', 'family'], { permanentOnly: true });

    expect(results.map((m: Memory) => m.id)).toContain(coreFamily.id);
    expect(results.map((m: Memory) => m.id)).not.toContain(coreFood.id);
    expect(results.map((m: Memory) => m.id)).not.toContain(nonCore.id);
  });

  it('should return empty array when no memories match tags', () => {
    const results = app.memoryRepository.findByTags(['nonexistent'], { permanentOnly: true });
    expect(results).toEqual([]);
  });

  it('should findByTags without permanentOnly filter', () => {
    const nonPermanent = app.memoryRepository.create({
      content: 'Temporary core memory',
      category: 'note',
      permanent: false,
      tags: ['core']
    });

    const withPermanent = app.memoryRepository.findByTags(['core'], { permanentOnly: true });
    const withoutPermanent = app.memoryRepository.findByTags(['core']);

    expect(withPermanent.map((m: Memory) => m.id)).not.toContain(nonPermanent.id);
    expect(withoutPermanent.map((m: Memory) => m.id)).toContain(nonPermanent.id);
  });

  it('should return empty array for empty tags array', () => {
    const results = app.memoryRepository.findByTags([]);
    expect(results).toEqual([]);
  });

  it('should find recent memories within given days', () => {
    const recent = app.memoryRepository.create({
      content: 'Recent note',
      category: 'note'
    });

    const old = app.memoryRepository.create({
      content: 'Old note',
      category: 'note'
    });
    app.db
      .prepare('UPDATE memories SET created_at = ? WHERE id = ?')
      .run(Date.now() - 10 * 24 * 60 * 60 * 1000, old.id);

    const results = app.memoryRepository.findRecent(7);
    expect(results.map((m: Memory) => m.id)).toContain(recent.id);
    expect(results.map((m: Memory) => m.id)).not.toContain(old.id);
  });

  it('should not include permanent memories in findRecent', () => {
    const permanent = app.memoryRepository.create({
      content: 'Permanent note',
      category: 'note',
      permanent: true
    });

    const results = app.memoryRepository.findRecent(7);
    expect(results.map((m: Memory) => m.id)).not.toContain(permanent.id);
  });

  it('should order findByTags results by created_at DESC', () => {
    const older = app.memoryRepository.create({
      content: 'Older memory',
      category: 'note',
      tags: ['chronology']
    });

    // Small delay to ensure different created_at
    const start = Date.now();
    while (Date.now() - start < 10) { /* busy wait */ }

    const newer = app.memoryRepository.create({
      content: 'Newer memory',
      category: 'note',
      tags: ['chronology']
    });

    const results = app.memoryRepository.findByTags(['chronology']);
    expect(results.map((m: Memory) => m.id)).toEqual([newer.id, older.id]);
  });

  it('should handle case-insensitive and duplicate tags in findByTags', () => {
    const memory = app.memoryRepository.create({
      content: 'Case test',
      category: 'note',
      tags: ['case']
    });

    const results = app.memoryRepository.findByTags(['CASE', 'case', 'Case']);
    expect(results.map((m: Memory) => m.id)).toContain(memory.id);
  });

  it('should return complete tag arrays from findByTags', () => {
    const memory = app.memoryRepository.create({
      content: 'I am vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food']
    });

    const results = app.memoryRepository.findByTags(['core'], { permanentOnly: true });
    const found = results.find((m: Memory) => m.id === memory.id);
    expect(found).toBeDefined();
    expect(found!.tags).toEqual(expect.arrayContaining(['core', 'food']));
  });

  describe('memory actions', () => {
    it('should create a completed action on a memory', () => {
      const memory = app.memoryRepository.create({
        content: 'Buy milk',
        category: 'todo'
      });

      const action = app.memoryActionRepository.create(memory.id, 'completed');
      expect(action.id).toBeDefined();
      expect(action.memoryId).toBe(memory.id);
      expect(action.action).toBe('completed');
      expect(action.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should create a dismissed action on a memory', () => {
      const memory = app.memoryRepository.create({
        content: 'Call dentist',
        category: 'todo'
      });

      const action = app.memoryActionRepository.create(memory.id, 'dismissed');
      expect(action.action).toBe('dismissed');
    });

    it('should throw when creating an action for a nonexistent memory', () => {
      expect(() => {
        app.memoryActionRepository.create('00000000-0000-0000-0000-000000000000', 'completed');
      }).toThrow('Memory not found');
    });

    it('should find actions by memory IDs', () => {
      const memory1 = app.memoryRepository.create({ content: 'Task 1', category: 'todo' });
      const memory2 = app.memoryRepository.create({ content: 'Task 2', category: 'todo' });

      app.memoryActionRepository.create(memory1.id, 'completed');
      app.memoryActionRepository.create(memory2.id, 'dismissed');

      const map = app.memoryActionRepository.findByMemoryIds([memory1.id, memory2.id]);
      expect(map.get(memory1.id)).toHaveLength(1);
      expect(map.get(memory1.id)![0].action).toBe('completed');
      expect(map.get(memory2.id)).toHaveLength(1);
      expect(map.get(memory2.id)![0].action).toBe('dismissed');
    });

    it('should return empty map for empty array', () => {
      const map = app.memoryActionRepository.findByMemoryIds([]);
      expect(map.size).toBe(0);
    });

    it('should return empty array for memory with no actions', () => {
      const memory = app.memoryRepository.create({ content: 'No action', category: 'note' });
      const map = app.memoryActionRepository.findByMemoryIds([memory.id]);
      expect(map.has(memory.id)).toBe(false);
    });

    it('should allow both completed and dismissed on the same memory', () => {
      const memory = app.memoryRepository.create({ content: 'Task both', category: 'todo' });

      app.memoryActionRepository.create(memory.id, 'completed');
      app.memoryActionRepository.create(memory.id, 'dismissed');

      const map = app.memoryActionRepository.findByMemoryIds([memory.id]);
      expect(map.get(memory.id)).toHaveLength(2);
    });

    it('should enforce unique constraint on memory_id + action', () => {
      const memory = app.memoryRepository.create({ content: 'Duplicate test', category: 'todo' });

      app.memoryActionRepository.create(memory.id, 'completed');
      expect(() => {
        app.memoryActionRepository.create(memory.id, 'completed');
      }).toThrow();
    });

    it('should delete an action', () => {
      const memory = app.memoryRepository.create({ content: 'Undo test', category: 'todo' });
      const action = app.memoryActionRepository.create(memory.id, 'completed');

      const deleted = app.memoryActionRepository.delete(action.id);
      expect(deleted).toBe(true);

      const map = app.memoryActionRepository.findByMemoryIds([memory.id]);
      expect(map.has(memory.id)).toBe(false);
    });

    it('should return false when deleting nonexistent action', () => {
      const deleted = app.memoryActionRepository.delete('00000000-0000-0000-0000-000000000000');
      expect(deleted).toBe(false);
    });

    it('should cascade delete actions when memory is deleted', () => {
      const memory = app.memoryRepository.create({ content: 'Cascade test', category: 'todo' });
      app.memoryActionRepository.create(memory.id, 'completed');

      app.memoryRepository.delete(memory.id);

      // Verify the action is also gone
      const map = app.memoryActionRepository.findByMemoryIds([memory.id]);
      expect(map.has(memory.id)).toBe(false);
    });
  });

  describe('findForContext with actions', () => {
    it('should exclude memories with actions from findForContext', () => {
      const active = app.memoryRepository.create({
        content: 'Active todo',
        category: 'todo'
      });

      const completed = app.memoryRepository.create({
        content: 'Completed todo',
        category: 'todo'
      });

      app.memoryActionRepository.create(completed.id, 'completed');

      const context = app.memoryRepository.findForContext();
      expect(context.recent.map((m: Memory) => m.id)).toContain(active.id);
      expect(context.recent.map((m: Memory) => m.id)).not.toContain(completed.id);
    });

    it('should exclude dismissed memories from findForContext recent', () => {
      const active = app.memoryRepository.create({
        content: 'Active task',
        category: 'todo'
      });

      const dismissed = app.memoryRepository.create({
        content: 'Dismissed task',
        category: 'todo'
      });

      app.memoryActionRepository.create(dismissed.id, 'dismissed');

      const context = app.memoryRepository.findForContext();
      expect(context.recent.map((m: Memory) => m.id)).toContain(active.id);
      expect(context.recent.map((m: Memory) => m.id)).not.toContain(dismissed.id);
    });

    it('should still include permanent memories regardless of actions', () => {
      const permanent = app.memoryRepository.create({
        content: 'Permanent note',
        category: 'note',
        permanent: true
      });

      app.memoryActionRepository.create(permanent.id, 'completed');

      const context = app.memoryRepository.findForContext();
      expect(context.permanent.map((m: Memory) => m.id)).toContain(permanent.id);
    });
  });

  describe('findResolvedRecent', () => {
    it('should return memories with completed actions', () => {
      const memory = app.memoryRepository.create({
        content: 'Buy groceries',
        category: 'todo'
      });

      app.memoryActionRepository.create(memory.id, 'completed');

      const resolved = app.memoryRepository.findResolvedRecent(7);
      const found = resolved.find((m: ResolvedMemory) => m.id === memory.id);
      expect(found).toBeDefined();
      expect(found!.content).toBe('Buy groceries');
      expect(found!.action).toBe('completed');
      expect(found!.actionCreatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should return memories with dismissed actions', () => {
      const memory = app.memoryRepository.create({
        content: 'Call dentist dismissed action test',
        category: 'todo'
      });

      app.memoryActionRepository.create(memory.id, 'dismissed');

      const resolved = app.memoryRepository.findResolvedRecent(7);
      const found = resolved.find((m: ResolvedMemory) => m.id === memory.id);
      expect(found).toBeDefined();
      expect(found!.action).toBe('dismissed');
    });

    it('should not return memories without actions', () => {
      const memory = app.memoryRepository.create({
        content: 'Active todo for resolved test',
        category: 'todo'
      });

      const resolved = app.memoryRepository.findResolvedRecent(7);
      const found = resolved.find((m: ResolvedMemory) => m.id === memory.id);
      expect(found).toBeUndefined();
    });

    it('should not return old resolved memories outside the time window', () => {
      const memory = app.memoryRepository.create({
        content: 'Old completed outside window',
        category: 'todo'
      });

      app.memoryActionRepository.create(memory.id, 'completed');

      // Backdate the memory creation time
      app.db
        .prepare('UPDATE memories SET created_at = ? WHERE id = ?')
        .run(Date.now() - 31 * 24 * 60 * 60 * 1000, memory.id);

      const resolved = app.memoryRepository.findResolvedRecent(7);
      const found = resolved.find((m: ResolvedMemory) => m.id === memory.id);
      expect(found).toBeUndefined();
    });
  });

  describe('findRecent with actions', () => {
    it('should exclude completed memories from findRecent', () => {
      const active = app.memoryRepository.create({
        content: 'Active note',
        category: 'note'
      });

      const completed = app.memoryRepository.create({
        content: 'Completed todo',
        category: 'todo'
      });

      app.memoryActionRepository.create(completed.id, 'completed');

      const recent = app.memoryRepository.findRecent(7);
      expect(recent.map((m: Memory) => m.id)).toContain(active.id);
      expect(recent.map((m: Memory) => m.id)).not.toContain(completed.id);
    });
  });

  describe('entity normalization', () => {
    it('should seed user entity on database initialization', () => {
      const userEntity = app.db
        .prepare('SELECT * FROM entities WHERE canonical_name = ?')
        .get('Josh') as { id: string; canonical_name: string } | undefined;

      expect(userEntity).toBeDefined();

      const aliases = app.db
        .prepare('SELECT normalized_text FROM entity_aliases WHERE entity_id = ?')
        .all(userEntity!.id) as { normalized_text: string }[];

      const aliasTexts = aliases.map(a => a.normalized_text);
      expect(aliasTexts).toContain('josh');
      expect(aliasTexts).toContain('me');
      expect(aliasTexts).toContain('i');
      expect(aliasTexts).toContain('my');
      expect(aliasTexts).toContain('myself');
      expect(aliasTexts).toContain('you');
      expect(aliasTexts).toContain('your');
      expect(aliasTexts).toContain('yourself');
    });

    it('should extract entities and create rows when creating a memory', () => {
      const memory = app.memoryRepository.create({
        content: 'Sarah likes Thai food',
        category: 'note'
      });

      // 'Sarah' should be extracted as an entity; 'Thai' might be too depending on denylist
      const entityRows = app.db
        .prepare('SELECT canonical_name FROM entities WHERE canonical_name = ?')
        .all('Sarah') as { canonical_name: string }[];

      expect(entityRows.length).toBeGreaterThan(0);

      const aliasRow = app.db
        .prepare('SELECT * FROM entity_aliases WHERE normalized_text = ?')
        .get('sarah') as { entity_id: string } | undefined;

      expect(aliasRow).toBeDefined();

      const linkRow = app.db
        .prepare('SELECT * FROM memory_entities WHERE memory_id = ? AND entity_id = ?')
        .get(memory.id, aliasRow!.entity_id) as { memory_id: string } | undefined;

      expect(linkRow).toBeDefined();
    });

    it('should link existing entity alias to a new memory', () => {
      const first = app.memoryRepository.create({
        content: 'Sarah likes Thai food',
        category: 'note'
      });

      const second = app.memoryRepository.create({
        content: 'My friend Sarah is visiting',
        category: 'note'
      });

      const aliasRow = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('sarah') as { entity_id: string } | undefined;

      expect(aliasRow).toBeDefined();

      const links = app.db
        .prepare('SELECT memory_id FROM memory_entities WHERE entity_id = ?')
        .all(aliasRow!.entity_id) as { memory_id: string }[];

      const linkedMemoryIds = links.map(l => l.memory_id);
      expect(linkedMemoryIds).toContain(first.id);
      expect(linkedMemoryIds).toContain(second.id);
    });

    it('should find memory by user entity even when content says You', () => {
      const memory = app.memoryRepository.create({
        content: 'You prefer dark mode',
        category: 'note',
        permanent: true
      });

      const results = app.memoryRepository.findByEntity('josh');
      expect(results.map((m: Memory) => m.id)).toContain(memory.id);
    });

    it('should find memory by entity name through findAll with entity query', () => {
      const memory = app.memoryRepository.create({
        content: 'Sarah likes Thai food',
        category: 'note'
      });

      const { data } = app.memoryRepository.findAll({ entity: 'sarah' });
      expect(data.map((m: Memory) => m.id)).toContain(memory.id);
    });

    it('should return empty results for unknown entity in findAll', () => {
      const { data, total } = app.memoryRepository.findAll({ entity: 'nonexistent-person-xyz' });
      expect(data).toEqual([]);
      expect(total).toBe(0);
    });

    it('should merge entities and redirect aliases and memory links', () => {
      // Create a memory linking to "Margaret"
      const memory1 = app.memoryRepository.create({
        content: 'Margaret is coming over',
        category: 'note'
      });

      // Create a memory linking to "Mum"
      const memory2 = app.memoryRepository.create({
        content: 'Mum called today',
        category: 'note'
      });

      // Find the entity ids
      const margaretAlias = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('margaret') as { entity_id: string };

      const mumAlias = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('mum') as { entity_id: string };

      expect(margaretAlias.entity_id).not.toBe(mumAlias.entity_id);

      // Merge Mum into Margaret
      app.entityRepository.mergeEntities(margaretAlias.entity_id, mumAlias.entity_id);

      // Verify Mum alias now points to Margaret
      const mergedAlias = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('mum') as { entity_id: string };

      expect(mergedAlias.entity_id).toBe(margaretAlias.entity_id);

      // Verify both memories link to Margaret
      const links = app.db
        .prepare('SELECT memory_id FROM memory_entities WHERE entity_id = ?')
        .all(margaretAlias.entity_id) as { memory_id: string }[];

      const linkedIds = links.map(l => l.memory_id);
      expect(linkedIds).toContain(memory1.id);
      expect(linkedIds).toContain(memory2.id);

      // Verify loser entity is marked as merged
      const loser = app.db
        .prepare('SELECT merged_into_id FROM entities WHERE id = ?')
        .get(mumAlias.entity_id) as { merged_into_id: string };

      expect(loser.merged_into_id).toBe(margaretAlias.entity_id);
    });

    it('should add loser\'s canonical name as alias of survivor during merge', () => {
      app.memoryRepository.create({
        content: 'Margaret is coming over',
        category: 'note'
      });

      app.memoryRepository.create({
        content: 'Mum called today',
        category: 'note'
      });

      const margaretAlias = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('margaret') as { entity_id: string };

      const mumAlias = app.db
        .prepare('SELECT entity_id FROM entity_aliases WHERE normalized_text = ?')
        .get('mum') as { entity_id: string };

      app.entityRepository.mergeEntities(margaretAlias.entity_id, mumAlias.entity_id);

      // Check that "Mum" (canonical name of loser) is now an alias of survivor
      const survivorAliases = app.db
        .prepare('SELECT surface_text FROM entity_aliases WHERE entity_id = ?')
        .all(margaretAlias.entity_id) as { surface_text: string }[];

      const surfaceTexts = survivorAliases.map(a => a.surface_text);
      expect(surfaceTexts).toContain('Mum');
    });
  });
});
