import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import databasePlugin from '../../src/plugins/database.js';
import { createBriefingRepository } from '../../src/plugins/briefing-repository.js';

describe('briefing repository', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;
  let repo: ReturnType<typeof createBriefingRepository>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(databasePlugin);
    await app.ready();
    repo = createBriefingRepository(app.db);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    app.db.exec('DELETE FROM briefings');
  });

  it('should create a briefing and return it', () => {
    const briefing = repo.create({
      content: 'Test briefing content',
      triggerType: 'scheduled',
    });

    expect(briefing.id).toBeDefined();
    expect(briefing.content).toBe('Test briefing content');
    expect(briefing.triggerType).toBe('scheduled');
    expect(briefing.triggeredAt).toBeDefined();
  });

  it('should find the latest briefing', () => {
    repo.create({ content: 'First', triggerType: 'scheduled' });
    repo.create({ content: 'Second', triggerType: 'manual' });

    const latest = repo.findLatest();
    expect(latest).not.toBeNull();
    expect(latest!.content).toBe('Second');
    expect(latest!.triggerType).toBe('manual');
  });

  it('should return null when no briefings exist', () => {
    const latest = repo.findLatest();
    expect(latest).toBeNull();
  });

  it('should find all briefings ordered by triggered_at DESC', () => {
    repo.create({ content: 'First', triggerType: 'scheduled' });
    repo.create({ content: 'Second', triggerType: 'manual' });

    const all = repo.findAll();
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe('Second');
    expect(all[1].content).toBe('First');
  });
});
