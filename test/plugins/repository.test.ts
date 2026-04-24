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
});
