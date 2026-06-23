/**
 * G-Brain Smoke Test — Decision storage and retrieval
 *
 * Verifies the G-Brain integration:
 *   - Store decision page with slug-prefix scoping
 *   - Retrieve context for subsequent decisions
 *   - Verify no out-of-scope slug writes
 *   - Prior decisions inform routing context
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GBrainClient, type GBrainTransport } from '../../src/adapters/gbrain/gbrain-client.js';
import { GBrainStoreAdapter } from '../../src/adapters/gbrain/gbrain-store.js';
import { GBrainContextAdapter } from '../../src/adapters/gbrain/gbrain-context.js';
import type { GBrainPage, GBrainPutPageParams, GBrainSearchParams } from '../../src/adapters/gbrain/gbrain.contracts.js';

// ===========================================================================
// In-Memory G-Brain Transport
// ===========================================================================

class InMemoryGBrainTransport implements GBrainTransport {
  pages: Map<string, GBrainPage> = new Map();

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    const results: GBrainPage[] = [];
    const queryWords = params.query.split(/\s+/).filter(Boolean);
    for (const page of this.pages.values()) {
      if (params.slugPrefix && !page.slug.startsWith(params.slugPrefix)) continue;
      const text = `${page.content} ${page.title}`;
      const matches = queryWords.every((word) => text.includes(word));
      if (matches) results.push(page);
    }
    return results.slice(0, params.limit ?? 10);
  }

  async putPage(params: GBrainPutPageParams): Promise<GBrainPage> {
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
// Tests
// ===========================================================================

const TENANT_ID = 'gbrain-smoke-tenant';
const SURFACE_ID = 'workflow.action_approval';

describe('G-Brain Smoke Test', () => {
  let transport: InMemoryGBrainTransport;
  let client: GBrainClient;
  let storeAdapter: GBrainStoreAdapter;
  let contextAdapter: GBrainContextAdapter;

  beforeEach(() => {
    transport = new InMemoryGBrainTransport();
    client = new GBrainClient({ transport });
    storeAdapter = new GBrainStoreAdapter({ client });
    contextAdapter = new GBrainContextAdapter({ client, maxResults: 10 });
  });

  it('stores decision page with slug-prefix scoping', async () => {
    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-smoke-001',
      {
        surface: SURFACE_ID,
        toolName: 'deploy_production',
        status: 'denied',
        verdict: 'deny',
        reason: 'Safety policy blocked',
      },
      {
        correlationId: 'corr-smoke-001',
        tenantId: TENANT_ID,
        auditHash: 'sha256:smoke001hash',
        timestamp: new Date().toISOString(),
      },
    );

    // Slug uses decisions/ prefix
    expect(stored.slug).toMatch(/^decisions\//);
    expect(stored.slug).toContain(TENANT_ID);
    expect(stored.slug).toContain('dec-smoke-001');

    // Page content is valid JSON with decision and evidence
    const page = await client.getPage(stored.slug);
    expect(page).not.toBeNull();
    const content = JSON.parse(page!.content);
    expect(content.decision.toolName).toBe('deploy_production');
    expect(content.decision.verdict).toBe('deny');
    expect(content.evidence.correlationId).toBe('corr-smoke-001');
    expect(content.evidence.auditHash).toBe('sha256:smoke001hash');
  });

  it('retrieves context for subsequent decisions (prior decisions inform routing)', async () => {
    // Store multiple decisions
    await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-ctx-001',
      { surface: SURFACE_ID, toolName: 'deploy_staging', status: 'allowed', verdict: 'allow' },
      { correlationId: 'corr-ctx-001' },
    );
    await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-ctx-002',
      { surface: SURFACE_ID, toolName: 'deploy_production', status: 'denied', verdict: 'deny' },
      { correlationId: 'corr-ctx-002' },
    );

    // Retrieve context for a deploy decision
    const context = await contextAdapter.getContext(TENANT_ID, SURFACE_ID, 'deploy_production');

    expect(context.totalResults).toBeGreaterThan(0);
    // Should find the prior deploy_production decision
    expect(context.pages.some((p) => p.slug.includes('dec-ctx-002'))).toBe(true);
  });

  it('rejects out-of-scope slug writes (no writes outside decisions/ prefix)', async () => {
    await expect(
      client.putPage({
        slug: 'notes/my-page',
        title: 'Out of scope',
        content: 'should fail',
      }),
    ).rejects.toThrow(/must start with/);

    await expect(
      client.putPage({
        slug: 'admin/config',
        title: 'Out of scope',
        content: 'should fail',
      }),
    ).rejects.toThrow();
  });

  it('decision storage includes entity links for searchability', async () => {
    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-entities-001',
      { surface: SURFACE_ID, toolName: 'transfer_funds', status: 'allowed', verdict: 'allow' },
      { correlationId: 'corr-entities-001' },
    );

    // Auto-extracted entities include surface, toolName, correlationId
    expect(stored.entities).toContain(SURFACE_ID);
    expect(stored.entities).toContain('transfer_funds');
    expect(stored.entities).toContain('corr-entities-001');
  });
});
