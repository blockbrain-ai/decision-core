/**
 * Approval Flow Integration Test — Approval routing, separation of duties,
 * break-glass controls, and approval lifecycle.
 *
 * Proves that:
 * - High-value actions trigger approve_required verdicts
 * - Only authorised approvers can resolve approvals
 * - Self-approval is rejected without valid break-glass
 * - Break-glass requires CEO role, reason, future expiry, and explicit flag
 * - Approval lifecycle transitions are enforced (pending -> terminal, no re-resolve)
 * - approverRole routing uses policy rule config, not hardcoded roles
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { createAgentHttpClient, createAllAgentClients } from '../helpers/agent-http-client.js';
import { loadScenarios, assertStepResult } from '../helpers/scenario-runner.js';
import { resolveApprover, checkSeparationOfDuties } from '../../src/approval/approval-routing.js';
import { InMemoryApprovalRepository } from '../../src/persistence/memory/in-memory-approval.repository.js';
import { loadMeridianFixtures } from '../helpers/org-fixture-loader.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../src/contracts/policy.contracts.js';
import type { ApprovalCreateInput, ApprovalStatus } from '../../src/contracts/approval.contracts.js';
import type { ApprovalRepository } from '../../src/persistence/interfaces/approval.repository.js';

// ---------------------------------------------------------------------------
// Terminal-state guard (domain-level)
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ApprovalStatus[] = ['approved', 'rejected', 'expired', 'cancelled'];

interface ResolveResult {
  ok: boolean;
  error?: string;
}

/**
 * Domain-level guard that prevents re-resolution of terminal approvals.
 * The repository layer is a dumb store; this guard enforces lifecycle rules.
 */
async function resolveApproval(
  repo: ApprovalRepository,
  tenantId: TenantId,
  approvalId: string,
  newStatus: ApprovalStatus,
  resolution: { resolvedBy: string; resolutionNotes: string },
): Promise<ResolveResult> {
  const current = await repo.findById(tenantId, approvalId);
  if (!current) return { ok: false, error: 'Approval not found' };

  if (TERMINAL_STATUSES.includes(current.status)) {
    return {
      ok: false,
      error: `Cannot re-resolve approval in terminal state "${current.status}"`,
    };
  }

  await repo.updateStatus(tenantId, approvalId, newStatus, {
    resolvedBy: resolution.resolvedBy,
    resolvedAt: new Date().toISOString(),
    resolutionNotes: resolution.resolutionNotes,
  });

  return { ok: true };
}

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
const tenantId = 'meridian-systems' as TenantId;

/**
 * Approval-specific policy rules added on top of RBAC rules.
 * The vendor-payment-high rule uses approverRole to route approvals
 * to agents with the 'approver' role rather than hardcoded names.
 */
const APPROVAL_RULES: PolicyRuleCreateInput[] = [
  {
    name: 'vendor-payment-high-approval',
    description: 'High-value vendor payments require approval routed to approver role',
    actionTypePattern: 'vendor-payment-high',
    riskClass: 'C',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 150,
    requiredConstraints: [],
    requireApproval: true,
    defaultVerdict: 'approve_required',
    requiredRoles: ['finance'],
    approverRole: 'approver',
    enabled: true,
  },
  {
    name: 'vendor-payment-high-contractor-deny',
    description: 'Contractors cannot initiate vendor payments',
    actionTypePattern: 'vendor-payment-high',
    riskClass: 'C',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 200,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'deny',
    requiredRoles: ['contractor'],
    enabled: true,
  },
  {
    name: 'custom-approver-route-rule',
    description: 'Strategic initiative requires finance_director approval',
    actionTypePattern: 'strategic-initiative-approve',
    riskClass: 'C',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 120,
    requiredConstraints: [],
    requireApproval: true,
    defaultVerdict: 'approve_required',
    approverRole: 'finance_director',
    enabled: true,
  },
];

beforeAll(async () => {
  server = await createRbacTestServer();
  clients = createAllAgentClients(server.baseUrl());

  // Seed approval-specific rules on top of RBAC rules
  for (const rule of APPROVAL_RULES) {
    await server.policyRuleRepo.create(tenantId, rule);
  }
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
): Promise<{ status: number; eval: EvalData }> {
  const client = clients[agentId];
  const response = await client.post('/evaluate', {
    body: { surfaceId, action },
  });
  const body = response.data as EvalResponse;
  return { status: response.status, eval: body.data };
}

function createTestApprovalInput(overrides?: Partial<ApprovalCreateInput>): ApprovalCreateInput {
  return {
    actionType: 'vendor-payment-high',
    riskClass: 'C',
    status: 'pending',
    priority: 'high',
    requestedBy: 'cfo-agent',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    constraintDrift: false,
    policyRuleId: 'vendor-payment-high-approval',
    actionPayload: { vendorId: 'v-001', amount: 75000 },
    constraintSnapshot: [],
    currentConstraints: [],
    correlationId: `corr-${Date.now()}`,
    assignedToRole: 'approver',
    ...overrides,
  };
}

// ===========================================================================
// 1. YAML scenario suite
// ===========================================================================

describe('approval-scenarios.yaml', () => {
  const scenarios = loadScenarios(
    resolve(__dirname, '../scenarios/org-mode/approval-scenarios.yaml'),
  );

  for (const scenario of scenarios) {
    describe(scenario.name, () => {
      for (const step of scenario.steps) {
        it(step.name, async () => {
          const client = createAgentHttpClient(server.baseUrl(), step.agentId);
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
// 2. Approval routing — approve_required verdicts via HTTP
// ===========================================================================

describe('approval routing via HTTP', () => {
  it('CFO high-value vendor payment returns approve_required', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'vendor-payment-high', 'finance-operations');
    expect(e.verdict).toBe('approve_required');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'vendor-payment-high-approval')).toBe(true);
  });

  it('CEO can resolve approvals (executive + approver)', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'approve-request', 'approval-queue');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'executive-approve-allow')).toBe(true);
  });

  it('product agent cannot resolve finance approval', async () => {
    const { eval: e } = await evaluate('product-agent', 'approve-request', 'approval-queue');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.every((p) => p.ruleName !== 'executive-approve-allow')).toBe(true);
  });

  it('contractor is denied vendor payment initiation', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'vendor-payment-high', 'finance-operations');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'vendor-payment-high-contractor-deny')).toBe(true);
  });
});

// ===========================================================================
// 3. Self-approval rejection (separation of duties)
// ===========================================================================

describe('self-approval rejection', () => {
  it('requester cannot approve their own request without break-glass', () => {
    const result = checkSeparationOfDuties(
      'cfo-agent',
      'cfo-agent',
      ['finance', 'approver'],
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requester cannot approve their own request');
  });

  it('different agent can approve a request', () => {
    const result = checkSeparationOfDuties(
      'cfo-agent',
      'ceo-agent',
      ['executive', 'approver', 'audit_admin'],
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('self-approval denied even with approver role but no break-glass', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requester cannot approve their own request');
  });
});

// ===========================================================================
// 4. Break-glass controls
// ===========================================================================

describe('break-glass controls', () => {
  const futureExpiry = new Date(Date.now() + 3600000).toISOString();
  const pastExpiry = new Date(Date.now() - 3600000).toISOString();

  it('valid break-glass with CEO role, reason, and future expiry is allowed', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
      { reason: 'Emergency vendor payment — sole director available', expiresAt: futureExpiry },
    );
    expect(result.allowed).toBe(true);
  });

  it('break-glass without reason is rejected', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
      { reason: '', expiresAt: futureExpiry },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requires an explicit reason');
  });

  it('break-glass with whitespace-only reason is rejected', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
      { reason: '   ', expiresAt: futureExpiry },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requires an explicit reason');
  });

  it('break-glass with expired timestamp is rejected', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
      { reason: 'Emergency override', expiresAt: pastExpiry },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('valid future expiry timestamp');
  });

  it('break-glass with invalid timestamp is rejected', () => {
    const result = checkSeparationOfDuties(
      'ceo-agent',
      'ceo-agent',
      ['executive', 'approver', 'ceo'],
      { reason: 'Emergency override', expiresAt: 'not-a-date' },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('valid future expiry timestamp');
  });

  it('non-CEO break-glass is rejected (executive role alone insufficient)', () => {
    const result = checkSeparationOfDuties(
      'cfo-agent',
      'cfo-agent',
      ['finance', 'approver'],
      { reason: 'Urgent payment needed', expiresAt: futureExpiry },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requires CEO role');
  });

  it('non-CEO break-glass is rejected even with executive role', () => {
    const result = checkSeparationOfDuties(
      'vp-eng-agent',
      'vp-eng-agent',
      ['engineering', 'deployer'],
      { reason: 'Critical deploy', expiresAt: futureExpiry },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('requires CEO role');
  });
});

// ===========================================================================
// 5. Approval lifecycle — pending -> approved/rejected -> terminal
// ===========================================================================

describe('approval lifecycle', () => {
  let approvalRepo: InMemoryApprovalRepository;

  beforeAll(() => {
    approvalRepo = new InMemoryApprovalRepository();
  });

  it('new approval starts in pending state', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());
    expect(approval.status).toBe('pending');
    expect(approval.resolvedBy).toBeUndefined();
    expect(approval.resolvedAt).toBeUndefined();
  });

  it('pending approval can transition to approved', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());
    const resolved = await approvalRepo.updateStatus(tenantId, approval.id, 'approved', {
      resolvedBy: 'ceo-agent',
      resolvedAt: new Date().toISOString(),
      resolutionNotes: 'Approved by CEO',
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('approved');
    expect(resolved!.resolvedBy).toBe('ceo-agent');
    expect(resolved!.resolutionNotes).toBe('Approved by CEO');
  });

  it('pending approval can transition to rejected', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());
    const resolved = await approvalRepo.updateStatus(tenantId, approval.id, 'rejected', {
      resolvedBy: 'ceo-agent',
      resolvedAt: new Date().toISOString(),
      resolutionNotes: 'Vendor not verified',
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('rejected');
    expect(resolved!.resolvedBy).toBe('ceo-agent');
    expect(resolved!.resolutionNotes).toBe('Vendor not verified');
  });

  it('approved approval cannot be re-resolved to rejected', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());

    // First resolution: pending -> approved
    const first = await resolveApproval(approvalRepo, tenantId, approval.id, 'approved', {
      resolvedBy: 'ceo-agent',
      resolutionNotes: 'Approved',
    });
    expect(first.ok).toBe(true);

    // Second resolution attempt: approved -> rejected — must be rejected
    const second = await resolveApproval(approvalRepo, tenantId, approval.id, 'rejected', {
      resolvedBy: 'ceo-agent',
      resolutionNotes: 'Changed my mind',
    });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('terminal state "approved"');

    // Verify state was not mutated
    const final = await approvalRepo.findById(tenantId, approval.id);
    expect(final!.status).toBe('approved');
    expect(final!.resolutionNotes).toBe('Approved');
  });

  it('rejected approval cannot be re-resolved to approved', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());

    // First resolution: pending -> rejected
    const first = await resolveApproval(approvalRepo, tenantId, approval.id, 'rejected', {
      resolvedBy: 'ceo-agent',
      resolutionNotes: 'Vendor not verified',
    });
    expect(first.ok).toBe(true);

    // Second resolution attempt: rejected -> approved — must be rejected
    const second = await resolveApproval(approvalRepo, tenantId, approval.id, 'approved', {
      resolvedBy: 'ceo-agent',
      resolutionNotes: 'Actually, approve it',
    });
    expect(second.ok).toBe(false);
    expect(second.error).toContain('terminal state "rejected"');

    // Verify state was not mutated
    const final = await approvalRepo.findById(tenantId, approval.id);
    expect(final!.status).toBe('rejected');
    expect(final!.resolutionNotes).toBe('Vendor not verified');
  });

  it('approval records carry correlationId and tenantId (D3 standard)', async () => {
    const input = createTestApprovalInput({ correlationId: 'corr-d3-test' });
    const approval = await approvalRepo.create(tenantId, input);
    expect(approval.correlationId).toBe('corr-d3-test');
    expect(approval.tenantId).toBe(tenantId);
    expect(approval.auditHash).toBeDefined();
    expect(approval.auditHash.length).toBeGreaterThan(0);
  });

  it('approval can be found by ID after creation', async () => {
    const approval = await approvalRepo.create(tenantId, createTestApprovalInput());
    const found = await approvalRepo.findById(tenantId, approval.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(approval.id);
    expect(found!.status).toBe('pending');
  });

  it('approvals can be filtered by status', async () => {
    const repo = new InMemoryApprovalRepository();
    await repo.create(tenantId, createTestApprovalInput());
    const second = await repo.create(tenantId, createTestApprovalInput());
    await repo.updateStatus(tenantId, second.id, 'approved', {
      resolvedBy: 'ceo-agent',
    });

    const pending = await repo.findAll(tenantId, { status: ['pending'] });
    const approved = await repo.findAll(tenantId, { status: ['approved'] });

    expect(pending.length).toBe(1);
    expect(pending[0].status).toBe('pending');
    expect(approved.length).toBe(1);
    expect(approved[0].status).toBe('approved');
  });
});

// ===========================================================================
// 6. approverRole routing from policy rule
// ===========================================================================

describe('approverRole routing from policy rule', () => {
  const fixtures = loadMeridianFixtures();

  it('resolves approver from approverRole in policy rule', async () => {
    // Fetch the vendor-payment-high-approval rule
    const rules = await server.policyRuleRepo.findAll(tenantId);
    const vendorRule = rules.find((r) => r.name === 'vendor-payment-high-approval');
    expect(vendorRule).toBeDefined();
    expect(vendorRule!.approverRole).toBe('approver');

    const target = resolveApprover(vendorRule!, fixtures.agents);
    expect(target).not.toBeNull();
    expect(target!.role).toBe('approver');
    // ceo-agent and cfo-agent both have 'approver' role
    expect(target!.agentIds).toContain('ceo-agent');
    expect(target!.agentIds).toContain('cfo-agent');
  });

  it('routes to custom approverRole not matching standard roles', async () => {
    const rules = await server.policyRuleRepo.findAll(tenantId);
    const customRule = rules.find((r) => r.name === 'custom-approver-route-rule');
    expect(customRule).toBeDefined();
    expect(customRule!.approverRole).toBe('finance_director');

    const target = resolveApprover(customRule!, fixtures.agents);
    // No agents have finance_director role in the fixture — empty result
    expect(target).not.toBeNull();
    expect(target!.role).toBe('finance_director');
    expect(target!.agentIds).toHaveLength(0);
  });

  it('falls back to compliance_officer for compliance policy type', () => {
    const complianceRule = {
      id: 'test-compliance',
      name: 'compliance-check',
      description: 'Compliance verification',
      actionTypePattern: 'compliance-verify',
      riskClass: 'B' as const,
      enforcementPoint: 'pre_decision' as const,
      policyType: 'compliance' as const,
      priority: 100,
      requiredConstraints: [],
      requireApproval: true,
      enabled: true,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const target = resolveApprover(complianceRule, fixtures.agents);
    // No compliance_officer in Meridian fixtures
    expect(target).toBeNull();
  });

  it('falls back to CEO for safety policy type when no approverRole set', () => {
    const safetyRule = {
      id: 'test-safety',
      name: 'safety-check',
      description: 'Safety verification',
      actionTypePattern: 'safety-verify',
      riskClass: 'C' as const,
      enforcementPoint: 'pre_decision' as const,
      policyType: 'safety' as const,
      priority: 100,
      requiredConstraints: [],
      requireApproval: true,
      enabled: true,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Safety falls back to 'ceo' role — but Meridian agents don't have 'ceo' role
    // (CEO agent has 'executive', 'approver', 'audit_admin')
    const target = resolveApprover(safetyRule, fixtures.agents);
    // No agents with literal 'ceo' role → null
    expect(target).toBeNull();
  });

  it('approverRole takes precedence over policyType fallback', () => {
    const ruleWithBoth = {
      id: 'test-override',
      name: 'compliance-with-approver',
      description: 'Compliance with explicit approverRole',
      actionTypePattern: 'compliance-special',
      riskClass: 'B' as const,
      enforcementPoint: 'pre_decision' as const,
      policyType: 'compliance' as const,
      priority: 100,
      requiredConstraints: [],
      requireApproval: true,
      approverRole: 'approver',
      enabled: true,
      tenantId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const target = resolveApprover(ruleWithBoth, fixtures.agents);
    expect(target).not.toBeNull();
    // Uses approverRole 'approver', not compliance_officer fallback
    expect(target!.role).toBe('approver');
    expect(target!.agentIds.length).toBeGreaterThan(0);
  });
});
