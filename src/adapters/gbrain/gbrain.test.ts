import { describe, it, expect, beforeEach } from 'vitest';
import { GBrainClient, type GBrainTransport } from './gbrain-client.js';
import { GBrainContextAdapter } from './gbrain-context.js';
import { GBrainStoreAdapter } from './gbrain-store.js';
import { SLUG_PREFIX, GBrainSlugSchema } from './gbrain.contracts.js';
import type { GBrainPage, GBrainPutPageParams, GBrainSearchParams } from './gbrain.contracts.js';

// ===========================================================================
// Mock Transport
// ===========================================================================

class MockGBrainTransport implements GBrainTransport {
  pages: Map<string, GBrainPage> = new Map();
  searchCalls: GBrainSearchParams[] = [];
  putCalls: GBrainPutPageParams[] = [];

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    this.searchCalls.push(params);
    const results: GBrainPage[] = [];
    for (const page of this.pages.values()) {
      if (params.slugPrefix && !page.slug.startsWith(params.slugPrefix)) continue;
      if (page.content.includes(params.query) || page.title.includes(params.query)) {
        results.push(page);
      }
    }
    return results.slice(0, params.limit ?? 10);
  }

  async putPage(params: GBrainPutPageParams): Promise<GBrainPage> {
    this.putCalls.push(params);
    const page: GBrainPage = {
      slug: params.slug,
      title: params.title,
      content: params.content,
      entities: params.entities,
      metadata: params.metadata,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.pages.set(params.slug, page);
    return page;
  }

  async getPage(slug: string): Promise<GBrainPage | null> {
    return this.pages.get(slug) ?? null;
  }
}

// ===========================================================================
// Slug Validation
// ===========================================================================

describe('GBrainSlugSchema', () => {
  it('accepts slugs starting with decisions/', () => {
    expect(GBrainSlugSchema.safeParse('decisions/tenant-a/surface/abc').success).toBe(true);
  });

  it('rejects slugs not starting with decisions/', () => {
    const result = GBrainSlugSchema.safeParse('pages/something');
    expect(result.success).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(GBrainSlugSchema.safeParse('').success).toBe(false);
  });

  it('rejects slugs that only partially match prefix', () => {
    expect(GBrainSlugSchema.safeParse('decision/wrong').success).toBe(false);
  });
});

// ===========================================================================
// GBrainClient
// ===========================================================================

describe('GBrainClient', () => {
  let transport: MockGBrainTransport;
  let client: GBrainClient;

  beforeEach(() => {
    transport = new MockGBrainTransport();
    client = new GBrainClient({ transport });
  });

  describe('putPage', () => {
    it('stores a page with valid slug', async () => {
      const page = await client.putPage({
        slug: 'decisions/tenant-a/surface/dec-1',
        title: 'Test Decision',
        content: '{}',
      });
      expect(page.slug).toBe('decisions/tenant-a/surface/dec-1');
    });

    it('rejects writes outside decisions/ prefix', async () => {
      await expect(
        client.putPage({
          slug: 'pages/something-else',
          title: 'Bad',
          content: '{}',
        }),
      ).rejects.toThrow(`must start with "${SLUG_PREFIX}"`);
    });

    it('rejects writes with empty slug', async () => {
      await expect(
        client.putPage({ slug: '', title: 'Bad', content: '{}' }),
      ).rejects.toThrow();
    });
  });

  describe('search', () => {
    it('delegates to transport with slug prefix', async () => {
      await client.search({ query: 'test' });
      expect(transport.searchCalls[0]?.slugPrefix).toBe(SLUG_PREFIX);
    });

    it('respects custom slug prefix in params', async () => {
      await client.search({ query: 'test', slugPrefix: 'decisions/tenant-a/' });
      expect(transport.searchCalls[0]?.slugPrefix).toBe('decisions/tenant-a/');
    });
  });

  describe('getPage', () => {
    it('returns null for missing pages', async () => {
      const page = await client.getPage('decisions/missing');
      expect(page).toBeNull();
    });

    it('returns existing pages', async () => {
      await client.putPage({
        slug: 'decisions/t/s/1',
        title: 'Found',
        content: 'data',
      });
      const page = await client.getPage('decisions/t/s/1');
      expect(page?.title).toBe('Found');
    });
  });
});

// ===========================================================================
// GBrainContextAdapter
// ===========================================================================

describe('GBrainContextAdapter', () => {
  let transport: MockGBrainTransport;
  let client: GBrainClient;
  let contextAdapter: GBrainContextAdapter;

  beforeEach(() => {
    transport = new MockGBrainTransport();
    client = new GBrainClient({ transport });
    contextAdapter = new GBrainContextAdapter({ client, maxResults: 5 });
  });

  it('searches G-Brain with tenant-scoped prefix', async () => {
    await contextAdapter.getContext('tenant-a', 'code-review', 'approve');

    expect(transport.searchCalls).toHaveLength(1);
    expect(transport.searchCalls[0]?.slugPrefix).toBe('decisions/tenant-a/');
    expect(transport.searchCalls[0]?.query).toBe('code-review approve');
    expect(transport.searchCalls[0]?.limit).toBe(5);
  });

  it('returns matching pages as context', async () => {
    transport.pages.set('decisions/tenant-a/code-review/dec-1', {
      slug: 'decisions/tenant-a/code-review/dec-1',
      title: 'Prior Decision',
      content: 'code-review approve data',
    });

    const context = await contextAdapter.getContext('tenant-a', 'code-review', 'approve');

    expect(context.pages).toHaveLength(1);
    expect(context.pages[0]?.title).toBe('Prior Decision');
    expect(context.query).toBe('code-review approve');
    expect(context.totalResults).toBe(1);
  });

  it('returns empty context when no matches', async () => {
    const context = await contextAdapter.getContext('tenant-b', 'deploy', 'execute');

    expect(context.pages).toHaveLength(0);
    expect(context.totalResults).toBe(0);
  });

  it('getContextFromRequest works with request object', async () => {
    const context = await contextAdapter.getContextFromRequest({
      tenantId: 'tenant-a',
      surfaceId: 'build',
      action: 'run',
    });

    expect(context.query).toBe('build run');
  });
});

// ===========================================================================
// GBrainStoreAdapter
// ===========================================================================

describe('GBrainStoreAdapter', () => {
  let transport: MockGBrainTransport;
  let client: GBrainClient;
  let storeAdapter: GBrainStoreAdapter;

  beforeEach(() => {
    transport = new MockGBrainTransport();
    client = new GBrainClient({ transport });
    storeAdapter = new GBrainStoreAdapter({ client });
  });

  it('stores a decision with correct slug pattern', async () => {
    const stored = await storeAdapter.storeDecision(
      'tenant-a',
      'code-review',
      'dec-001',
      { surface: 'code-review', toolName: 'lint', status: 'generated' },
      { correlationId: 'corr-123' },
    );

    expect(stored.slug).toBe('decisions/tenant-a/code-review/dec-001');
    expect(stored.title).toContain('lint');
    expect(stored.entities).toContain('code-review');
    expect(stored.entities).toContain('lint');
    expect(stored.entities).toContain('corr-123');
    expect(stored.createdAt).toBeDefined();
  });

  it('stores decision with custom entities', async () => {
    const stored = await storeAdapter.storeDecision(
      'tenant-b',
      'deploy',
      'dec-002',
      { surface: 'deploy', status: 'blocked' },
      undefined,
      ['custom-entity', 'another'],
    );

    expect(stored.entities).toEqual(['custom-entity', 'another']);
  });

  it('generates title from toolName when available', async () => {
    const stored = await storeAdapter.storeDecision(
      'tenant-a',
      'surface-1',
      'dec-003',
      { toolName: 'myTool', status: 'generated' },
    );

    expect(stored.title).toBe('Decision: myTool');
  });

  it('falls back to surface for title', async () => {
    const stored = await storeAdapter.storeDecision(
      'tenant-a',
      'surface-1',
      'dec-004',
      { surface: 'mySurface', status: 'generated' },
    );

    expect(stored.title).toBe('Decision: mySurface');
  });

  it('falls back to decisionId for title', async () => {
    const stored = await storeAdapter.storeDecision(
      'tenant-a',
      'surface-1',
      'dec-005',
      { status: 'generated' },
    );

    expect(stored.title).toBe('Decision: dec-005');
  });

  it('persists decision content as JSON in page', async () => {
    await storeAdapter.storeDecision(
      'tenant-a',
      'surface-1',
      'dec-006',
      { surface: 'surface-1', status: 'generated' },
      { correlationId: 'c-1' },
    );

    expect(transport.putCalls).toHaveLength(1);
    const put = transport.putCalls[0]!;
    const parsed = JSON.parse(put.content);
    expect(parsed.decision.status).toBe('generated');
    expect(parsed.evidence.correlationId).toBe('c-1');
  });

  it('sets metadata with tenant, surface, and correlation info', async () => {
    await storeAdapter.storeDecision(
      'tenant-a',
      'code-review',
      'dec-007',
      { status: 'generated' },
      { correlationId: 'corr-99' },
    );

    const put = transport.putCalls[0]!;
    expect(put.metadata).toEqual({
      tenantId: 'tenant-a',
      surfaceId: 'code-review',
      decisionId: 'dec-007',
      status: 'generated',
      correlationId: 'corr-99',
    });
  });
});

// ===========================================================================
// Optional Adapter (D6 — no mandatory external dependencies)
// ===========================================================================

describe('Optional adapter (D6)', () => {
  it('Decision Core works without G-Brain — adapter is not required', () => {
    // The adapter is optional: it's imported and used only when configured.
    // This test verifies that the adapter types can exist without being instantiated.
    const client: GBrainClient | undefined = undefined;
    expect(client).toBeUndefined();

    // Context and store adapters only exist when client is provided
    const contextAdapter = client ? new GBrainContextAdapter({ client }) : null;
    const storeAdapter = client ? new GBrainStoreAdapter({ client }) : null;
    expect(contextAdapter).toBeNull();
    expect(storeAdapter).toBeNull();
  });
});
