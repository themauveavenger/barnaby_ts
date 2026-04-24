import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery } from '../../plugins/repository.js';

export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const page = Math.max(1, request.query.page || 1);
    const limit = Math.min(100, Math.max(1, request.query.limit || 20));

    const query = {
      page,
      limit,
      category: request.query.category,
      tags: request.query.tags,
    };

    const { data, total } = request.server.memoryRepository.findAll(query);

    const totalPages = Math.ceil(total / limit);

    const buildUrl = (targetPage: number) => {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', String(limit));
      if (query.category) params.set('category', query.category);
      if (query.tags) params.set('tags', query.tags);
      return '/?' + params.toString();
    };

    return reply.view('memories', {
      memories: data,
      filters: {
        category: query.category || '',
        categoryAppointment: query.category === 'appointment',
        categoryNote: query.category === 'note',
        categoryTodo: query.category === 'todo',
        categoryPurchase: query.category === 'purchase',
        tags: query.tags || '',
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasPrevious: page > 1,
        hasNext: page < totalPages,
        previousUrl: buildUrl(page - 1),
        nextUrl: buildUrl(page + 1),
      },
    });
  });
}
