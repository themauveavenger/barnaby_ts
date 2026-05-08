import { describe, it, expect } from 'vitest';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_NAMES, type MemoryCategory } from '../../src/plugins/memory-categories.js';

describe('memory-categories', () => {
  it('should contain the four expected categories', () => {
    const names = MEMORY_CATEGORIES.map((c) => c.name);
    expect(names).toEqual(['appointment', 'note', 'todo', 'purchase']);
  });

  it('should have correct labels', () => {
    const labels = MEMORY_CATEGORIES.map((c) => c.label);
    expect(labels).toEqual(['Appointment', 'Note', 'Todo', 'Purchase']);
  });

  it('should assign actionLabel only to todo and purchase', () => {
    const withActions = MEMORY_CATEGORIES
      .filter((c) => c.actionLabel !== null)
      .map((c) => c.name);
    expect(withActions).toEqual(['todo', 'purchase']);
  });

  it('should export MEMORY_CATEGORY_NAMES matching the names', () => {
    expect(MEMORY_CATEGORY_NAMES).toEqual(['appointment', 'note', 'todo', 'purchase']);
  });

  it('should be assignable to MemoryCategory type', () => {
    const check = (name: MemoryCategory): MemoryCategory => name;
    for (const cat of MEMORY_CATEGORY_NAMES) {
      expect(() => check(cat)).not.toThrow();
    }
  });
});
