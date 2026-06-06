import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import { createPersonalityRepository } from '../../src/plugins/repositories/personality.js';

describe('personality repository', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let repo: ReturnType<typeof createPersonalityRepository>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.ready();
    repo = createPersonalityRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should find the default personality', () => {
    const defaultPersonality = repo.findDefault();
    expect(defaultPersonality).not.toBeNull();
    expect(defaultPersonality!.id).toBe('yarnaby');
  });

  it('should find a personality by id', () => {
    const personality = repo.findById('barnaby');
    expect(personality).not.toBeNull();
    expect(personality!.name).toBe('Barnaby');
  });

  it('should return null for unknown id', () => {
    const personality = repo.findById('nonexistent');
    expect(personality).toBeNull();
  });

  it('should find all personalities', () => {
    const personalities = repo.findAll();
    expect(personalities).toHaveLength(2);
    const ids = personalities.map(p => p.id);
    expect(ids).toContain('barnaby');
    expect(ids).toContain('yarnaby');
  });
});
