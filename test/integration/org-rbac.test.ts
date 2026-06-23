/**
 * RBAC Integration Test — Role-scoped policy evaluation through HTTP API.
 *
 * Proves that different agents with different roles receive different verdicts
 * for the same action, that roleMatchMode:"all" is enforced, that the SDK
 * skips role-scoped rules when callerRoles is absent, and that the HTTP
 * server ignores client-supplied callerRoles in favour of server-resolved roles.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { createRbacTestServer, RBAC_RULES } from '../helpers/rbac-test-server.js';
import { createAgentHttpClient, createAllAgentClients } from '../helpers/agent-http-client.js';
import { loadScenarios, assertStepResult } from '../helpers/scenario-runner.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';

// ---------------------------------------------------------------------------
// Response types
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

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: OrgTestServerInstance;
let clients: Record<string, ReturnType<typeof createAgentHttpClient>>;

beforeAll(async () => {
  server = await createRbacTestServer();
  clients = createAllAgentClients(server.baseUrl());
});

afterAll(async () => {
  await server.close();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function evaluate(
  agentId: string,
  action: string,
  surfaceId = 'test',
  extraContext?: Record<string, unknown>,
): Promise<{ status: number; eval: EvalData }> {
  const client = clients[agentId];
  const response = await client.post('/evaluate', {
    body: { surfaceId, action, context: extraContext },
  });
  const body = response.data as EvalResponse;
  return { status: response.status, eval: body.data };
}

// ===========================================================================
// 1. YAML scenario suite
// ===========================================================================

describe('rbac-scenarios.yaml', () => {
  let baseUrl = '';

  beforeAll(() => {
    baseUrl = server.baseUrl();
  });

  const scenarios = loadScenarios(
    resolve(__dirname, '../scenarios/org-mode/rbac-scenarios.yaml'),
  );

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      for (const step of scenario.steps) {
        it(step.name, async () => {
          const client = createAgentHttpClient(baseUrl, step.agentId);
          const response = await (step.method === 'GET'
            ? client.get(step.path)
            : client.post(step.path, { body: step.body }));
          assertStepResult(response, step);
        });
      }
    });
  }
});

// ===========================================================================
// 2. Role differentiation — programmatic tests with matchedPolicies
// ===========================================================================

describe('role differentiation with matchedPolicies', () => {
  // --- CFO finance access ---
  it('CFO is allowed finance-report-read with matching policy', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'finance-report-read');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'finance-report-read-allow')).toBe(true);
  });

  // --- Product finance denial ---
  it('product agent is denied finance-report-read via deny-unknown', async () => {
    const { eval: e } = await evaluate('product-agent', 'finance-report-read');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deny-unknown-default')).toBe(true);
  });

  // --- CEO restricted access ---
  it('CEO is allowed approve-request with executive-approve-allow policy', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'approve-request');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'executive-approve-allow')).toBe(true);
  });

  // --- Contractor non-public denial ---
  it('contractor is denied finance-report-read via contractor-deny-finance', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'finance-report-read');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'contractor-deny-finance')).toBe(true);
  });

  // --- Finance analyst limited access ---
  it('finance analyst is allowed finance-summary-read', async () => {
    const { eval: e } = await evaluate('finance-analyst-agent', 'finance-summary-read');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'finance-summary-read-allow')).toBe(true);
  });

  it('finance analyst is denied finance-transfer (requires finance role)', async () => {
    const { eval: e } = await evaluate('finance-analyst-agent', 'finance-transfer');
    expect(e.verdict).toBe('deny');
    // finance-transfer-allow requires 'finance', analyst only has 'finance_analyst'
    expect(e.matchedPolicies.every((p) => p.ruleName !== 'finance-transfer-allow')).toBe(true);
  });

  // --- Engineering deployment access ---
  it('VP Eng is allowed deploy-staging with matching policy', async () => {
    const { eval: e } = await evaluate('vp-eng-agent', 'deploy-staging');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deploy-staging-allow')).toBe(true);
  });

  it('VP Eng deploy-production returns approve_required', async () => {
    const { eval: e } = await evaluate('vp-eng-agent', 'deploy-production');
    expect(e.verdict).toBe('approve_required');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deploy-production-approval')).toBe(true);
  });

  // --- Contractor deny reason strings ---
  it('contractor deny for HR includes contractor-deny-hr reason', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'hr-record-read');
    expect(e.verdict).toBe('deny');
    const hrDeny = e.matchedPolicies.find((p) => p.ruleName === 'contractor-deny-hr');
    expect(hrDeny).toBeDefined();
    expect(hrDeny!.reason).toContain('deny');
  });
});

// ===========================================================================
// 3. roleMatchMode: "all" — at least 3 tests
// ===========================================================================

describe('roleMatchMode: "all"', () => {
  it('CEO allowed approve-request (has BOTH executive AND approver)', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'approve-request');
    expect(e.verdict).toBe('allow');
    const policy = e.matchedPolicies.find((p) => p.ruleName === 'executive-approve-allow');
    expect(policy).toBeDefined();
    expect(policy!.verdict).toBe('allow');
  });

  it('CFO denied approve-request (has approver but NOT executive)', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'approve-request');
    expect(e.verdict).toBe('deny');
    // The executive-approve-allow rule should NOT appear in matchedPolicies
    expect(e.matchedPolicies.every((p) => p.ruleName !== 'executive-approve-allow')).toBe(true);
  });

  it('CEO allowed audit-review (has BOTH executive AND audit_admin)', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'audit-review');
    expect(e.verdict).toBe('allow');
    const policy = e.matchedPolicies.find((p) => p.ruleName === 'audit-review-allow');
    expect(policy).toBeDefined();
    expect(policy!.verdict).toBe('allow');
  });

  it('CFO denied audit-review (lacks both executive and audit_admin)', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'audit-review');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.every((p) => p.ruleName !== 'audit-review-allow')).toBe(true);
  });

  it('VP Eng denied approve-request (has neither executive nor approver)', async () => {
    const { eval: e } = await evaluate('vp-eng-agent', 'approve-request');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.every((p) => p.ruleName !== 'executive-approve-allow')).toBe(true);
  });
});

// ===========================================================================
// 4. SDK-level: role-scoped rules skipped when callerRoles absent
// ===========================================================================

describe('SDK-level callerRoles absence', () => {
  let sdkPdp: PolicyDecisionPoint;
  const tenantId = 'meridian-systems' as TenantId;

  beforeAll(async () => {
    // Create a standalone PDP with the same RBAC rules — no HTTP layer
    const repo = new InMemoryPolicyRuleRepository();
    for (const rule of RBAC_RULES) {
      await repo.create(tenantId, rule);
    }
    sdkPdp = new PolicyDecisionPoint(repo, new NoOpEventService());
  });

  it('role-scoped allow rules are skipped when callerRoles is absent', async () => {
    const result = await sdkPdp.evaluate(tenantId, {
      enforcementPoint: 'pre_decision',
      actionType: 'finance-report-read',
      // callerRoles intentionally absent
    });

    // finance-report-read-allow (requiredRoles: ['finance','finance_analyst'])
    // should NOT appear in matchedPolicies
    const roleRule = result.matchedPolicies.find(
      (p) => p.ruleName === 'finance-report-read-allow',
    );
    expect(roleRule).toBeUndefined();
  });

  it('role-scoped deny rules are skipped when callerRoles is absent', async () => {
    const result = await sdkPdp.evaluate(tenantId, {
      enforcementPoint: 'pre_decision',
      actionType: 'finance-report-read',
      // callerRoles intentionally absent
    });

    // contractor-deny-finance (requiredRoles: ['contractor'])
    // should NOT appear in matchedPolicies
    const denyRule = result.matchedPolicies.find(
      (p) => p.ruleName === 'contractor-deny-finance',
    );
    expect(denyRule).toBeUndefined();
  });

  it('non-role-scoped rules still apply when callerRoles is absent', async () => {
    const result = await sdkPdp.evaluate(tenantId, {
      enforcementPoint: 'pre_decision',
      actionType: 'public-status-read',
      // callerRoles intentionally absent
    });

    // public-read-allow has no requiredRoles — should still match
    const publicRule = result.matchedPolicies.find(
      (p) => p.ruleName === 'public-read-allow',
    );
    expect(publicRule).toBeDefined();
    expect(publicRule!.verdict).toBe('allow');
  });
});

// ===========================================================================
// 5. HTTP-level: body callerRoles ignored, server-resolved roles used
// ===========================================================================

describe('HTTP-level callerRoles ignored', () => {
  it('product agent sending callerRoles:["finance"] is still denied finance access', async () => {
    const client = clients['product-agent'];
    const response = await client.post('/evaluate', {
      body: {
        surfaceId: 'finance-reporting',
        action: 'finance-report-read',
        context: {
          callerRoles: ['finance', 'approver'],
        },
      },
    });

    const body = response.data as EvalResponse;
    expect(response.status).toBe(200);
    // Server resolved product-agent roles ['product'], ignoring body callerRoles
    expect(body.data.verdict).toBe('deny');
  });

  it('contractor sending callerRoles:["executive","approver"] is still denied approval access', async () => {
    const client = clients['contractor-agent'];
    const response = await client.post('/evaluate', {
      body: {
        surfaceId: 'approval-queue',
        action: 'approve-request',
        context: {
          callerRoles: ['executive', 'approver'],
        },
      },
    });

    const body = response.data as EvalResponse;
    expect(response.status).toBe(200);
    // Server resolved contractor-agent roles ['contractor'], ignoring body callerRoles
    expect(body.data.verdict).toBe('deny');
    // Should match contractor-deny-approval, not executive-approve-allow
    expect(body.data.matchedPolicies.some((p) => p.ruleName === 'contractor-deny-approval')).toBe(true);
    expect(body.data.matchedPolicies.every((p) => p.ruleName !== 'executive-approve-allow')).toBe(true);
  });

  it('HR lead sending callerRoles:["finance"] still has HR access', async () => {
    const client = clients['hr-lead-agent'];
    const response = await client.post('/evaluate', {
      body: {
        surfaceId: 'hr-portal',
        action: 'hr-record-read',
        context: {
          callerRoles: ['finance'],
        },
      },
    });

    const body = response.data as EvalResponse;
    expect(response.status).toBe(200);
    // Server resolved hr-lead-agent roles ['hr','people_ops'], ignoring body callerRoles
    expect(body.data.verdict).toBe('allow');
    expect(body.data.matchedPolicies.some((p) => p.ruleName === 'hr-record-read-allow')).toBe(true);
  });
});
