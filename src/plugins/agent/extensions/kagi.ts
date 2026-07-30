import type {
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition
} from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { createKagiTools } from 'pi-kagi';

const SEARCH_CAP = 2;
const EXTRACT_CAP = 6;

const EXHAUSTION_MESSAGE
  = 'Summarize what you have found so far and ask the user whether to continue searching.';

const MISSING_KEY_MESSAGE
  = 'KAGI_API_KEY not configured. Set it in .env to enable web search.';

export default function createKagiExtension(
  fastify: FastifyInstance
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const [searchTool, extractTool] = createKagiTools({
      fetchImpl: globalThis.fetch,
      getApiKey: () => process.env.KAGI_API_KEY
    });

    let searchRemaining = SEARCH_CAP;
    let extractRemaining = EXTRACT_CAP;

    pi.on('agent_start', () => {
      searchRemaining = SEARCH_CAP;
      extractRemaining = EXTRACT_CAP;
    });

    function exhaustedResult(kind: string, cap: number) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Budget exhausted for ${kind} (${cap} calls per message). ${EXHAUSTION_MESSAGE}`
          }
        ],
        details: {}
      };
    }

    function missingKeyResult() {
      return {
        content: [
          {
            type: 'text' as const,
            text: MISSING_KEY_MESSAGE
          }
        ],
        details: {}
      };
    }

    function logSearchCall(query: string): void {
      fastify.log.info(
        {
          tool: 'kagi_search',
          query,
          searchRemaining,
          extractRemaining
        },
        `kagi_search: "${query}" (search=${searchRemaining}/${SEARCH_CAP}, extract=${extractRemaining}/${EXTRACT_CAP})`
      );
    }

    function logExtractCall(url: string): void {
      fastify.log.info(
        {
          tool: 'kagi_extract',
          url,
          searchRemaining,
          extractRemaining
        },
        `kagi_extract: ${url} (search=${searchRemaining}/${SEARCH_CAP}, extract=${extractRemaining}/${EXTRACT_CAP})`
      );
    }

    const wrappedSearch: ToolDefinition = {
      name: searchTool.name,
      description: searchTool.description,
      parameters: searchTool.parameters,
      renderCall: searchTool.renderCall as ToolDefinition['renderCall'],
      renderResult: searchTool.renderResult as ToolDefinition['renderResult'],
      label: 'Kagi Search',
      promptSnippet:
        'Search the web with Kagi. Limited calls per message — search wisely. Returns compact markdown results; cached paging is free.',
      promptGuidelines: [
        'Prefer kagi_search before considering kagi_extract; search snippets often answer the question on their own.',
        'When kagi_search results are insufficient, page deeper with kagi_search\'s offset parameter instead of rephrasing or repeating the same query.',
        'You have a limited number of web calls per message. When you are close to the cap, prioritize the most important query and plan follow-ups for the next message.'
      ],
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        if (!process.env.KAGI_API_KEY) {
          return missingKeyResult();
        }
        if (searchRemaining <= 0) {
          return exhaustedResult('search', SEARCH_CAP);
        }
        searchRemaining--;
        const result = await searchTool.execute(
          toolCallId,
          params as { query: string; limit?: number; offset?: number },
          signal,
          onUpdate,
          ctx
        );
        logSearchCall((params as { query: string }).query);
        return result;
      }
    };

    const wrappedExtract: ToolDefinition = {
      name: extractTool.name,
      description: extractTool.description,
      parameters: extractTool.parameters,
      renderCall: extractTool.renderCall as ToolDefinition['renderCall'],
      renderResult: extractTool.renderResult as ToolDefinition['renderResult'],
      label: 'Kagi Extract',
      promptSnippet:
        'Extract a web page as markdown via Kagi. Each uncached URL costs a paid call — extract only pages you intend to read. Paged like the read tool.',
      promptGuidelines: [
        'Use kagi_extract only on URLs you intend to read; each uncached kagi_extract URL costs a paid Kagi API call.',
        'Page through long kagi_extract content with offset and limit rather than re-requesting the same URL at a larger limit.',
        'Use kagi_extract\'s refresh parameter only when a cached page may be stale; normal offset/limit paging never needs refresh.',
        'Use kagi_extract for remote https URLs and the read tool for local file paths.',
        'When using kagi_extract, you have a limited extract budget per message. If the cap is near, read only the most critical pages and plan the rest for the next message.'
      ],
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        if (!process.env.KAGI_API_KEY) {
          return missingKeyResult();
        }
        if (extractRemaining <= 0) {
          return exhaustedResult('extract', EXTRACT_CAP);
        }
        extractRemaining--;
        const result = await extractTool.execute(
          toolCallId,
          params as { url: string; limit?: number; offset?: number; refresh?: boolean },
          signal,
          onUpdate,
          ctx
        );
        logExtractCall((params as { url: string }).url);
        return result;
      }
    };

    pi.registerTool(wrappedSearch);
    pi.registerTool(wrappedExtract);
  };
}
