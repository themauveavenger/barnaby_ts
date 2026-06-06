import type { AgentToolResult, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { match, P } from 'ts-pattern';
import { Type } from 'typebox';

export default function createWolframAlphaExtension(
  fastify: FastifyInstance
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    pi.registerTool({
      name: 'wolfram_alpha',
      label: 'Wolfram|Alpha Query',
      description: 'Query Wolfram|Alpha for math, science, and factual computations.',
      promptSnippet: 'Query Wolfram|Alpha for math, science, and factual computations',
      parameters: Type.Object({
        input: Type.String({ description: 'The query to send to Wolfram|Alpha' }),
        maxchars: Type.Optional(Type.Number({ default: 1000, description: 'Maximum characters in response' }))
      }),
      promptGuidelines: [
        'Use wolfram_alpha when the user asks math, science, or fact-based questions that require precise computation or data.',
        'When using wolfram_alpha, simplify queries to keyword form when possible. For example, "population of Japan" instead of "How many people live in Japan?"',
        'When using wolfram_alpha, use standard exponent notation: `6*10^14` instead of `6e14`.',
        'When using wolfram_alpha, use proper Markdown for math formulas: standalone expressions use `$$...$$`, inline expressions use `\\( ... \\)`.',
        'When using wolfram_alpha, use single-letter variable names for algebraic expressions (e.g., n, x, n_1).',
        'When using wolfram_alpha, use named physical constants (e.g., "speed of light") instead of substituting numerical values.',
        'When using wolfram_alpha, include spaces between compound units (e.g., "miles per hour" instead of "mph").',
        'When using wolfram_alpha, make separate calls for each distinct property or question.',
        'When using wolfram_alpha, do not mention knowledge cutoff dates; Wolfram returns current data.',
        'When using wolfram_alpha, format any image URLs in the response as Markdown images: `![description](URL)`.'
      ],
      async execute(_toolCallId, params) {
        const { input, maxchars = 1000 } = params;
        const appId = process.env.WOLFRAM_ALPHA_APPID;

        if (!appId) {
          return {
            content: [{ type: 'text' as const, text: 'Wolfram|Alpha is not configured. Set WOLFRAM_ALPHA_APPID.' }],
            isError: true,
            details: {}
          };
        }

        const url = new URL('https://www.wolframalpha.com/api/v1/llm-api');
        url.searchParams.set('input', input);
        url.searchParams.set('appid', appId);
        url.searchParams.set('maxchars', String(maxchars));

        try {
          const response = await fetch(url.toString());
          const body = await response.text();

          return match(response.status)
            .returnType<AgentToolResult<unknown>>()
            .with(501, () => ({
              content: [{ type: 'text' as const, text: `Wolfram|Alpha could not interpret the query. Suggested: ${body}` }],
              isError: true,
              details: {}
            }))
            .with(403, () => ({
              content: [{ type: 'text' as const, text: 'Wolfram|Alpha API key is invalid. Check WOLFRAM_ALPHA_APPID.' }],
              isError: true,
              details: {}
            }))
            .with(400, () => ({
              content: [{ type: 'text' as const, text: 'Wolfram|Alpha query was rejected. Ensure the input parameter is provided.' }],
              isError: true,
              details: {}
            }))
            .with(P.when(() => !response.ok), () => ({
              content: [{ type: 'text' as const, text: `Wolfram|Alpha API error (${response.status}): ${body}` }],
              isError: true,
              details: {}
            }))
            .otherwise(() => ({
              content: [{ type: 'text' as const, text: body }],
              details: {}
            }));
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          fastify.log.error({ err: error }, 'Wolfram|Alpha API call failed');
          return {
            content: [{ type: 'text' as const, text: `Error calling Wolfram|Alpha: ${message}` }],
            isError: true,
            details: {}
          };
        }
      }
    });
  };
}
