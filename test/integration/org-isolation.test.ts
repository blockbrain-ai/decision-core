/**
 * Information Isolation Integration Test — Access policy boundary enforcement.
 *
 * Proves agents cannot access data outside their permitted classifications.
 * Tests the full isolation matrix: role-classification boundaries, cross-tenant
 * decision record isolation, brain slug guessing prevention, verifyMounts()
 * violation detection, neverAccessibleBy enforcement, and endpoint restrictions
 * for non-audit tokens.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { createAllAgentClients } from '../helpers/agent-http-client.js';
import { loadMeridianFixtures, type MeridianFixtures } from '../helpers/org-fixture-loader.js';
import { createMockGBrainTransport, type MockGBrainTransport } from '../helpers/mock-gbrain-transport.js';
import {
  canAccess,
  verifyMounts,
  getAuthorisedBrains,
} from '../../src/identity/access-policy-loader.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import type { AgentHttpClient } from '../helpers/agent-http-client.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';

// ---------------------------------------------------------------------------
// Server & fixture lifecycle
// ---------------------------------------------------------------------------

let server: OrgTestServerInstance;
let clients: Record<string, AgentHttpClient>;
let fixtures: MeridianFixtures;
let transport: MockGBrainTransport;

beforeAll(async () => {
  server = await createRbacTestServer();
  clients = createAllAgentClients(server.baseUrl());
  fixtures = loadMeridianFixtures();
  transport = createMockGBrainTransport(fixtures.brains);
});

afterAll(async () => {
  await server.close();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

interface EvalData {
  verdict: string;
  matchedPolicies: Array<{
    ruleId: string;
    ruleName: string;
    verdict: string;
    reason: string;
  }>;
}

interface EvalResponse {
  status: string;
  data: EvalData;
}

async function evaluate(
  agentId: string,
  action: string,
  surfaceId = 'test',
): Promise<{ status: number; eval: EvalData }> {
  const client = clients[agentId];
  const response = await client.post('/evaluate', {
    body: { surfaceId, action },
  });
  const body = response.data as EvalResponse;
  return { status: response.status, eval: body.data };
}

// ===========================================================================
// 1. Role-classification boundary tests via HTTP
// ===========================================================================

describe('information isolation boundaries', () => {
  // --- CFO boundaries ---
  it('CFO accesses confidential finance data -> allowed', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'finance-report-read', 'finance-reporting');
    expect(e.verdict).toBe('allow');
  });

  it('CFO accesses HR-restricted data -> denied', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'hr-record-read', 'hr-portal');
    expect(e.verdict).toBe('deny');
  });

  // --- HR Lead boundaries ---
  it('HR lead accesses HR-restricted data -> allowed', async () => {
    const { eval: e } = await evaluate('hr-lead-agent', 'hr-record-read', 'hr-portal');
    expect(e.verdict).toBe('allow');
  });

  it('HR lead accesses confidential finance -> denied', async () => {
    const { eval: e } = await evaluate('hr-lead-agent', 'finance-report-read', 'finance-reporting');
    expect(e.verdict).toBe('deny');
  });

  // --- Product boundaries ---
  it('product accesses confidential finance -> denied', async () => {
    const { eval: e } = await evaluate('product-agent', 'finance-report-read', 'finance-reporting');
    expect(e.verdict).toBe('deny');
  });

  it('product accesses public data -> allowed', async () => {
    const { eval: e } = await evaluate('product-agent', 'public-report-read', 'public-dashboard');
    expect(e.verdict).toBe('allow');
  });

  // --- Contractor boundaries ---
  it('contractor accesses internal -> denied (contractor-deny-finance)', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'finance-report-read', 'finance-reporting');
    expect(e.verdict).toBe('deny');
  });

  it('contractor accesses confidential -> denied', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'hr-record-read', 'hr-portal');
    expect(e.verdict).toBe('deny');
  });

  it('contractor accesses restricted -> denied (deploy)', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'deploy-staging', 'deployment');
    expect(e.verdict).toBe('deny');
  });

  it('contractor accesses public -> allowed', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'public-status-read', 'public-dashboard');
    expect(e.verdict).toBe('allow');
  });

  // --- CEO command-center access ---
  it('CEO accesses command-center -> allowed', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'audit-review', 'governance');
    expect(e.verdict).toBe('allow');
  });
});

// ===========================================================================
// 2. Cross-tenant decision record isolation
// ===========================================================================

describe('cross-tenant decision record isolation', () => {
  const tenantA = 'meridian-systems' as TenantId;
  const tenantB = 'other-corp' as TenantId;

  it('two tenants cannot see each other\'s decision records', async () => {
    const now = new Date().toISOString();

    // Record a decision for tenant A
    await server.decisionLogRepo.append(tenantA, {
      id: 'isolation-rec-a-001',
      surface: 'finance-reporting',
      toolName: 'finance-report-read',
      status: 'generated',
      confidence: 1.0,
      latency: 10,
      input: {},
      output: {},
      correlationId: 'corr-tenant-a-001',
      tenantId: tenantA,
      auditHash: 'hash-a-001',
      createdAt: now,
      updatedAt: now,
    });

    // Record a decision for tenant B
    await server.decisionLogRepo.append(tenantB, {
      id: 'isolation-rec-b-001',
      surface: 'data-export',
      toolName: 'data-export',
      status: 'generated',
      confidence: 1.0,
      latency: 10,
      input: {},
      output: {},
      correlationId: 'corr-tenant-b-001',
      tenantId: tenantB,
      auditHash: 'hash-b-001',
      createdAt: now,
      updatedAt: now,
    });

    // Tenant A can only see their own records
    const tenantARecords = await server.decisionLogRepo.findAll(tenantA);
    const tenantBRecords = await server.decisionLogRepo.findAll(tenantB);

    // Tenant A should not contain tenant B records
    const aHasBRecords = tenantARecords.some(
      (r) => r.correlationId === 'corr-tenant-b-001',
    );
    expect(aHasBRecords).toBe(false);

    // Tenant B should not contain tenant A records
    const bHasARecords = tenantBRecords.some(
      (r) => r.correlationId === 'corr-tenant-a-001',
    );
    expect(bHasARecords).toBe(false);

    // Each tenant sees only their own
    expect(tenantARecords.some((r) => r.correlationId === 'corr-tenant-a-001')).toBe(true);
    expect(tenantBRecords.some((r) => r.correlationId === 'corr-tenant-b-001')).toBe(true);
  });
});

// ===========================================================================
// 3. Mock G-brain transport — brain slug/prefix guessing prevention
// ===========================================================================

describe('brain slug/prefix guessing prevention', () => {
  it('querying an unmounted brain returns no data', () => {
    const result = transport.query({ brainId: 'unmounted-brain' });
    expect(result.mounted).toBe(false);
    expect(result.data).toBeNull();
  });

  it('guessing a non-existent brain slug returns no data', () => {
    const result = transport.query({ brainId: 'guessed-secret-brain' });
    expect(result.mounted).toBe(false);
    expect(result.data).toBeNull();
  });

  it('guessing a brain slug prefix returns no data', () => {
    // Try partial slugs that resemble real brain IDs
    const prefixGuesses = ['ceo-', 'cfo-b', 'finance-', 'hr-lead'];
    for (const guess of prefixGuesses) {
      const result = transport.query({ brainId: guess });
      expect(result.mounted).toBe(false);
      expect(result.data).toBeNull();
    }
  });

  it('mounted brain returns data, unmounted does not', () => {
    // cfo-brain is mounted, unmounted-brain is not
    const mountedResult = transport.query({ brainId: 'cfo-brain' });
    expect(mountedResult.mounted).toBe(true);
    expect(mountedResult.data).not.toBeNull();

    const unmountedResult = transport.query({ brainId: 'unmounted-brain' });
    expect(unmountedResult.mounted).toBe(false);
    expect(unmountedResult.data).toBeNull();
  });

  it('unmounting a brain makes it inaccessible', () => {
    // Mount and query
    transport.mount('unmounted-brain');
    const beforeUnmount = transport.query({ brainId: 'unmounted-brain' });
    expect(beforeUnmount.mounted).toBe(true);

    // Unmount and query again
    transport.unmount('unmounted-brain');
    const afterUnmount = transport.query({ brainId: 'unmounted-brain' });
    expect(afterUnmount.mounted).toBe(false);
    expect(afterUnmount.data).toBeNull();
  });
});

// ===========================================================================
// 4. verifyMounts() — catches unauthorized brain mounts
// ===========================================================================

describe('verifyMounts() unauthorized mount detection', () => {
  it('contractor mounting hr-brain is caught as a violation', () => {
    const violations = verifyMounts(fixtures.accessPolicy, [
      {
        agentId: 'contractor-agent',
        roles: ['contractor'],
        mountedBrains: ['hr-brain'],
      },
    ]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].agentId).toBe('contractor-agent');
    expect(violations[0].brain).toBe('hr-brain');
    expect(violations[0].classification).toBe('hr-restricted');
    expect(violations[0].reason).toContain('neverAccessibleBy');
  });

  it('contractor mounting finance-brain is caught as a violation', () => {
    const violations = verifyMounts(fixtures.accessPolicy, [
      {
        agentId: 'contractor-agent',
        roles: ['contractor'],
        mountedBrains: ['finance-brain'],
      },
    ]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].brain).toBe('finance-brain');
    expect(violations[0].reason).toContain('neverAccessibleBy');
  });

  it('product agent mounting command-center-brain is caught as a violation', () => {
    const violations = verifyMounts(fixtures.accessPolicy, [
      {
        agentId: 'product-agent',
        roles: ['product'],
        mountedBrains: ['command-center-brain'],
      },
    ]);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].brain).toBe('command-center-brain');
    expect(violations[0].classification).toBe('command-center');
    expect(violations[0].reason).toContain('neverAccessibleBy');
  });

  it('CEO mounting all brains produces zero violations', () => {
    const allBrainIds = transport.getAllBrainIds();
    const violations = verifyMounts(fixtures.accessPolicy, [
      {
        agentId: 'ceo-agent',
        roles: ['executive', 'approver', 'audit_admin'],
        mountedBrains: allBrainIds,
      },
    ]);
    expect(violations).toHaveLength(0);
  });

  it('multiple unauthorized mounts are all detected', () => {
    const violations = verifyMounts(fixtures.accessPolicy, [
      {
        agentId: 'contractor-agent',
        roles: ['contractor'],
        mountedBrains: ['hr-brain', 'finance-brain', 'command-center-brain', 'internal-brain'],
      },
    ]);
    // Contractor is in neverAccessibleBy for all four classifications
    expect(violations.length).toBe(4);
    const brainNames = violations.map((v) => v.brain);
    expect(brainNames).toContain('hr-brain');
    expect(brainNames).toContain('finance-brain');
    expect(brainNames).toContain('command-center-brain');
    expect(brainNames).toContain('internal-brain');
  });
});

// ===========================================================================
// 5. neverAccessibleBy enforcement — at least 3 cases
// ===========================================================================

describe('neverAccessibleBy enforcement', () => {
  const policy = loadMeridianFixtures().accessPolicy;

  it('contractor cannot access internal classification', () => {
    expect(canAccess(policy, 'contractor', 'internal')).toBe(false);
  });

  it('product role cannot access hr-restricted classification', () => {
    expect(canAccess(policy, 'product', 'hr-restricted')).toBe(false);
  });

  it('finance_analyst cannot access command-center classification', () => {
    expect(canAccess(policy, 'finance_analyst', 'command-center')).toBe(false);
  });

  it('hr role cannot access confidential-finance classification', () => {
    expect(canAccess(policy, 'hr', 'confidential-finance')).toBe(false);
  });

  it('engineering role cannot access hr-restricted classification', () => {
    expect(canAccess(policy, 'engineering', 'hr-restricted')).toBe(false);
  });

  it('neverAccessibleBy takes precedence — contractor gets no internal brains', () => {
    const brains = getAuthorisedBrains(policy, 'contractor');
    // Contractor should only have public-brain
    expect(brains).toContain('public-brain');
    expect(brains).not.toContain('internal-brain');
    expect(brains).not.toContain('finance-brain');
    expect(brains).not.toContain('hr-brain');
    expect(brains).not.toContain('command-center-brain');
    expect(brains).not.toContain('engineering-brain');
  });

  it('executive role can access all classifications', () => {
    expect(canAccess(policy, 'executive', 'public')).toBe(true);
    expect(canAccess(policy, 'executive', 'internal')).toBe(true);
    expect(canAccess(policy, 'executive', 'confidential-finance')).toBe(true);
    expect(canAccess(policy, 'executive', 'confidential-engineering')).toBe(true);
    expect(canAccess(policy, 'executive', 'hr-restricted')).toBe(true);
    expect(canAccess(policy, 'executive', 'command-center')).toBe(true);
  });
});

// ===========================================================================
// 6. Non-audit staff tokens cannot read /policy, /clauses, /audit, /record
// ===========================================================================

describe('endpoint restrictions for non-audit tokens', () => {
  const restrictedEndpoints = ['/policy', '/clauses', '/audit'];
  const nonAuditAgents = [
    'cfo-agent',
    'finance-analyst-agent',
    'vp-eng-agent',
    'hr-lead-agent',
    'product-agent',
    'contractor-agent',
  ];

  for (const endpoint of restrictedEndpoints) {
    for (const agentId of nonAuditAgents) {
      it(`${agentId} cannot GET ${endpoint}`, async () => {
        const client = clients[agentId];
        const response = await client.get(endpoint);
        expect(response.status).toBe(403);
        const data = response.data as Record<string, unknown>;
        expect(data.code).toBe('FORBIDDEN');
      });
    }
  }

  // /record is POST — test that non-audit tokens cannot create records
  for (const agentId of nonAuditAgents) {
    it(`${agentId} cannot POST /record`, async () => {
      const client = clients[agentId];
      const response = await client.post('/record', {
        body: {
          correlationId: 'test-record-001',
          agentId,
          action: 'test-action',
          verdict: 'allow',
          timestamp: new Date().toISOString(),
          tenantId: 'meridian-systems',
          auditHash: 'test-hash',
          matchedPolicies: [],
        },
      });
      expect(response.status).toBe(403);
      const data = response.data as Record<string, unknown>;
      expect(data.code).toBe('FORBIDDEN');
    });
  }

  // CEO also lacks audit roles in the canReadOrgAudit check
  // (CEO has executive, approver, audit_admin — none of which are in the audit whitelist)
  it('CEO is also denied audit endpoints (executive role not in audit whitelist)', async () => {
    const client = clients['ceo-agent'];
    for (const endpoint of restrictedEndpoints) {
      const response = await client.get(endpoint);
      expect(response.status).toBe(403);
    }
  });
});
