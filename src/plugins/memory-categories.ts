export const MEMORY_CATEGORIES = [
  { name: 'note', label: 'Note', actionLabel: null },
  { name: 'todo', label: 'Todo', actionLabel: 'Complete' }
] as const;

export type MemoryCategory = typeof MEMORY_CATEGORIES[number]['name'];
export const MEMORY_CATEGORY_NAMES: readonly MemoryCategory[] = MEMORY_CATEGORIES.map(c => c.name);
