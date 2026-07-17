import { describe, it, expect, vi } from 'vitest';

// File-scoped mock: compromise's default export throws on every call, exercising
// the try/catch graceful-degradation path in extractEntities. Kept in its own
// file so the mock does not leak into the repository integration tests, which
// rely on the real compromise library to create entities via memoryRepository.
vi.mock('compromise', () => ({
  default: () => {
    throw new Error('compromise exploded');
  }
}));

import { extractEntities } from '../../../src/plugins/repositories/entity.ts';

describe('extractEntities — graceful degradation', () => {
  it('should return an empty array when compromise throws', () => {
    const result = extractEntities('Jorge was here');

    expect(result).toEqual([]);
  });

  it('should not crash even with known names supplied', () => {
    const result = extractEntities('Jorge was here', {
      knownNames: [{ name: 'Jorge', kind: 'person' }]
    });

    expect(result).toEqual([]);
  });
});
