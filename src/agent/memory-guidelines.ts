import { MEMORY_CATEGORIES, type MemoryCategory } from '../plugins/memory-categories.js';
export { MEMORY_CATEGORIES };

export const MEMORY_ACTION_TYPES = [
  'completed',
  'dismissed'
] as const;

const categoryDescriptions: Record<MemoryCategory, string> = {
  todo: 'a task or thing the user needs to do',
  note: 'general information, facts, or reminders (default when unclear)'
};

export const MEMORY_CATEGORIZATION_GUIDELINES = [
  'Categorize the user\'s memory based on what it describes:',
  ...MEMORY_CATEGORIES.map(c => `- "${c.name}" — ${categoryDescriptions[c.name]}`),
  '',
  'TAGGING RULES (apply 1-4 relevant tags to every memory):',
  '- ALWAYS include "core" tag + set permanent=true for facts about the user\'s identity, preferences, or permanent traits',
  '- Include a domain tag: "work", "personal", "health", "finance", "home", "family", "social"',
  '- For actionable items: include urgency tag "this-week", "next-week", "this-month", or "someday"',
  '- For people mentioned: include "person:<name>" tag (lowercase, no spaces in name)'
] as const;

export const MEMORY_TOOL_PROMPT_SNIPPETS = {
  memory_create: 'Create a new memory with category, tags, and permanence',
  memory_list: 'List or search memories by category, tags, or recency',
  memory_resolve: 'Mark a memory as completed or dismissed'
} as const;

export const MEMORY_TOOL_PROMPT_GUIDELINES = {
  memory_create: [
    'Use memory_create to save information the user wants to remember.',
    'For memory_create, choose the category based on content type (todo=task, note=everything else).',
    'For memory_create, apply 1-4 relevant tags following the TAGGING RULES above.',
    'For memory_create, set permanent=true + tag "core" only for long-term facts about the user.',
    'After memory_create succeeds, confirm what was saved including category and all tags applied.'
  ],
  memory_list: [
    'Use memory_list when the user asks what they have to do, what they\'ve noted, or wants to see memories.',
    'For memory_list, filter by category when the user asks about a specific type (e.g. "todos" → category=todo).',
    'For memory_list, filter by tags when the user mentions specific contexts (e.g. "work stuff" → tags=["work"]).',
    'For memory_list, use recent_days for time-bounded queries (e.g. "what\'s coming up this week").',
    'When memory_list returns results, include each memory\'s ID, category, tags, and content so they can be referenced later.'
  ],
  memory_resolve: [
    'Use memory_resolve to mark a memory as completed or dismissed.',
    'For memory_resolve, use memory_list first to find the exact memory_id.',
    'For memory_resolve, default to "completed" for tasks done; use "dismissed" for things no longer relevant.'
  ]
} as const;
