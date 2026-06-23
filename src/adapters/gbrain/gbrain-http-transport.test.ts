import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GBrainHttpTransport } from './gbrain-http-transport.js';

const TOKEN_RESPONSE = {
  access_token: 'gbrain_at_test_token_123',
  token_type: 'Bearer',
  expires_in: 3600,
  scope: 'read write',
};

function mcpResult(data: unknown) {
  return {
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: JSON.stringify(data) }],
    },
  };
}

function mcpError(code: number, message: string) {
  return { jsonrpc: '2.0', id: 1, error: { code, message } };
}

describe('GBrainHttpTransport', () => {
  let transport: GBrainHttpTransport;
  let fetchCalls: Array<{ url: string; init: RequestInit }>;
  let fetchResponses: Array<{ status: number; body: unknown }>;

  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];

    vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
      fetchCalls.push({ url: url.toString(), init: init ?? {} });
      const next = fetchResponses.shift();
      if (!next) throw new Error(`Unexpected fetch call to ${url}`);
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => next.body,
        text: async () => JSON.stringify(next.body),
      };
    });

    transport = new GBrainHttpTransport({
      baseUrl: 'http://127.0.0.1:3131',
      clientId: 'gbrain_cl_test',
      clientSecret: 'gbrain_cs_secret',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('token exchange', () => {
    it('exchanges client_credentials before first call', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult({ slug: 'decisions/t/s/1' }) });

      await transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' });

      expect(fetchCalls[0]!.url).toBe('http://127.0.0.1:3131/token');
      const tokenBody = fetchCalls[0]!.init.body as URLSearchParams;
      expect(tokenBody.get('grant_type')).toBe('client_credentials');
      expect(tokenBody.get('client_id')).toBe('gbrain_cl_test');
    });

    it('reuses cached token for subsequent calls', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult({}) });
      fetchResponses.push({ status: 200, body: mcpResult({}) });

      await transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' });
      await transport.putPage({ slug: 'decisions/t/s/2', title: 'T2', content: '{}' });

      // Only one token exchange, two MCP calls
      expect(fetchCalls).toHaveLength(3);
      expect(fetchCalls[0]!.url).toContain('/token');
      expect(fetchCalls[1]!.url).toContain('/mcp');
      expect(fetchCalls[2]!.url).toContain('/mcp');
    });

    it('throws on token exchange failure', async () => {
      fetchResponses.push({ status: 401, body: { error: 'invalid_client' } });

      await expect(
        transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' }),
      ).rejects.toThrow('token exchange failed');
    });
  });

  describe('putPage', () => {
    it('calls put_page MCP tool with correct params', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult({ slug: 'decisions/t/s/1' }) });

      const page = await transport.putPage({
        slug: 'decisions/t/s/1',
        title: 'Test Decision',
        content: '{"verdict":"allow"}',
        entities: ['agent-a', 'public.read'],
        metadata: { tenantId: 't' },
      });

      expect(page.slug).toBe('decisions/t/s/1');
      expect(page.title).toBe('Test Decision');

      const mcpBody = JSON.parse(fetchCalls[1]!.init.body as string);
      expect(mcpBody.method).toBe('tools/call');
      expect(mcpBody.params.name).toBe('put_page');
      expect(mcpBody.params.arguments.slug).toBe('decisions/t/s/1');
    });

    it('includes Authorization header with Bearer token', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult({}) });

      await transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' });

      const headers = fetchCalls[1]!.init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer gbrain_at_test_token_123');
    });
  });

  describe('search', () => {
    it('calls search MCP tool and returns pages', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({
        status: 200,
        body: mcpResult([
          { slug: 'decisions/t/s/1', title: 'Result 1', content: 'data', created_at: '2026-01-01' },
        ]),
      });

      const pages = await transport.search({ query: 'finance', limit: 5 });

      expect(pages).toHaveLength(1);
      expect(pages[0]!.slug).toBe('decisions/t/s/1');
      expect(pages[0]!.title).toBe('Result 1');
    });

    it('returns empty array for non-array results', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult(null) });

      const pages = await transport.search({ query: 'nothing' });
      expect(pages).toEqual([]);
    });
  });

  describe('getPage', () => {
    it('returns page when found', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({
        status: 200,
        body: mcpResult({ slug: 'decisions/t/s/1', title: 'Found', compiled_truth: 'data' }),
      });

      const page = await transport.getPage('decisions/t/s/1');

      expect(page?.slug).toBe('decisions/t/s/1');
      expect(page?.content).toBe('data');
    });

    it('returns null on MCP error', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpError(-32602, 'Page not found') });

      const page = await transport.getPage('decisions/missing');
      expect(page).toBeNull();
    });

    it('returns null on network failure', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 500, body: 'Internal Server Error' });

      const page = await transport.getPage('decisions/error');
      expect(page).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws on MCP-level error for putPage', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpError(-32603, 'Internal error') });

      await expect(
        transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' }),
      ).rejects.toThrow('MCP error for put_page: Internal error');
    });

    it('throws on HTTP error for MCP call', async () => {
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 503, body: 'Service Unavailable' });

      await expect(
        transport.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' }),
      ).rejects.toThrow('MCP call failed for put_page (HTTP 503)');
    });
  });

  describe('baseUrl normalization', () => {
    it('strips trailing slash from baseUrl', async () => {
      const t = new GBrainHttpTransport({
        baseUrl: 'http://localhost:3131/',
        clientId: 'c',
        clientSecret: 's',
      });
      fetchResponses.push({ status: 200, body: TOKEN_RESPONSE });
      fetchResponses.push({ status: 200, body: mcpResult({}) });

      await t.putPage({ slug: 'decisions/t/s/1', title: 'T', content: '{}' });

      expect(fetchCalls[0]!.url).toBe('http://localhost:3131/token');
      expect(fetchCalls[1]!.url).toBe('http://localhost:3131/mcp');
    });
  });
});
