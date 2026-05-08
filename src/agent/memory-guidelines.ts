import { MEMORY_CATEGORIES, type MemoryCategory } from '../plugins/memory-categories.js';
export { MEMORY_CATEGORIES };

export const MEMORY_ACTION_TYPES = [
  'completed',
  'dismissed',
] as const;

const categoryDescriptions: Record<MemoryCategory, string> = {
  todo: 'a task or thing the user needs to do',
  appointment: 'a scheduled event, date, or meeting',
  purchase: 'something to buy or a spending-related note',
  note: 'general information, facts, or reminders (default when unclear)',
};

export const MEMORY_CATEGORIZATION_GUIDELINES = [
  'Categorize the user\'s memory based on what it describes:',
  ...MEMORY_CATEGORIES.map((c) => `- "${c.name}" — ${categoryDescriptions[c.name]}`),
  '',
  'Additional rules:',
  '- Tag facts about the user\'s identity, preferences, or permanent traits with "core" and set permanent=true',
  '- Keep content concise — rephrase verbose input into a clear, memorable statement',
  '- For "list", "show", or "what" requests, use memory_list to find matching memories, then summarize them for the user',
  '- For "done", "completed", or "dismiss" requests, first use memory_list to find the relevant memory, then use memory_resolve to mark it completed or dismissed',
  '- Always confirm what you created, listed, or resolved in plain language',
] as const;

export const MEMORY_TOOL_PROMPT_SNIPPETS = {
  memory_create: 'Create a new memory with category, tags, and permanence',
  memory_list: 'List or search memories by category, tags, or recency',
  memory_resolve: 'Mark a memory as completed or dismissed',
} as const;

export const MEMORY_TOOL_PROMPT_GUIDELINES = {
  memory_create: [
    'Use memory_create to save information the user wants to remember',
    'Infer the category from context: "todo" for tasks, "appointment" for events, "purchase" for shopping, "note" for everything else',
    'When the user says something should be remembered permanently or is a core fact, set permanent=true and add the "core" tag',
    'Return a brief confirmation of what was saved including category and tags',
  ],
  memory_list: [
    'Use memory_list when the user asks what they have to do, what they\'ve noted, or wants to see memories',
    'Filter by category when the user asks about a specific type (e.g. "todos" → category=todo)',
    'Use recent_days for time-bounded queries (e.g. "what\'s coming up this week")',
    'When listing results, include each memory\'s ID, category, and content so the user (or you) can reference them later',
  ],
  memory_resolve: [
    'Use memory_resolve to mark a memory as completed or dismissed',
    'You must provide the exact memory_id — use memory_list first to find it',
    'Default to "completed" for tasks that were done; use "dismissed" for things the user no longer cares about',
  ],
} as const;