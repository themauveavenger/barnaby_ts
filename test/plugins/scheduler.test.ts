import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import schedulerPlugin from '../../src/plugins/scheduler.js';

describe('scheduler plugin', () => {
  let app: Awaited<ReturnType<typeof Fastify>>;

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should decorate fastify with scheduler', async () => {
    process.env.BRIEFING_CRON = '0 8 * * *';
    app = Fastify({ logger: false });
    await app.register(schedulerPlugin);
    await app.ready();

    expect(app.hasDecorator('scheduler')).toBe(true);
    expect(app.scheduler).toBeDefined();

    await app.close();
    delete process.env.BRIEFING_CRON;
  });

  it('should throw if BRIEFING_CRON is missing', async () => {
    delete process.env.BRIEFING_CRON;
    app = Fastify({ logger: false });

    await expect(app.register(schedulerPlugin)).rejects.toThrow(/BRIEFING_CRON/i);
  });

  it('should call scheduler.stop() on close', async () => {
    process.env.BRIEFING_CRON = '0 8 * * *';
    app = Fastify({ logger: false });
    await app.register(schedulerPlugin);
    await app.ready();

    const scheduler = app.scheduler as { stop: () => void };
    const stopSpy = vi.spyOn(scheduler, 'stop');

    await app.close();

    expect(stopSpy).toHaveBeenCalled();
  });
});
