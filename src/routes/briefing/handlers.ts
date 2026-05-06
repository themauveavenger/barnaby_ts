import type { FastifyRequest, FastifyReply } from 'fastify';
import { createBriefingService } from '../../services/briefing.js';
import { NotFoundError } from '../../plugins/error-handler.js';
import type { ListBriefingsQuery } from '../../plugins/briefing-repository.js';

const BRIEFING_TIMEOUT_MS = process.env.BRIEFING_TIMEOUT_MS
  ? Number(process.env.BRIEFING_TIMEOUT_MS)
  : 60000;

export async function briefingTriggerHandler(
  _request: FastifyRequest,
  reply: FastifyReply
) {
  const service = createBriefingService(reply.server);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BRIEFING_TIMEOUT_MS);

  try {
    await service.sendBriefing({ triggerType: 'manual' }, controller.signal);
    clearTimeout(timeoutId);
    return { success: true, message: 'Briefing sent' };
  } catch (error) {
    clearTimeout(timeoutId);
    if (controller.signal.aborted) {
      reply.code(504);
      return { success: false, message: `Briefing generation timed out after ${BRIEFING_TIMEOUT_MS / 1000} seconds` };
    }
    throw error;
  }
}

export async function listBriefings(
  request: FastifyRequest<{ Querystring: ListBriefingsQuery }>
) {
  const { data, total } = request.server.briefingRepository.findAllPaginated(request.query);
  const page = request.query.page ?? 1;
  const limit = request.query.limit ?? 20;
  return {
    data,
    pagination: { page, limit, total },
  };
}

export async function deleteBriefing(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const deleted = request.server.briefingRepository.delete(request.params.id);
  if (!deleted) {
    throw new NotFoundError('Briefing not found');
  }
  reply.code(204);
}