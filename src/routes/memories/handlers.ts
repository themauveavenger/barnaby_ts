import type { FastifyRequest, FastifyReply } from 'fastify';
import { NotFoundError } from '../../plugins/error-handler.js';
import type { CreateMemoryBody, ListMemoriesQuery } from '../../plugins/repository.js';

export async function createMemory(
  request: FastifyRequest<{ Body: CreateMemoryBody }>,
  reply: FastifyReply
) {
  const memory = request.server.memoryRepository.create(request.body);
  reply.code(201);
  return memory;
}

export async function getMemory(
  request: FastifyRequest<{ Params: { id: string } }>
) {
  const memory = request.server.memoryRepository.findById(request.params.id);
  if (!memory) {
    throw new NotFoundError('Memory not found');
  }
  return memory;
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
