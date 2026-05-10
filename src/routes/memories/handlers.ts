import type { FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError, BadRequestError } from '../../plugins/error-handler.js';
import type { CreateMemoryBody, UpdateMemoryBody, ListMemoriesQuery, MemoryActionType } from '../../plugins/repository.js';

export async function createMemory(
  request: FastifyRequest<{ Body: CreateMemoryBody }>,
  reply: FastifyReply
) {
  const memory = request.server.memoryRepository.create(request.body);
  reply.code(201);
  return memory;
}

export async function updateMemory(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateMemoryBody }>,
  reply: FastifyReply
) {
  const { content, tags } = request.body;
  if (content === undefined && tags === undefined) {
    throw new BadRequestError('At least one field (content or tags) must be provided');
  }

  try {
    const memory = request.server.memoryRepository.update(request.params.id, request.body);
    return memory;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Memory not found')) {
      throw new NotFoundError('Memory not found');
    }
    throw err;
  }
}

export async function listMemories(
  request: FastifyRequest<{ Querystring: ListMemoriesQuery }>
) {
  const { data, total } = request.server.memoryRepository.findAll(request.query);
  const page = request.query.page || 1;
  const limit = request.query.limit || 20;
  return {
    data,
    pagination: { page, limit, total },
  };
}

export async function deleteMemory(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const deleted = request.server.memoryRepository.delete(request.params.id);
  if (!deleted) {
    throw new NotFoundError('Memory not found');
  }
  reply.code(204);
}

export async function createAction(
  request: FastifyRequest<{ Params: { id: string }; Body: { action: MemoryActionType } }>,
  reply: FastifyReply
) {
  const memory = request.server.memoryRepository.findById(request.params.id);
  if (!memory) {
    throw new NotFoundError('Memory not found');
  }

  const action = request.server.memoryActionRepository.create(request.params.id, request.body.action);
  reply.code(201);
  return action;
}

export async function deleteAction(
  request: FastifyRequest<{ Params: { id: string; actionId: string } }>,
  reply: FastifyReply
) {
  const deleted = request.server.memoryActionRepository.delete(request.params.actionId);
  if (!deleted) {
    throw new NotFoundError('Action not found');
  }
  reply.code(204);
}

export async function getContext(request: FastifyRequest) {
  const context = request.server.memoryRepository.findForContext();
  return context;
}
