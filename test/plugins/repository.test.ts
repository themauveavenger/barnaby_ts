import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import repositoryPlugin from '../../src/plugins/repository.js';
import type { Memory } from '../../src/plugins/repository.js';

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
      tags: ['test'],
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
      permanent: true,
    });

    expect(created.permanent).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found!.permanent).toBe(true);
  });

  it('should deduplicate tags', () => {
    const created = app.memoryRepository.create({
      content: 'Dupes',
      category: 'todo',
      tags: ['work', 'WORK', 'work'],
    });

    expect(created.tags).toEqual(['work']);
  });

  it('should delete a memory', () => {
    const created = app.memoryRepository.create({
      content: 'To delete',
      category: 'note',
    });

    const deleted = app.memoryRepository.delete(created.id);
    expect(deleted).toBe(true);

    const found = app.memoryRepository.findById(created.id);
    expect(found).toBeNull();
  });

  it('should find memories for context', () => {
    const permanent = app.memoryRepository.create({
      content: 'I like dark mode',
      category: 'note',
      permanent: true,
    });

    const recent = app.memoryRepository.create({
      content: 'Recent thing',
      category: 'note',
    });

    // Make an old memory by updating created_at directly
    const old = app.memoryRepository.create({
      content: 'Old thing',
      category: 'note',
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
      tags: ['core', 'family'],
    });

    const coreFood = app.memoryRepository.create({
      content: 'I am vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    const nonCore = app.memoryRepository.create({
      content: 'Just a regular note',
      category: 'note',
      tags: ['work'],
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
      tags: ['core'],
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
      category: 'note',
    });

    const old = app.memoryRepository.create({
      content: 'Old note',
      category: 'note',
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
      permanent: true,
    });

    const results = app.memoryRepository.findRecent(7);
    expect(results.map((m: Memory) => m.id)).not.toContain(permanent.id);
  });

  it('should order findByTags results by created_at DESC', () => {
    const older = app.memoryRepository.create({
      content: 'Older memory',
      category: 'note',
      tags: ['chronology'],
    });

    // Small delay to ensure different created_at
    const start = Date.now();
    while (Date.now() - start < 10) { /* busy wait */ }

    const newer = app.memoryRepository.create({
      content: 'Newer memory',
      category: 'note',
      tags: ['chronology'],
    });

    const results = app.memoryRepository.findByTags(['chronology']);
    expect(results.map((m: Memory) => m.id)).toEqual([newer.id, older.id]);
  });

  it('should handle case-insensitive and duplicate tags in findByTags', () => {
    const memory = app.memoryRepository.create({
      content: 'Case test',
      category: 'note',
      tags: ['case'],
    });

    const results = app.memoryRepository.findByTags(['CASE', 'case', 'Case']);
    expect(results.map((m: Memory) => m.id)).toContain(memory.id);
  });

  it('should return complete tag arrays from findByTags', () => {
    const memory = app.memoryRepository.create({
      content: 'I am vegetarian',
      category: 'note',
      permanent: true,
      tags: ['core', 'food'],
    });

    const results = app.memoryRepository.findByTags(['core'], { permanentOnly: true });
    const found = results.find((m: Memory) => m.id === memory.id);
    expect(found).toBeDefined();
    expect(found!.tags).toEqual(expect.arrayContaining(['core', 'food']));
  });
});
