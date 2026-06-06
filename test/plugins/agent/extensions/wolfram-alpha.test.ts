import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { FastifyInstance } from 'fastify';
import createWolframAlphaExtension from '../../../../src/plugins/agent/extensions/wolfram-alpha.js';

function createMockExtensionAPI(): ExtensionAPI & {
  _tools: { name: string; execute: Function }[];
} {
  const tools: { name: string; execute: Function }[] = [];
  return {
    registerTool: vi.fn(tool => tools.push(tool)),
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerShortcut: vi.fn(),
    registerFlag: vi.fn(),
    _tools: tools
  } as unknown as ExtensionAPI & { _tools: typeof tools };
}

function getTools(extApi: ExtensionAPI) {
  return (
    extApi as unknown as { _tools: { name: string; execute: Function }[] }
  )._tools;
}

function createMockFastify(): FastifyInstance {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  } as unknown as FastifyInstance;
}

describe('wolfram_alpha tool', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('WOLFRAM_ALPHA_APPID', 'test-app-id');
  });

  afterEach(() => {
    vi.stubGlobal('fetch', originalFetch);
    vi.unstubAllEnvs();
  });

  function setup() {
    const fastify = createMockFastify();
    const extApi = createMockExtensionAPI();
    createWolframAlphaExtension(fastify)(extApi);
    const tools = getTools(extApi);
    const tool = tools.find(t => t.name === 'wolfram_alpha')!;
    return { fastify, tool };
  }

  it('returns Wolfram response text on success', async () => {
    const { tool } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('The population of Japan is about 125 million.', { status: 200 })
    );

    const result = await tool.execute('call-1', { input: 'population of Japan' });
    expect(result.content[0].text).toContain('125 million');
  });

  it('returns configuration error when env var is missing', async () => {
    vi.unstubAllEnvs();
    const { tool } = setup();

    const result = await tool.execute('call-1', { input: 'population of Japan' });
    expect(result.content[0].text).toContain('not configured');
    expect(result.isError).toBe(true);
  });

  it('returns helpful error on HTTP 501 (uninterpretable input)', async () => {
    const { tool } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('Did you mean: population of japan', { status: 501 })
    );

    const result = await tool.execute('call-1', { input: 'popln of japn' });
    expect(result.content[0].text).toContain('could not interpret');
    expect(result.isError).toBe(true);
  });

  it('returns configuration error on HTTP 403 (invalid AppID)', async () => {
    const { tool } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('Unauthorized', { status: 403 })
    );

    const result = await tool.execute('call-1', { input: 'population of Japan' });
    expect(result.content[0].text).toContain('API key is invalid');
    expect(result.isError).toBe(true);
  });

  it('returns error text when fetch throws', async () => {
    const { tool, fastify } = setup();

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error('network failure')
    );

    const result = await tool.execute('call-1', { input: 'population of Japan' });
    expect(result.content[0].text).toContain('network failure');
    expect(result.isError).toBe(true);
    expect(fastify.log.error).toHaveBeenCalled();
  });

  it('returns parameter error on HTTP 400', async () => {
    const { tool } = setup();

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('Bad Request', { status: 400 })
    );

    const result = await tool.execute('call-1', { input: 'population of Japan' });
    expect(result.content[0].text).toContain('rejected');
    expect(result.isError).toBe(true);
  });
});
