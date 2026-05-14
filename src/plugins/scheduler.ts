import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import fastifySchedule from '@fastify/schedule';
import type { ToadScheduler } from 'toad-scheduler';

export default fp(async function schedulerPlugin(fastify: FastifyInstance) {
  const briefingCron = process.env.BRIEFING_CRON;
  if (!briefingCron) {
    throw new Error('BRIEFING_CRON environment variable is required');
  }

  await fastify.register(fastifySchedule);

  const scheduler = fastify.scheduler as ToadScheduler;

  fastify.addHook('onClose', async () => {
    scheduler.stop();
  });
});
