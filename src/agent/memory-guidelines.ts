import { MEMORY_CATEGORIES, type MemoryCategory } from '../plugins/memory-categories.js';
export { MEMORY_CATEGORIES };

export const MEMORY_ACTION_TYPES = [
  'completed',
  'dismissed',
] as const;

const categoryDescriptions: Record<MemoryCategory, string> = {
  todo: 'a task or thing the user needs to do',
  appointment: 'a scheduled event, date, or meeting',
  note: 'general information, facts, or reminders (default when unclear)',
};

export const MEMORY_CATEGORIZATION_GUIDELINES = [
  'Categorize the user\'s memory based on what it describes:',
  ...MEMORY_CATEGORIES.map((c) => `- "${c.name}" — ${categoryDescriptions[c.name]}`),
  '',
  'TAGGING RULES (apply 1-4 relevant tags to every memory):',
  '- ALWAYS include "core" tag + set permanent=true for facts about the user\'s identity, preferences, or permanent traits',
  '- Include a domain tag: "work", "personal", "health", "finance", "home", "family", "social"',
  '- For actionable items: include urgency tag "this-week", "next-week", "this-month", or "someday"',
  '- For people mentioned: include "person:<name>" tag (lowercase, no spaces in name)',
] as const;

export const MEMORY_TOOL_PROMPT_SNIPPETS = {
  memory_create: 'Create a new memory with category, tags, and permanence',
  memory_list: 'List or search memories by category, tags, or recency',
  memory_resolve: 'Mark a memory as completed or dismissed',
} as const;

export const MEMORY_TOOL_PROMPT_GUIDELINES = {
  memory_create: [
    'Use memory_create to save information the user wants to remember',
    'FIRST: Choose the category based on the content type (todo=task, appointment=scheduled event, note=everything else)',
    'SECOND: Apply 1-4 relevant tags following the TAGGING RULES above',
    'THIRD: Set permanent=true + tag "core" only for long-term facts about the user',
    'Return a brief confirmation listing: what was saved, category, and all tags applied',
  ],
  memory_list: [
    'Use memory_list when the user asks what they have to do, what they\'ve noted, or wants to see memories',
    'Filter by category when the user asks about a specific type (e.g. "todos" → category=todo)',
    'Filter by tags when the user mentions specific contexts (e.g. "work stuff" → tags=["work"])',
    'Use recent_days for time-bounded queries (e.g. "what\'s coming up this week")',
    'When listing results, include each memory\'s ID, category, tags, and content so the user (or you) can reference them later',
  ],
  memory_resolve: [
    'Use memory_resolve to mark a memory as completed or dismissed',
    'You must provide the exact memory_id — use memory_list first to find it',
    'Default to "completed" for tasks that were done; use "dismissed" for things the user no longer cares about',
  ],
} as const;