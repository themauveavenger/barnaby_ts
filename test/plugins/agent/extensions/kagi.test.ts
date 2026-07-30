import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { EventBus } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import fastify from 'fastify';
import createKagiExtension from '../../../../src/plugins/agent/extensions/kagi.js';

// ── Types ──────────────────────────────────────────────────────────────────

type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal?: AbortSignal,
  onUpdate?: unknown,
  ctx?: unknown
) => Promise<AgentToolResult<unknown>>;

interface CapturedTool {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  promptSnippet?: string;
  promptGuidelines?: string[];
  execute: ToolExecute;
}

interface CapturedHandlers {
  agent_start: (() => void)[];
}

interface MockExtensionAPI extends ExtensionAPI {
  _tools: CapturedTool[];
  _handlers: CapturedHandlers;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getFirstText(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

function getResultErrorFlag(result: AgentToolResult<unknown>): boolean {
  return (result as AgentToolResult<unknown> & { isError?: boolean }).isError ?? false;
}

// ── Mock ExtensionAPI ──────────────────────────────────────────────────────

function createMockExtensionAPI(): MockExtensionAPI {
  const tools: CapturedTool[] = [];
  const handlers: CapturedHandlers = { agent_start: [] };

  const api: ExtensionAPI = {
    registerTool: vi.fn((tool: CapturedTool) => {
      tools.push(tool);
    }) as ExtensionAPI['registerTool'],
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'agent_start') {
        handlers.agent_start.push(handler as () => void);
      }
    }) as ExtensionAPI['on'],
    registerCommand: vi.fn() as ExtensionAPI['registerCommand'],
    registerShortcut: vi.fn() as ExtensionAPI['registerShortcut'],
    registerFlag: vi.fn() as ExtensionAPI['registerFlag'],
    getFlag: vi.fn() as ExtensionAPI['getFlag'],
    registerProvider: vi.fn() as ExtensionAPI['registerProvider'],
    unregisterProvider: vi.fn() as ExtensionAPI['unregisterProvider'],
    events: {
      emit: vi.fn() as EventBus['emit'],
      on: vi.fn() as EventBus['on']
    },
    registerMessageRenderer: vi.fn() as ExtensionAPI['registerMessageRenderer'],
    registerEntryRenderer: vi.fn() as ExtensionAPI['registerEntryRenderer'],
    sendMessage: vi.fn() as ExtensionAPI['sendMessage'],
    sendUserMessage: vi.fn() as ExtensionAPI['sendUserMessage'],
    appendEntry: vi.fn() as ExtensionAPI['appendEntry'],
    setSessionName: vi.fn() as ExtensionAPI['setSessionName'],
    getSessionName: vi.fn() as ExtensionAPI['getSessionName'],
    setLabel: vi.fn() as ExtensionAPI['setLabel'],
    exec: vi.fn() as ExtensionAPI['exec'],
    getActiveTools: vi.fn() as ExtensionAPI['getActiveTools'],
    getAllTools: vi.fn() as ExtensionAPI['getAllTools'],
    setActiveTools: vi.fn() as ExtensionAPI['setActiveTools'],
    getCommands: vi.fn() as ExtensionAPI['getCommands'],
    setModel: vi.fn() as ExtensionAPI['setModel'],
    getThinkingLevel: vi.fn() as ExtensionAPI['getThinkingLevel'],
    setThinkingLevel: vi.fn() as ExtensionAPI['setThinkingLevel']
  };

  return Object.assign(api, { _tools: tools, _handlers: handlers });
}

function getTools(extApi: MockExtensionAPI): CapturedTool[] {
  return extApi._tools;
}

function getAgentStartHandler(
  extApi: MockExtensionAPI
): (() => void) | undefined {
  return extApi._handlers.agent_start[0];
}

// ── Mock Fastify ───────────────────────────────────────────────────────────

function createMockFastify(): FastifyInstance {
  const app = fastify({ logger: false });
  app.log.info = vi.fn() as typeof app.log.info;
  app.log.warn = vi.fn() as typeof app.log.warn;
  app.log.error = vi.fn() as typeof app.log.error;
  return app;
}

// ── Fetch stubs ────────────────────────────────────────────────────────────

interface KagiSearchResult {
  url: string;
  title: string;
  snippet?: string;
}

interface KagiSearchResponse {
  data?: { search?: KagiSearchResult[] };
}

interface KagiExtractResponse {
  data?: { url: string; markdown?: string; error?: string }[];
}

function makeSearchResponse(
  results: KagiSearchResult[]
): KagiSearchResponse {
  return { data: { search: results } };
}

function makeExtractResponse(
  url: string,
  markdown = '# Test Page\n\nContent.'
): KagiExtractResponse {
  return { data: [{ url, markdown }] };
}

// ── Setup ──────────────────────────────────────────────────────────────────

function setup(): {
  fastify: FastifyInstance;
  extApi: MockExtensionAPI;
  searchTool: CapturedTool;
  extractTool: CapturedTool;
  agentStartHandler: (() => void) | undefined;
} {
  const fastify = createMockFastify();
  const extApi = createMockExtensionAPI();
  createKagiExtension(fastify)(extApi);
  const tools = getTools(extApi);
  const searchTool = tools.find(t => t.name === 'kagi_search')!;
  const extractTool = tools.find(t => t.name === 'kagi_extract')!;
  const agentStartHandler = getAgentStartHandler(extApi);
  return { fastify, extApi, searchTool, extractTool, agentStartHandler };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('kagi extension', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('KAGI_API_KEY', 'test-api-key');
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
    vi.unstubAllEnvs();
  });

  function stubSearch(results: KagiSearchResult[] = []): void {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeSearchResponse(results)), {
        status: 200
      })
    );
  }

  function stubExtract(url: string, markdown = '# Test Page\n\nContent.'): void {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(makeExtractResponse(url, markdown)), {
        status: 200
      })
    );
  }

  // ── Search ─────────────────────────────────────────────────────────────

  describe('kagi_search', () => {
    it('succeeds within budget and logs the call', async () => {
      const { searchTool, fastify } = setup();
      stubSearch([{ url: 'https://example.com', title: 'Example' }]);

      const result = await searchTool.execute('call-1', { query: 'test' });
      expect(result).toHaveProperty('content');
      expect(getFirstText(result)).toContain('Example');
      expect(fastify.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'kagi_search', query: 'test' }),
        expect.stringContaining('kagi_search')
      );
    });

    it('blocks after the search cap (2 calls)', async () => {
      const { searchTool, fastify } = setup();

      // Call 1: succeeds
      stubSearch([{ url: 'https://a.com', title: 'A' }]);
      await searchTool.execute('call-1', { query: 'first' });

      // Call 2: succeeds
      stubSearch([{ url: 'https://b.com', title: 'B' }]);
      await searchTool.execute('call-2', { query: 'second' });

      // Call 3: blocked
      const result = await searchTool.execute('call-3', { query: 'third' });

      expect(getFirstText(result)).toContain('Budget exhausted');
      expect(getFirstText(result)).toContain('search');
      // Should not have called fetch a third time
      expect(fastify.log.info).toHaveBeenCalledTimes(2);
    });

    it('logs query terms but never response bodies', async () => {
      const { searchTool, fastify } = setup();
      stubSearch([{ url: 'https://x.com', title: 'X', snippet: 'sensitive' }]);

      await searchTool.execute('call-1', { query: 'private search' });

      const logCall = vi.mocked(fastify.log.info).mock.calls[0];
      // The info call should not contain the response body text
      const logged = JSON.stringify(logCall);
      expect(logged).not.toContain('sensitive');
      expect(logged).toContain('private search');
    });
  });

  // ── Extract ────────────────────────────────────────────────────────────

  describe('kagi_extract', () => {
    it('succeeds within budget and logs the call', async () => {
      const { extractTool, fastify } = setup();
      stubExtract('https://example.com', '# Hello\n\nWorld.');

      const result = await extractTool.execute('call-1', {
        url: 'https://example.com'
      });
      expect(result).toHaveProperty('content');
      expect(getFirstText(result)).toContain('Hello');
      expect(fastify.log.info).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'kagi_extract',
          url: 'https://example.com'
        }),
        expect.stringContaining('kagi_extract')
      );
    });

    it('blocks after the extract cap (6 calls)', async () => {
      const { extractTool, fastify } = setup();

      // 6 calls succeed
      for (let i = 0; i < 6; i++) {
        stubExtract(`https://example.com/${i}`);
        await extractTool.execute(`call-${i}`, {
          url: `https://example.com/${i}`
        });
      }

      // 7th call blocked
      const result = await extractTool.execute('call-7', {
        url: 'https://example.com/7'
      });

      expect(getFirstText(result)).toContain('Budget exhausted');
      expect(getFirstText(result)).toContain('extract');
      expect(fastify.log.info).toHaveBeenCalledTimes(6);
    });

    it('logs target URL but never response bodies', async () => {
      const { extractTool, fastify } = setup();
      stubExtract('https://secret.example.com', '# Confidential');

      await extractTool.execute('call-1', {
        url: 'https://secret.example.com'
      });

      const logged = JSON.stringify(
        vi.mocked(fastify.log.info).mock.calls[0]
      );
      expect(logged).toContain('https://secret.example.com');
      expect(logged).not.toContain('Confidential');
    });
  });

  // ── Independent buckets ─────────────────────────────────────────────────

  it('exhausting search does not block extract', async () => {
    const { searchTool, extractTool } = setup();

    // Exhaust search (2 calls)
    stubSearch([{ url: 'https://a.com', title: 'A' }]);
    await searchTool.execute('s1', { query: 'first' });
    stubSearch([{ url: 'https://b.com', title: 'B' }]);
    await searchTool.execute('s2', { query: 'second' });

    // Search is now exhausted
    const blockedSearch = await searchTool.execute('s3', {
      query: 'third'
    });
    expect(getFirstText(blockedSearch)).toContain('Budget exhausted');

    // Extract should still work
    stubExtract('https://example.com');
    const extractResult = await extractTool.execute('e1', {
      url: 'https://example.com'
    });
    expect(getFirstText(extractResult)).toContain('Test Page');
  });

  it('exhausting extract does not block search', async () => {
    const { searchTool, extractTool } = setup();

    // Exhaust extract (6 calls)
    for (let i = 0; i < 6; i++) {
      stubExtract(`https://example.com/${i}`);
      await extractTool.execute(`e${i}`, {
        url: `https://example.com/${i}`
      });
    }

    // Extract is now exhausted
    const blockedExtract = await extractTool.execute('e7', {
      url: 'https://example.com/7'
    });
    expect(getFirstText(blockedExtract)).toContain('Budget exhausted');

    // Search should still work
    stubSearch([{ url: 'https://a.com', title: 'A' }]);
    const searchResult = await searchTool.execute('s1', { query: 'test' });
    expect(getFirstText(searchResult)).toContain('A');
  });

  // ── Budget reset ───────────────────────────────────────────────────────

  it('reset on agent_start restores both buckets', async () => {
    const { searchTool, extractTool, agentStartHandler } = setup();

    // Use one search and one extract
    stubSearch([{ url: 'https://a.com', title: 'A' }]);
    await searchTool.execute('s1', { query: 'first' });
    stubExtract('https://example.com');
    await extractTool.execute('e1', { url: 'https://example.com' });

    // Reset
    expect(agentStartHandler).toBeDefined();
    agentStartHandler!();

    // Should now have a full fresh budget again
    stubSearch([{ url: 'https://b.com', title: 'B' }]);
    const searchResult = await searchTool.execute('s2', { query: 'second' });
    expect(getFirstText(searchResult)).toContain('B');

    // And should be able to do 6 more extracts (spot-check with one)
    stubExtract('https://example.com/2');
    const extractResult = await extractTool.execute('e2', {
      url: 'https://example.com/2'
    });
    expect(getFirstText(extractResult)).toContain('Test Page');
  });

  // ── Missing API key ────────────────────────────────────────────────────

  it('returns friendly message when KAGI_API_KEY is not set', async () => {
    vi.stubEnv('KAGI_API_KEY', '');
    const { searchTool, extractTool } = setup();

    const searchResult = await searchTool.execute('call-1', { query: 'test' });
    expect(getFirstText(searchResult)).toContain('KAGI_API_KEY');
    expect(getFirstText(searchResult)).toContain('.env');

    const extractResult = await extractTool.execute('call-1', {
      url: 'https://example.com'
    });
    expect(getFirstText(extractResult)).toContain('KAGI_API_KEY');
  });

  // ── Registration ───────────────────────────────────────────────────────

  it('registers both tools with custom prompt text', () => {
    const { extApi } = setup();

    expect(extApi.registerTool).toHaveBeenCalledTimes(2);

    const tools = getTools(extApi);
    expect(tools).toHaveLength(2);

    const search = tools.find(t => t.name === 'kagi_search')!;
    expect(search).toBeDefined();
    expect(search.promptSnippet).toContain('Limited calls per message');
    expect(search.promptGuidelines?.some(g => g.includes('limited number'))).toBe(true);

    const extract = tools.find(t => t.name === 'kagi_extract')!;
    expect(extract).toBeDefined();
    expect(extract.promptSnippet).toContain('Each uncached URL costs a paid call');
    expect(extract.promptGuidelines?.some(g => g.includes('limited extract budget'))).toBe(true);
  });

  // ── Error passthrough ──────────────────────────────────────────────────

  it('isError stays false on exhausted budget', async () => {
    const { searchTool } = setup();

    // Exhaust search
    stubSearch([{ url: 'https://a.com', title: 'A' }]);
    await searchTool.execute('s1', { query: 'first' });
    stubSearch([{ url: 'https://b.com', title: 'B' }]);
    await searchTool.execute('s2', { query: 'second' });

    const result = await searchTool.execute('s3', { query: 'third' });
    expect(getResultErrorFlag(result)).toBeFalsy();
  });

  it('isError stays false on missing API key', async () => {
    vi.stubEnv('KAGI_API_KEY', '');
    const { searchTool } = setup();

    const result = await searchTool.execute('call-1', { query: 'test' });
    expect(getResultErrorFlag(result)).toBeFalsy();
  });
});
