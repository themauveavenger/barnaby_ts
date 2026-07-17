import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

/**
 * Minimal embedding provider used by the memory repository to turn text
 * into dense vectors for semantic search.
 *
 * The interface is intentionally narrow: consumers only need a vector and
 * its dimensionality. Keeping it small makes deterministic mocks easy to
 * inject in tests and leaves room for swapping models later.
 */
export interface EmbeddingProvider {
  /** Return a normalized embedding vector for the supplied text. */
  embed(text: string): Promise<number[]>;
  /** Dimensionality of every vector returned by {@link embed}. */
  readonly dimensions: number;
}

/**
 * Hash a string into a non-negative integer using a simple DJB2 variant.
 *
 * Deterministic across runs so that the same text always maps to the same
 * embedding bucket, which is enough for the test-suite's mock provider.
 */
function hashString(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Create a deterministic, dependency-free embedding provider.
 *
 * Tokens are hashed into fixed buckets and the resulting vector is L2
 * normalised. It is not semantically aware, but it produces stable vectors
 * that correlate with word overlap, which keeps the repository tests fast
 * and hermetic.
 */
export function createDeterministicEmbeddingProvider(dimensions = 384): EmbeddingProvider {
  return {
    async embed(text: string): Promise<number[]> {
      const vector = new Float64Array(dimensions);
      const tokens = text.toLowerCase().match(/\b[a-z0-9]+\b/g) ?? [];

      for (const token of tokens) {
        const hash = hashString(token);
        const index = hash % dimensions;
        const direction = (hash % 2 === 0) ? 1 : -1;
        vector[index] += direction;
      }

      const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      if (magnitude === 0) {
        return Array(dimensions).fill(0);
      }

      return Array.from(vector, value => value / magnitude);
    },

    get dimensions(): number {
      return dimensions;
    }
  };
}

/**
 * Create a real embedding provider backed by the local Xenova/all-MiniLM-L6-v2
 * model via Transformers.js.
 *
 * The model is loaded once and cached for the process lifetime. If loading
 * fails (e.g. no network for the first download), the returned promise rejects
 * so the caller can fall back to keyword-only search.
 */
export async function createXenovaEmbeddingProvider(): Promise<EmbeddingProvider> {
  const { pipeline } = await import('@xenova/transformers');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');

  return {
    async embed(text: string): Promise<number[]> {
      const output = await extractor(text, { pooling: 'mean', normalize: true });
      const list: number[][] = output.tolist();
      return list[0];
    },

    get dimensions(): number {
      return 384;
    }
  };
}

/**
 * Fastify plugin that decorates the instance with an {@link EmbeddingProvider}.
 *
 * In test environments the provider can be swapped for a deterministic mock
 * by setting `EMBEDDING_PROVIDER=deterministic`. In production the plugin tries
 * to load the local model; if that fails it decorates with `null` so the memory
 * repository gracefully degrades to keyword-only retrieval.
 */
export default fp(async function embeddingProviderPlugin(fastify: FastifyInstance) {
  if (process.env.EMBEDDING_PROVIDER === 'deterministic') {
    fastify.decorate('embeddingProvider', createDeterministicEmbeddingProvider());
    return;
  }

  try {
    const provider = await createXenovaEmbeddingProvider();
    fastify.decorate('embeddingProvider', provider);
  } catch (err) {
    fastify.log.error({ err }, 'Failed to load embedding model; semantic search disabled');
    fastify.decorate('embeddingProvider', null);
  }
});
