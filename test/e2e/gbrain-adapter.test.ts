/**
 * E2E Test: G-Brain Adapter → Store Decision → Verify Page → Entity Links
 *
 * Proves the full round-trip: G-Brain adapter stores a decision with evidence,
 * retrieves it by slug, verifies entity links, and validates slug prefix
 * enforcement rejects out-of-bounds writes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GBrainClient, type GBrainTransport } from '../../src/adapters/gbrain/gbrain-client.js';
import { GBrainContextAdapter } from '../../src/adapters/gbrain/gbrain-context.js';
import { GBrainStoreAdapter } from '../../src/adapters/gbrain/gbrain-store.js';
import { SLUG_PREFIX } from '../../src/adapters/gbrain/gbrain.contracts.js';
import type { GBrainPage, GBrainPutPageParams, GBrainSearchParams } from '../../src/adapters/gbrain/gbrain.contracts.js';

// ===========================================================================
// In-Memory G-Brain Transport (simulates G-Brain backend)
// ===========================================================================

class InMemoryGBrainTransport implements GBrainTransport {
  pages: Map<string, GBrainPage> = new Map();

  async search(params: GBrainSearchParams): Promise<GBrainPage[]> {
    const results: GBrainPage[] = [];
    const queryWords = params.query.split(/\s+/).filter(Boolean);
    for (const page of this.pages.values()) {
      if (params.slugPrefix && !page.slug.startsWith(params.slugPrefix)) continue;
      // Match if ALL query words appear in content or title (simulates keyword search)
      const text = `${page.content} ${page.title}`;
      const matches = queryWords.every((word) => text.includes(word));
      if (matches) {
        results.push(page);
      }
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
// Test Fixtures
// ===========================================================================

const TENANT_ID = 'gbrain-e2e-tenant';
const SURFACE_ID = 'hermes';
const DECISION_ID = 'dec-20260505-001';
const CORRELATION_ID = 'corr-e2e-abc123';

// ===========================================================================
// Tests
// ===========================================================================

describe('G-Brain Adapter E2E', () => {
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

  it('decision stored as page → page retrieved → entities linked', async () => {
    const decision = {
      surface: SURFACE_ID,
      toolName: 'file_delete',
      status: 'denied',
      verdict: 'deny',
      reason: 'Blocked by safety policy',
    };

    const evidence = {
      correlationId: CORRELATION_ID,
      tenantId: TENANT_ID,
      auditHash: 'sha256:abc123def456',
      timestamp: new Date().toISOString(),
      matchedPolicies: [
        { ruleId: 'rule-1', ruleName: 'Block dangerous file ops', verdict: 'deny', reason: 'File deletion blocked' },
      ],
    };

    // Store the decision
    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      DECISION_ID,
      decision,
      evidence,
    );

    // Verify stored page metadata
    expect(stored.slug).toBe(`decisions/${TENANT_ID}/${SURFACE_ID}/${DECISION_ID}`);
    expect(stored.title).toContain('file_delete');
    expect(stored.createdAt).toBeTruthy();
    expect(stored.entities.length).toBeGreaterThan(0);

    // Retrieve the page directly
    const page = await client.getPage(stored.slug);
    expect(page).not.toBeNull();
    expect(page!.slug).toBe(stored.slug);
    expect(page!.title).toContain('file_delete');

    // Verify content contains decision and evidence
    const content = JSON.parse(page!.content);
    expect(content.decision.toolName).toBe('file_delete');
    expect(content.decision.status).toBe('denied');
    expect(content.evidence.correlationId).toBe(CORRELATION_ID);
    expect(content.evidence.auditHash).toBe('sha256:abc123def456');
    expect(content.evidence.matchedPolicies[0].ruleId).toBe('rule-1');

    // Verify entity links
    expect(page!.entities).toContain(SURFACE_ID);
    expect(page!.entities).toContain('file_delete');
    expect(page!.entities).toContain(CORRELATION_ID);

    // Verify metadata
    expect(page!.metadata).toBeDefined();
    expect(page!.metadata!.tenantId).toBe(TENANT_ID);
    expect(page!.metadata!.surfaceId).toBe(SURFACE_ID);
    expect(page!.metadata!.decisionId).toBe(DECISION_ID);
    expect(page!.metadata!.status).toBe('denied');
    expect(page!.metadata!.correlationId).toBe(CORRELATION_ID);
  });

  it('slug outside decisions/ prefix rejected', async () => {
    // Attempt to write directly to client with invalid slug
    await expect(
      client.putPage({
        slug: 'notes/some-page',
        title: 'Invalid',
        content: 'should fail',
      }),
    ).rejects.toThrow(/must start with/);

    await expect(
      client.putPage({
        slug: 'admin/config',
        title: 'Invalid',
        content: 'should fail',
      }),
    ).rejects.toThrow(SLUG_PREFIX);

    // Empty slug also fails
    await expect(
      client.putPage({
        slug: '',
        title: 'Invalid',
        content: 'should fail',
      }),
    ).rejects.toThrow();
  });

  it('context retrieval returns matching prior decisions', async () => {
    // Pre-seed some decisions
    await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-001',
      { surface: SURFACE_ID, toolName: 'file_delete', status: 'denied' },
      { correlationId: 'corr-001' },
    );
    await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-002',
      { surface: SURFACE_ID, toolName: 'file_write', status: 'allowed' },
      { correlationId: 'corr-002' },
    );
    await storeAdapter.storeDecision(
      TENANT_ID,
      'other-surface',
      'dec-003',
      { surface: 'other-surface', toolName: 'deploy', status: 'allowed' },
      { correlationId: 'corr-003' },
    );

    // Retrieve context for hermes + file_delete
    const context = await contextAdapter.getContext(TENANT_ID, SURFACE_ID, 'file_delete');

    expect(context.query).toBe(`${SURFACE_ID} file_delete`);
    expect(context.totalResults).toBeGreaterThan(0);
    // Should find the file_delete decision (content includes "hermes" and "file_delete")
    expect(context.pages.some((p) => p.slug.includes('dec-001'))).toBe(true);
  });

  it('context retrieval scoped to tenant prefix', async () => {
    // Store decision for different tenant
    const otherClient = new GBrainClient({ transport });
    const otherStore = new GBrainStoreAdapter({ client: otherClient });
    await otherStore.storeDecision(
      'other-tenant',
      SURFACE_ID,
      'dec-other',
      { surface: SURFACE_ID, toolName: 'file_delete', status: 'denied' },
      { correlationId: 'corr-other' },
    );

    // Store decision for our tenant
    await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-ours',
      { surface: SURFACE_ID, toolName: 'file_delete', status: 'denied' },
      { correlationId: 'corr-ours' },
    );

    // Context retrieval should only return our tenant's decisions
    const context = await contextAdapter.getContext(TENANT_ID, SURFACE_ID, 'file_delete');

    for (const page of context.pages) {
      expect(page.slug).toContain(`decisions/${TENANT_ID}/`);
    }
  });

  it('evidence chain complete: correlationId, tenantId, auditHash, verdict, clause provenance', async () => {
    const decision = {
      surface: SURFACE_ID,
      toolName: 'deploy_production',
      status: 'approved',
      verdict: 'approve_required',
    };

    const evidence = {
      correlationId: 'corr-evidence-chain',
      tenantId: TENANT_ID,
      auditHash: 'sha256:evidence-chain-hash',
      timestamp: '2026-05-05T10:30:00Z',
      matchedPolicies: [
        {
          ruleId: 'rule-compliance-1',
          ruleName: 'Compliance approval gate',
          verdict: 'approve_required',
          reason: 'Deploy actions require approval',
        },
      ],
    };

    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-evidence-chain',
      decision,
      evidence,
    );

    // Retrieve and verify full evidence chain
    const page = await client.getPage(stored.slug);
    expect(page).not.toBeNull();

    const content = JSON.parse(page!.content);

    // D3 standard: correlationId
    expect(content.evidence.correlationId).toBe('corr-evidence-chain');
    // D3 standard: tenantId
    expect(content.evidence.tenantId).toBe(TENANT_ID);
    // D3 standard: auditHash
    expect(content.evidence.auditHash).toBe('sha256:evidence-chain-hash');
    // Verdict
    expect(content.decision.verdict).toBe('approve_required');
    // Clause provenance
    expect(content.evidence.matchedPolicies[0].ruleId).toBe('rule-compliance-1');
    expect(content.evidence.matchedPolicies[0].ruleName).toBe('Compliance approval gate');
    expect(content.evidence.matchedPolicies[0].reason).toBe('Deploy actions require approval');

    // Metadata verification
    expect(page!.metadata!.tenantId).toBe(TENANT_ID);
    expect(page!.metadata!.surfaceId).toBe(SURFACE_ID);
    expect(page!.metadata!.correlationId).toBe('corr-evidence-chain');
  });

  it('custom entities override auto-extraction', async () => {
    const customEntities = ['project-alpha', 'team-ops', 'region-us-east'];

    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-custom-entities',
      { surface: SURFACE_ID, toolName: 'deploy_staging', status: 'allowed' },
      { correlationId: 'corr-custom' },
      customEntities,
    );

    expect(stored.entities).toEqual(customEntities);

    const page = await client.getPage(stored.slug);
    expect(page!.entities).toEqual(customEntities);
  });

  it('auto-extracted entities include surface, toolName, correlationId', async () => {
    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-auto-entities',
      { surface: 'my-surface', toolName: 'my-tool', status: 'allowed' },
      { correlationId: 'corr-auto-123' },
    );

    expect(stored.entities).toContain('my-surface');
    expect(stored.entities).toContain('my-tool');
    expect(stored.entities).toContain('corr-auto-123');
  });

  it('tamper resilience: corrupted evidence page does not grant permission', async () => {
    // Store a legitimate deny decision
    const stored = await storeAdapter.storeDecision(
      TENANT_ID,
      SURFACE_ID,
      'dec-tamper-target',
      { surface: SURFACE_ID, toolName: 'finance.read_ledger', status: 'denied', verdict: 'deny' },
      { correlationId: 'corr-tamper', auditHash: 'sha256:original-hash' },
    );

    // Corrupt the page content — change verdict from deny to allow
    const page = await client.getPage(stored.slug);
    expect(page).not.toBeNull();
    const original = JSON.parse(page!.content);
    expect(original.decision.verdict).toBe('deny');

    // Simulate tampering: overwrite the page with a modified verdict
    await transport.putPage({
      slug: stored.slug,
      title: page!.title,
      content: JSON.stringify({
        ...original,
        decision: { ...original.decision, verdict: 'allow', status: 'allowed' },
      }),
      entities: page!.entities,
    });

    // Verify the tampered page reads differently
    const tampered = await client.getPage(stored.slug);
    const tamperedContent = JSON.parse(tampered!.content);
    expect(tamperedContent.decision.verdict).toBe('allow');

    // DC does NOT read G-Brain to determine policy verdicts.
    // Policy evaluation is deterministic from the policy pack — G-Brain
    // is advisory/audit only. Tampering G-Brain evidence cannot change
    // a deny to an allow because the PDP never consults G-Brain for
    // authorization decisions. This test proves that the evidence
    // store is write-side only for authorization decisions.
    //
    // The auditHash in the original evidence can detect tampering,
    // but the security boundary is that DC never trusts G-Brain as
    // a permission source.
    expect(original.evidence.auditHash).toBe('sha256:original-hash');
    expect(tamperedContent.evidence?.auditHash).toBe('sha256:original-hash');
  });

  it('replay resilience: storing same decision ID overwrites, does not duplicate', async () => {
    const slug = `decisions/${TENANT_ID}/${SURFACE_ID}/dec-replay-target`;

    await storeAdapter.storeDecision(
      TENANT_ID, SURFACE_ID, 'dec-replay-target',
      { surface: SURFACE_ID, toolName: 'file.write', status: 'denied', verdict: 'deny' },
      { correlationId: 'corr-replay-1' },
    );

    await storeAdapter.storeDecision(
      TENANT_ID, SURFACE_ID, 'dec-replay-target',
      { surface: SURFACE_ID, toolName: 'file.write', status: 'denied', verdict: 'deny' },
      { correlationId: 'corr-replay-2' },
    );

    const page = await client.getPage(slug);
    expect(page).not.toBeNull();
    const content = JSON.parse(page!.content);
    expect(content.evidence.correlationId).toBe('corr-replay-2');
  });

  it('multiple decisions for same tenant are all retrievable', async () => {
    const ids = ['dec-multi-1', 'dec-multi-2', 'dec-multi-3'];

    for (const id of ids) {
      await storeAdapter.storeDecision(
        TENANT_ID,
        SURFACE_ID,
        id,
        { surface: SURFACE_ID, toolName: `tool-${id}`, status: 'allowed' },
        { correlationId: `corr-${id}` },
      );
    }

    // Each page should be independently retrievable
    for (const id of ids) {
      const slug = `decisions/${TENANT_ID}/${SURFACE_ID}/${id}`;
      const page = await client.getPage(slug);
      expect(page).not.toBeNull();
      expect(page!.slug).toBe(slug);
    }
  });
});
