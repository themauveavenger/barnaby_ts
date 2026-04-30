import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery, CreateMemoryBody } from '../../plugins/repository.js';
import { listMemoriesSchema, createMemorySchema } from '../memories/schemas.js';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = date.getDate();
  const year = isToday ? '' : ` ${date.getFullYear()}`;

  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${weekday} ${month} ${day}${year} ${hours}:${minutes}${ampm}`;
}

async function buildViewModel(
  fastify: FastifyInstance,
  query: ListMemoriesQuery,
  error?: string,
  form?: Record<string, unknown>
) {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const repoQuery = {
    page,
    limit,
    category: query.category,
    tags: query.tags,
  };

  const { data, total } = fastify.memoryRepository.findAll(repoQuery);

  const totalPages = Math.ceil(total / limit);

  const buildUrl = (targetPage: number) => {
    const params = new URLSearchParams();
    params.set('page', String(targetPage));
    params.set('limit', String(limit));
    if (repoQuery.category) params.set('category', repoQuery.category);
    if (repoQuery.tags) params.set('tags', repoQuery.tags);
    return '/?' + params.toString();
  };

  const memories = data.map((memory) => ({
    ...memory,
    formattedDate: formatDate(memory.createdAt),
  }));

  return {
    memories,
    filters: {
      category: repoQuery.category || '',
      categoryAppointment: repoQuery.category === 'appointment',
      categoryNote: repoQuery.category === 'note',
      categoryTodo: repoQuery.category === 'todo',
      categoryPurchase: repoQuery.category === 'purchase',
      tags: repoQuery.tags || '',
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
    error,
    form: form
      ? {
          content: form.content,
          category: form.category,
          permanent: form.permanent,
          tags: form.tags,
          categoryAppointment: form.category === 'appointment',
          categoryNote: form.category === 'note',
          categoryTodo: form.category === 'todo',
          categoryPurchase: form.category === 'purchase',
        }
      : undefined,
  };
}

export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, async function (_request: FastifyRequest, payload: string) {
    const parsed = new URLSearchParams(payload);
    const result: Record<string, unknown> = {};
    for (const [key, value] of parsed) {
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) {
          (result[key] as unknown[]).push(value);
        } else {
          result[key] = [result[key], value];
        }
      } else {
        result[key] = value;
      }
    }
    return result;
  });

  fastify.get('/', { schema: listMemoriesSchema }, async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const viewModel = await buildViewModel(fastify, request.query);
    return reply.view('memories', viewModel);
  });

  fastify.post('/', {
    schema: createMemorySchema,
    attachValidation: true,
    preValidation: async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      if (typeof body.permanent === 'string') {
        body.permanent = body.permanent === 'on';
      }
      if (typeof body.tags === 'string') {
        body.tags = (body.tags as string)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    },
  }, async (request: FastifyRequest<{ Body: CreateMemoryBody }>, reply: FastifyReply) => {
    if (request.validationError) {
      const body = request.body as Record<string, unknown>;
      const viewModel = await buildViewModel(
        fastify,
        {},
        request.validationError.message,
        {
          content: body.content,
          category: body.category,
          permanent: body.permanent === true,
          tags: body.tags,
        }
      );
      return reply.view('memories', viewModel);
    }

    request.server.memoryRepository.create(request.body);
    return reply.redirect('/');
  });
}
