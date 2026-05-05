import type { FastifyRequest, FastifyReply } from 'fastify';
import { createBriefingService } from '../../services/briefing.js';

export async function briefingTriggerHandler(
  _request: FastifyRequest,
  reply: FastifyReply
) {
  const service = createBriefingService(reply.server);
  await service.sendBriefing({ triggerType: 'manual' });
  return { success: true, message: 'Briefing sent' };
}
