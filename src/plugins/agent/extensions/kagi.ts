import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionFactory,
  ToolDefinition
} from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import { createKagiTools } from 'pi-kagi';

const SEARCH_CAP = 2;
const EXTRACT_CAP = 6;

const EXHAUSTION_MESSAGE
  = 'Summarize what you have found so far and ask the user whether to keep going.';

const MISSING_KEY_MESSAGE
  = 'KAGI_API_KEY not configured. Set it in .env to enable web search.';

interface BudgetState {
  remaining: number;
  cap: number;
}

interface Budgets {
  search: BudgetState;
  extract: BudgetState;
}

function makeBudgetGuardResult(
  kind: string,
  cap: number
): AgentToolResult<unknown> {
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

function makeMissingKeyResult(): AgentToolResult<unknown> {
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

function createLogMessage(
  toolName: string,
  target: string,
  kind: 'search' | 'extract',
  budgets: Budgets
): string {
  const searchRemaining = budgets.search.remaining;
  const extractRemaining = budgets.extract.remaining;
  const formattedTarget = kind === 'search' ? `"${target}"` : target;
  return `${toolName}: ${formattedTarget} (search=${searchRemaining}/${SEARCH_CAP}, extract=${extractRemaining}/${EXTRACT_CAP})`;
}

function createLogData(
  toolName: string,
  target: string,
  kind: 'search' | 'extract',
  budgets: Budgets
): { tool: string; query: string; searchRemaining: number; extractRemaining: number } | { tool: string; url: string; searchRemaining: number; extractRemaining: number } {
  const searchRemaining = budgets.search.remaining;
  const extractRemaining = budgets.extract.remaining;
  return kind === 'search'
    ? { tool: toolName, query: target, searchRemaining, extractRemaining }
    : { tool: toolName, url: target, searchRemaining, extractRemaining };
}

function wrapPaidTool(
  fastify: FastifyInstance,
  tool: ToolDefinition,
  budgets: Budgets,
  kind: 'search' | 'extract',
  label: string,
  promptSnippet: string,
  promptGuidelines: string[],
  getTarget: (params: unknown) => string
): ToolDefinition {
  const budget = budgets[kind];
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    renderCall: tool.renderCall,
    renderResult: tool.renderResult,
    label,
    promptSnippet,
    promptGuidelines,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!process.env.KAGI_API_KEY) {
        return makeMissingKeyResult();
      }
      if (budget.remaining <= 0) {
        return makeBudgetGuardResult(kind, budget.cap);
      }
      budget.remaining--;
      const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      const target = getTarget(params);
      fastify.log.info(
        createLogData(tool.name, target, kind, budgets),
        createLogMessage(tool.name, target, kind, budgets)
      );
      return result;
    }
  };
}

export default function createKagiExtension(
  fastify: FastifyInstance
): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const [searchTool, extractTool] = createKagiTools({
      fetchImpl: globalThis.fetch,
      getApiKey: () => process.env.KAGI_API_KEY
    });

    const budgets: Budgets = {
      search: { remaining: SEARCH_CAP, cap: SEARCH_CAP },
      extract: { remaining: EXTRACT_CAP, cap: EXTRACT_CAP }
    };

    pi.on('agent_start', () => {
      budgets.search.remaining = SEARCH_CAP;
      budgets.extract.remaining = EXTRACT_CAP;
    });

    const wrappedSearch = wrapPaidTool(
      fastify,
      searchTool,
      budgets,
      'search',
      'Kagi Search',
      'Search the web with Kagi. Limited calls per message — search wisely. Returns compact markdown results; cached paging is free.',
      [
        'Prefer kagi_search before considering kagi_extract; search snippets often answer the question on their own.',
        'When kagi_search results are insufficient, page deeper with kagi_search\'s offset parameter instead of rephrasing or repeating the same query.',
        'You have a limited number of web calls per message. When you are close to the cap, prioritize the most important query and plan follow-ups for the next message.'
      ],
      params => (params as { query: string }).query
    );

    const wrappedExtract = wrapPaidTool(
      fastify,
      extractTool,
      budgets,
      'extract',
      'Kagi Extract',
      'Extract a web page as markdown via Kagi. Each uncached URL costs a paid call — extract only pages you intend to read. Paged like the read tool.',
      [
        'Use kagi_extract only on URLs you intend to read; each uncached kagi_extract URL costs a paid Kagi API call.',
        'Page through long kagi_extract content with offset and limit rather than re-requesting the same URL at a larger limit.',
        'Use kagi_extract\'s refresh parameter only when a cached page may be stale; normal offset/limit paging never needs refresh.',
        'Use kagi_extract for remote https URLs and the read tool for local file paths.',
        'You have a limited extract budget per message. If the cap is near, read only the most critical pages and plan the rest for the next message.'
      ],
      params => (params as { url: string }).url
    );

    pi.registerTool(wrappedSearch);
    pi.registerTool(wrappedExtract);
  };
}
