import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery, CreateMemoryBody, MemoryActionType } from '../../plugins/repository.js';
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

type MemoryFormData = {
  content?: unknown;
  category?: unknown;
  permanent?: unknown;
  tags?: unknown;
};

type MemoryViewModel = {
  id: string;
  content: string;
  category: string;
  tags: string[];
  permanent: boolean;
  createdAt: string;
  formattedDate: string;
  actions: Array<{ id: string; action: string; formattedDate: string }>;
};

type MemoriesViewModel = {
  memories: MemoryViewModel[];
  filters: {
    category: string;
    categoryAppointment: boolean;
    categoryNote: boolean;
    categoryTodo: boolean;
    categoryPurchase: boolean;
    tags: string;
  };
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
    previousUrl: string;
    nextUrl: string;
  };
  error?: string;
  form?: {
    content?: unknown;
    category?: unknown;
    permanent?: boolean;
    tags?: unknown;
    categoryAppointment: boolean;
    categoryNote: boolean;
    categoryTodo: boolean;
    categoryPurchase: boolean;
  };
};

function buildViewModel(
  fastify: FastifyInstance,
  query: ListMemoriesQuery,
  error?: string,
  form?: MemoryFormData
): MemoriesViewModel {
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

  const memoryIds = data.map((m) => m.id);
  const actionsMap = fastify.memoryActionRepository.findByMemoryIds(memoryIds);

  const memories = data.map((memory) => ({
    ...memory,
    formattedDate: formatDate(memory.createdAt),
    actions: (actionsMap.get(memory.id) || []).map((a) => ({
      id: a.id,
      action: a.action,
      formattedDate: formatDate(a.createdAt),
    })),
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
          permanent: form.permanent === true,
          tags: Array.isArray(form.tags) ? form.tags.join(', ') : form.tags,
          categoryAppointment: form.category === 'appointment',
          categoryNote: form.category === 'note',
          categoryTodo: form.category === 'todo',
          categoryPurchase: form.category === 'purchase',
        }
      : undefined,
  };
}

export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const viewModel = buildViewModel(fastify, request.query);
    return reply.view('memories', viewModel);
  });

  fastify.post('/', {
    schema: createMemorySchema,
    attachValidation: true,
    preValidation: async (request, reply) => {
      const body = request.body as MemoryFormData;
      if (typeof body.permanent === 'string') {
        body.permanent = body.permanent === 'on';
      }
      if (typeof body.tags === 'string') {
        body.tags = body.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
      }
    },
  }, async (request: FastifyRequest<{ Body: CreateMemoryBody }>, reply: FastifyReply) => {
    if (request.validationError) {
      const body = request.body as MemoryFormData;
      const viewModel = buildViewModel(
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

  // Action form submission (complete/dismiss a memory)
  type ActionFormData = {
    memoryId?: unknown;
    actionType?: unknown;
  };

  fastify.post('/actions', async (request: FastifyRequest<{ Body: ActionFormData }>, reply: FastifyReply) => {
    const { memoryId, actionType } = request.body as ActionFormData;
    if (typeof memoryId === 'string' && typeof actionType === 'string') {
      const memory = fastify.memoryRepository.findById(memoryId);
      if (memory) {
        fastify.memoryActionRepository.create(memoryId, actionType as MemoryActionType);
      }
    }
    return reply.redirect('/');
  });
}
