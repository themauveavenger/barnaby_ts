import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { MEMORY_CATEGORIES } from '../../../../src/plugins/memory-categories.js';
import createMemoryExtension from '../../../../src/plugins/agent/extensions/memory.js';

function createMockExtensionAPI(): ExtensionAPI & { _tools: { name: string; execute: Function }[] } {
  const tools: { name: string; execute: Function }[] = [];
  return {
    registerTool: vi.fn(tool => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

function getTools(extApi: ExtensionAPI) {
  return (extApi as unknown as { _tools: { name: string; execute: Function }[] })._tools;
}

function createMockFastify() {
  const memories: {
    id: string;
    content: string;
    category: string;
    tags: string[];
    permanent: boolean;
  }[] = [];

  let nextId = 1;

  const mockMemoryRepo = {
    create: vi.fn((data: { content: string; category: string; tags?: string[]; permanent?: boolean }) => {
      const memory = {
        id: `mem-${nextId++}`,
        content: data.content,
        category: data.category,
        tags: data.tags ?? [],
        permanent: data.permanent ?? false
      };
      memories.push(memory);
      return memory;
    }),
    findById: vi.fn((id: string) => memories.find(m => m.id === id) ?? null),
    findAll: vi.fn((query?: { category?: string; tags?: string; page?: number; limit?: number }) => {
      let filtered = [...memories];
      if (query?.category) {
        filtered = filtered.filter(m => m.category === query.category);
      }
      const limit = query?.limit ?? 20;
      const page = query?.page ?? 1;
      const start = (page - 1) * limit;
      return { data: filtered.slice(start, start + limit), total: filtered.length };
    }),
    findRecent: vi.fn((_days: number) => memories),
    delete: vi.fn(),
    findForContext: vi.fn(),
    findResolvedRecent: vi.fn(),
    findByTags: vi.fn()
  };

  const mockMemoryActionRepo = {
    create: vi.fn((memoryId: string, action: string) => ({
      id: `action-${nextId++}`,
      memoryId,
      action,
      createdAt: new Date().toISOString()
    })),
    findByMemoryIds: vi.fn(),
    delete: vi.fn()
  };

  return {
    memoryRepository: mockMemoryRepo,
    memoryActionRepository: mockMemoryActionRepo,
    log: { info: vi.fn(), error: vi.fn() },
    _memories: memories
  } as unknown as FastifyInstance & { _memories: typeof memories };
}

describe('memory extension', () => {
  let fastify: ReturnType<typeof createMockFastify>;
  let extApi: ReturnType<typeof createMockExtensionAPI>;

  beforeEach(() => {
    fastify = createMockFastify();
    extApi = createMockExtensionAPI();
    createMemoryExtension(fastify)(extApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers three tools', () => {
    const tools = getTools(extApi);
    const names = tools.map(t => t.name);
    expect(names).toContain('memory_create');
    expect(names).toContain('memory_list');
    expect(names).toContain('memory_resolve');
  });

  it('uses the exact categories from MEMORY_CATEGORIES in tool schemas', async () => {
    const tools = getTools(extApi);
    const createTool = tools.find(t => t.name === 'memory_create')!;

    for (const cat of MEMORY_CATEGORIES) {
      const result = await createTool.execute('call-test', {
        content: `Test ${cat.name}`,
        category: cat.name
      });
      expect(result.content[0].text).toContain(`Created ${cat.name}`);
    }
  });

  describe('memory_create', () => {
    it('creates a memory with defaults', async () => {
      const tools = getTools(extApi);
      const tool = tools.find(t => t.name === 'memory_create')!;

      const result = await tool.execute('call-1', {
        content: 'Call the dentist',
        category: 'todo'
      });

      expect(fastify.memoryRepository.create).toHaveBeenCalledWith({
        content: 'Call the dentist',
        category: 'todo',
        tags: undefined,
        permanent: undefined
      });

      expect(result.content[0].text).toContain('Created todo');
      expect(result.content[0].text).toContain('Call the dentist');
    });

    it('creates a permanent memory with core tag', async () => {
      const tools = getTools(extApi);
      const tool = tools.find(t => t.name === 'memory_create')!;

      const result = await tool.execute('call-1', {
        content: 'Allergic to shellfish',
        category: 'note',
        tags: ['core'],
        permanent: true
      });

      expect(fastify.memoryRepository.create).toHaveBeenCalledWith({
        content: 'Allergic to shellfish',
        category: 'note',
        tags: ['core'],
        permanent: true
      });

      expect(result.content[0].text).toContain('permanent');
      expect(result.content[0].text).toContain('tags: core');
    });

    it('handles repository error', async () => {
      const tools = getTools(extApi);
      const tool = tools.find(t => t.name === 'memory_create')!;
      (fastify.memoryRepository.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = await tool.execute('call-1', {
        content: 'Test',
        category: 'note'
      });

      expect(result.content[0].text).toBe('Failed to create memory: DB error');
    });
  });

  describe('memory_list', () => {
    it('returns empty message when no memories found', async () => {
      const tools = getTools(extApi);
      const tool = tools.find(t => t.name === 'memory_list')!;

      const result = await tool.execute('call-1', {});

      expect(result.content[0].text).toBe('No memories found.');
    });

    it('lists memories with IDs and categories', async () => {
      // Create some memories first
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Buy milk', category: 'todo' });
      await createTool.execute('call-2', { content: 'Dentist at 2pm', category: 'appointment' });

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-3', {});

      expect(result.content[0].text).toContain('[todo] Buy milk');
      expect(result.content[0].text).toContain('[appointment] Dentist at 2pm');
      expect(result.content[0].text).toContain('2 total, showing 2');
    });

    it('filters by category', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Buy milk', category: 'todo' });
      await createTool.execute('call-2', { content: 'Dentist', category: 'appointment' });

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-3', { category: 'todo' });

      expect(result.content[0].text).toContain('[todo] Buy milk');
      expect(result.content[0].text).not.toContain('[appointment]');
    });

    it('lists recent memories by days', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Recent task', category: 'todo' });

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-3', { recent_days: 7 });

      expect(result.content[0].text).toContain('[todo] Recent task');
      expect(fastify.memoryRepository.findRecent).toHaveBeenCalledWith(7);
    });

    it('returns empty message for recent memories with no results', async () => {
      (fastify.memoryRepository.findRecent as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-3', { recent_days: 30 });

      expect(result.content[0].text).toBe('No memories from the last 30 days.');
    });

    it('marks permanent memories', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Core fact', category: 'note', permanent: true });

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-3', {});

      expect(result.content[0].text).toContain('(permanent)');
    });

    it('handles repository error', async () => {
      (fastify.memoryRepository.findAll as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB error');
      });

      const tools = getTools(extApi);
      const listTool = tools.find(t => t.name === 'memory_list')!;
      const result = await listTool.execute('call-1', {});

      expect(result.content[0].text).toBe('Failed to list memories: DB error');
    });
  });

  describe('memory_resolve', () => {
    it('marks a memory as completed', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Buy milk', category: 'todo' });
      const memoryId = (fastify as unknown as { _memories: { id: string }[] })._memories[0].id;

      const tools = getTools(extApi);
      const resolveTool = tools.find(t => t.name === 'memory_resolve')!;
      const result = await resolveTool.execute('call-2', { memory_id: memoryId, action: 'completed' });

      expect(fastify.memoryActionRepository.create).toHaveBeenCalledWith(memoryId, 'completed');
      expect(result.content[0].text).toContain('Completed');
      expect(result.content[0].text).toContain('Buy milk');
    });

    it('marks a memory as dismissed', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Old task', category: 'todo' });
      const memoryId = (fastify as unknown as { _memories: { id: string }[] })._memories[0].id;

      const tools = getTools(extApi);
      const resolveTool = tools.find(t => t.name === 'memory_resolve')!;
      const result = await resolveTool.execute('call-2', { memory_id: memoryId, action: 'dismissed' });

      expect(fastify.memoryActionRepository.create).toHaveBeenCalledWith(memoryId, 'dismissed');
      expect(result.content[0].text).toContain('Dismissed');
    });

    it('returns error for nonexistent memory ID', async () => {
      const tools = getTools(extApi);
      const resolveTool = tools.find(t => t.name === 'memory_resolve')!;
      const result = await resolveTool.execute('call-1', { memory_id: 'nonexistent', action: 'completed' });

      expect(result.content[0].text).toContain('Memory not found');
      expect(result.content[0].text).toContain('memory_list');
      expect(fastify.memoryActionRepository.create).not.toHaveBeenCalled();
    });

    it('handles action repository error', async () => {
      const createTool = getTools(extApi).find(t => t.name === 'memory_create')!;
      await createTool.execute('call-1', { content: 'Test', category: 'todo' });
      const memoryId = (fastify as unknown as { _memories: { id: string }[] })._memories[0].id;

      (fastify.memoryActionRepository.create as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('DB error');
      });

      const tools = getTools(extApi);
      const resolveTool = tools.find(t => t.name === 'memory_resolve')!;
      const result = await resolveTool.execute('call-2', { memory_id: memoryId, action: 'completed' });

      expect(result.content[0].text).toBe('Failed to resolve memory: DB error');
    });
  });
});
