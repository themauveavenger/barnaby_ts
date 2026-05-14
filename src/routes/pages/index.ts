import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ListMemoriesQuery, CreateMemoryBody, MemoryActionType } from '../../plugins/repository.js';
import { MEMORY_CATEGORIES } from '../../plugins/memory-categories.js';
import { listMemoriesSchema, createMemorySchema } from '../memories/schemas.js';
import { NotFoundError } from '../../plugins/error-handler.js';

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

interface CategorySelectOption {
  name: string;
  label: string;
  selected: boolean;
}

interface MemoryViewModel {
  id: string;
  content: string;
  category: string;
  tags: string[];
  permanent: boolean;
  createdAt: string;
  formattedDate: string;
  actionLabel: string | null;
  actions: { id: string; action: string; formattedDate: string }[];
  editUrl: string;
}

interface MemoriesViewModel {
  memories: MemoryViewModel[];
  filters: {
    category: string;
    categories: CategorySelectOption[];
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
}

interface NewMemoryViewModel {
  error?: string;
  form: {
    content: string;
    category: string;
    permanent: boolean;
    tags: string;
    categories: CategorySelectOption[];
  };
}

interface EditMemoryViewModel {
  id: string;
  content: string;
  category: string;
  categoryLabel: string;
  tags: string;
  permanent: boolean;
  returnUrl: string;
}

interface MemoryFormData {
  content?: unknown;
  category?: unknown;
  permanent?: unknown;
  tags?: unknown;
}

function buildFilterUrl(query: ListMemoriesQuery): string {
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.tags) params.set('tags', query.tags);
  const page = query.page || 1;
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

function buildViewModel(
  fastify: FastifyInstance,
  query: ListMemoriesQuery
): MemoriesViewModel {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));

  const repoQuery = {
    page,
    limit,
    category: query.category,
    tags: query.tags
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

  const memoryIds = data.map(m => m.id);
  const actionsMap = fastify.memoryActionRepository.findByMemoryIds(memoryIds);
  const categoryMap = new Map(MEMORY_CATEGORIES.map(c => [c.name, c]));

  const memories = data.map((memory) => {
    const editParams = new URLSearchParams();
    if (query.category) editParams.set('category', query.category);
    if (query.tags) editParams.set('tags', query.tags);
    if (page > 1) editParams.set('page', String(page));
    const editParamsStr = editParams.toString();

    return {
      ...memory,
      formattedDate: formatDate(memory.createdAt),
      actionLabel: categoryMap.get(memory.category)?.actionLabel ?? null,
      actions: (actionsMap.get(memory.id) || []).map(a => ({
        id: a.id,
        action: a.action,
        formattedDate: formatDate(a.createdAt)
      })),
      editUrl: editParamsStr
        ? `/memories/${memory.id}?${editParamsStr}`
        : `/memories/${memory.id}`
    };
  });

  return {
    memories,
    filters: {
      category: repoQuery.category || '',
      categories: MEMORY_CATEGORIES.map(c => ({
        name: c.name,
        label: c.label,
        selected: repoQuery.category === c.name
      })),
      tags: repoQuery.tags || ''
    },
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
      previousUrl: buildUrl(page - 1),
      nextUrl: buildUrl(page + 1)
    }
  };
}

function buildEmptyForm(): NewMemoryViewModel['form'] {
  return {
    content: '',
    category: '',
    permanent: false,
    tags: '',
    categories: MEMORY_CATEGORIES.map(c => ({
      name: c.name,
      label: c.label,
      selected: false
    }))
  };
}

function buildFormFromSubmission(data: MemoryFormData): NewMemoryViewModel['form'] {
  const tagsValue = Array.isArray(data.tags)
    ? data.tags.join(', ')
    : typeof data.tags === 'string'
      ? data.tags
      : '';

  return {
    content: typeof data.content === 'string' ? data.content : '',
    category: typeof data.category === 'string' ? data.category : '',
    permanent: data.permanent === true,
    tags: tagsValue,
    categories: MEMORY_CATEGORIES.map(c => ({
      name: c.name,
      label: c.label,
      selected: data.category === c.name
    }))
  };
}

export default async function pageRoutes(fastify: FastifyInstance) {
  fastify.get('/', { schema: listMemoriesSchema }, async (request: FastifyRequest<{ Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const viewModel = buildViewModel(fastify, request.query);
    return reply.view('memories/index', viewModel);
  });

  fastify.get('/memories/new', async (request: FastifyRequest, reply: FastifyReply) => {
    const viewModel: NewMemoryViewModel = {
      form: buildEmptyForm()
    };
    return reply.view('memories/new', viewModel);
  });

  fastify.post('/memories/new', {
    schema: createMemorySchema,
    attachValidation: true,
    preValidation: async (request) => {
      const body = request.body as MemoryFormData;
      if (typeof body.permanent === 'string') {
        body.permanent = body.permanent === 'on';
      }
      if (typeof body.tags === 'string') {
        body.tags = body.tags
          .split(',')
          .map(t => t.trim())
          .filter(Boolean);
      }
    }
  }, async (request: FastifyRequest<{ Body: CreateMemoryBody }>, reply: FastifyReply) => {
    if (request.validationError) {
      const viewModel: NewMemoryViewModel = {
        error: request.validationError.message,
        form: buildFormFromSubmission(request.body as MemoryFormData)
      };
      return reply.view('memories/new', viewModel);
    }

    request.server.memoryRepository.create(request.body);
    return reply.redirect('/');
  });

  fastify.get('/memories/:id', async (request: FastifyRequest<{ Params: { id: string }; Querystring: ListMemoriesQuery }>, reply: FastifyReply) => {
    const { id } = request.params;
    const memory = fastify.memoryRepository.findById(id);
    if (!memory) {
      throw new NotFoundError('Memory not found');
    }

    const categoryMap = new Map(MEMORY_CATEGORIES.map(c => [c.name, c]));
    const returnUrl = buildFilterUrl(request.query);

    const viewModel: EditMemoryViewModel = {
      id: memory.id,
      content: memory.content,
      category: memory.category,
      categoryLabel: categoryMap.get(memory.category)?.label ?? memory.category,
      tags: memory.tags.join(', '),
      permanent: memory.permanent,
      returnUrl
    };

    return reply.view('memories/edit', viewModel);
  });

  // Action form submission (complete/dismiss a memory)
  interface ActionFormData {
    memoryId?: unknown;
    actionType?: unknown;
  }

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
