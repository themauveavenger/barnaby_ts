import type { FastifyInstance } from 'fastify';
import type { ExtensionAPI, ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from 'typebox';
import {
  MEMORY_CATEGORIES,
  MEMORY_ACTION_TYPES,
  MEMORY_TOOL_PROMPT_SNIPPETS,
  MEMORY_TOOL_PROMPT_GUIDELINES,
} from '../../../agent/memory-guidelines.js';

function createMemoryCreateTool(fastify: FastifyInstance): ToolDefinition {
  return {
    name: 'memory_create',
    label: 'Create Memory',
    description: 'Create a new memory for the user. Memories store notes, tasks, appointments, and purchases.',
    promptSnippet: MEMORY_TOOL_PROMPT_SNIPPETS.memory_create,
    promptGuidelines: [...MEMORY_TOOL_PROMPT_GUIDELINES.memory_create],
    parameters: Type.Object({
      content: Type.String({ description: 'The content of the memory. Concise and clear.' }),
      category: Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c)), { description: 'The category of memory' }),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags to attach to the memory' })),
      permanent: Type.Optional(Type.Boolean({ description: 'Whether this memory should persist indefinitely. Set true for core facts about the user.' })),
    }),
    async execute(_toolCallId: string, params: { content: string; category: string; tags?: string[]; permanent?: boolean }) {
      try {
        const memory = fastify.memoryRepository.create({
          content: params.content,
          category: params.category as 'appointment' | 'note' | 'todo' | 'purchase',
          tags: params.tags,
          permanent: params.permanent,
        });

        const parts: string[] = [`Created ${memory.category}`];
        if (memory.permanent) {
          parts.push('permanent');
        }
        if (memory.tags.length > 0) {
          parts.push(`tags: ${memory.tags.join(', ')}`);
        }
        parts.push(`"${memory.content}"`);

        return {
          content: [{ type: 'text' as const, text: parts.join(', ') }],
          details: {},
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Failed to create memory: ${message}` }],
          details: {},
        };
      }
    },
  };
}

function createMemoryListTool(fastify: FastifyInstance): ToolDefinition {
  return {
    name: 'memory_list',
    label: 'List Memories',
    description: 'List or search memories. Filter by category, tags, or recency.',
    promptSnippet: MEMORY_TOOL_PROMPT_SNIPPETS.memory_list,
    promptGuidelines: [...MEMORY_TOOL_PROMPT_GUIDELINES.memory_list],
    parameters: Type.Object({
      category: Type.Optional(Type.Union(MEMORY_CATEGORIES.map((c) => Type.Literal(c)), { description: 'Filter by category' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Filter by tags' })),
      recent_days: Type.Optional(Type.Number({ description: 'Only show memories from the last N days. Defaults to all time if omitted.' })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of memories to return. Defaults to 10.' })),
    }),
    async execute(_toolCallId: string, params: { category?: string; tags?: string[]; recent_days?: number; limit?: number }) {
      try {
        if (params.recent_days) {
          const days = params.recent_days;
          const memories = fastify.memoryRepository.findRecent(days);
          if (memories.length === 0) {
            return {
              content: [{ type: 'text' as const, text: `No memories from the last ${days} day${days === 1 ? '' : 's'}.` }],
              details: {},
            };
          }
          const lines = memories.map((m) =>
            `${m.id.slice(0, 8)} [${m.category}] ${m.content}${m.permanent ? ' (permanent)' : ''}`
          );
          return {
            content: [{ type: 'text' as const, text: lines.join('\n') }],
            details: {},
          };
        }

        const query: { category?: string; tags?: string; page: number; limit: number } = {
          page: 1,
          limit: params.limit ?? 10,
        };
        if (params.category) {
          query.category = params.category;
        }
        if (params.tags && params.tags.length > 0) {
          query.tags = params.tags.join(',');
        }

        const { data, total } = fastify.memoryRepository.findAll(query);
        if (data.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No memories found.' }],
            details: {},
          };
        }
        const lines = data.map((m) =>
          `${m.id.slice(0, 8)} [${m.category}] ${m.content}${m.permanent ? ' (permanent)' : ''}`
        );
        return {
          content: [{ type: 'text' as const, text: `${lines.join('\n')}\n\n(${total} total, showing ${data.length})` }],
          details: {},
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Failed to list memories: ${message}` }],
          details: {},
        };
      }
    },
  };
}

function createMemoryResolveTool(fastify: FastifyInstance): ToolDefinition {
  return {
    name: 'memory_resolve',
    label: 'Resolve Memory',
    description: 'Mark a memory as completed or dismissed. Use memory_list first to find the memory ID.',
    promptSnippet: MEMORY_TOOL_PROMPT_SNIPPETS.memory_resolve,
    promptGuidelines: [...MEMORY_TOOL_PROMPT_GUIDELINES.memory_resolve],
    parameters: Type.Object({
      memory_id: Type.String({ description: 'The ID of the memory to resolve. Use memory_list to find it first.' }),
      action: Type.Union(MEMORY_ACTION_TYPES.map((a) => Type.Literal(a)), { description: '"completed" for tasks done, "dismissed" for things no longer relevant' }),
    }),
    async execute(_toolCallId: string, params: { memory_id: string; action: string }) {
      try {
        const memory = fastify.memoryRepository.findById(params.memory_id);
        if (!memory) {
          return {
            content: [{ type: 'text' as const, text: `Memory not found: ${params.memory_id}. Use memory_list to find the correct ID.` }],
            details: {},
          };
        }

        fastify.memoryActionRepository.create(params.memory_id, params.action as 'completed' | 'dismissed');
        const verb = params.action === 'completed' ? 'Completed' : 'Dismissed';
        return {
          content: [{ type: 'text' as const, text: `${verb}: [${memory.category}] ${memory.content}` }],
          details: {},
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Failed to resolve memory: ${message}` }],
          details: {},
        };
      }
    },
  };
}

export default function createMemoryExtension(fastify: FastifyInstance) {
  return (pi: ExtensionAPI) => {
    pi.registerTool(createMemoryCreateTool(fastify));
    pi.registerTool(createMemoryListTool(fastify));
    pi.registerTool(createMemoryResolveTool(fastify));
  };
}