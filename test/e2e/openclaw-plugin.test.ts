/**
 * E2E Test: OpenCLAW Plugin → SDK → Decision Core → Approve/Block
 *
 * Proves the full round-trip: OpenCLAW plugin sends before_tool_call via direct
 * SDK import, Decision Core evaluates policy, plugin returns requireApproval or
 * block directive. Approval resolution propagates back with evidence chain.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import {
  makeBeforeToolCallHook,
  mapVerdictToHookResult,
  type ToolCallContext,
} from '../../integrations/openclaw/before-tool-call.js';
import { ApprovalBridge, type AuditSink } from '../../integrations/openclaw/approval-bridge.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyGuard } from '../../src/surfaces/sdk/types.js';
import type { PolicyVerdict } from '../../src/contracts/policy.contracts.js';

// ===========================================================================
// Test Fixtures
// ===========================================================================

const TENANT_ID = 'openclaw-e2e-tenant' as TenantId;
const SURFACE_ID = 'openclaw';

function createApprovalRequiredRule() {
  return {
    name: 'Compliance approval gate',
    description: 'Require approval for deploy actions',
    actionTypePattern: 'deploy_*',
    riskClass: 'B' as const,
    enforcementPoint: 'pre_decision' as const,
    policyType: 'compliance' as const,
    priority: 80,
    requiredConstraints: [],
    requireApproval: true,
    enabled: true,
  };
}

function createDenyRule() {
  return {
    name: 'Safety block destructive ops',
    description: 'Deny all destructive operations when confidence below threshold',
    actionTypePattern: 'destroy_*',
    riskClass: 'A' as const,
    enforcementPoint: 'pre_decision' as const,
    policyType: 'safety' as const,
    priority: 100,
    minConfidence: 1.0, // any confidence < 1.0 triggers deny
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
  };
}

function createAllowRule() {
  return {
    name: 'Allow read actions',
    description: 'Allow all read actions',
    actionTypePattern: 'read_*',
    riskClass: 'C' as const,
    enforcementPoint: 'pre_decision' as const,
    policyType: 'business' as const,
    priority: 50,
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
  };
}

// ===========================================================================
// Mock Audit Sink
// ===========================================================================

class MockAuditSink implements AuditSink {
  entries: Array<{
    surfaceId: string;
    toolName: string;
    operationType: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }> = [];

  record(entry: {
    surfaceId: string;
    toolName: string;
    operationType: string;
    payload: Record<string, unknown>;
    correlationId: string;
  }): void {
    this.entries.push(entry);
  }
}

// ===========================================================================
// Tests
// ===========================================================================

describe('OpenCLAW Plugin E2E', () => {
  let policyRuleRepo: InMemoryPolicyRuleRepository;
  let pdp: PolicyDecisionPoint;
  let guard: PolicyGuard;
  let auditSink: MockAuditSink;
  let approvalBridge: ApprovalBridge;

  beforeEach(async () => {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    const eventService = new NoOpEventService();
    pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
    auditSink = new MockAuditSink();
    approvalBridge = new ApprovalBridge(SURFACE_ID, auditSink);

    // Create a PolicyGuard wrapping the PDP
    guard = {
      async evaluate(tenantId: string, _surfaceId: string, action: string, context?: Record<string, unknown>): Promise<PolicyVerdict> {
        // Extract confidence from nested args (as hook passes { args: toolParams })
        const args = context?.args as Record<string, unknown> | undefined;
        return pdp.evaluate(tenantId as TenantId, {
          enforcementPoint: 'pre_decision',
          actionType: action,
          financialImpact: (args?.financialImpact ?? context?.financialImpact) as number | undefined,
          dataQualityScore: (args?.dataQualityScore ?? context?.dataQualityScore) as number | undefined,
          confidence: (args?.confidence ?? context?.confidence) as number | undefined,
          autonomyLevel: (args?.autonomyLevel ?? context?.autonomyLevel) as number | undefined,
        });
      },
    };
  });

  it('plugin sends before_tool_call → Decision Core requires approval → plugin returns requireApproval', async () => {
    await policyRuleRepo.create(TENANT_ID, createApprovalRequiredRule());

    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
      approvalTimeoutMs: 60_000,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: { target: 'prod', region: 'us-east-1' },
    };

    const result = await hook(ctx);

    // Verify requireApproval result
    expect('requireApproval' in result).toBe(true);
    const approval = (result as { requireApproval: { title: string; description: string; severity: string; timeoutMs: number; timeoutBehavior: string; onResolution: (decision: string) => void } }).requireApproval;
    expect(approval.title).toContain('deploy_production');
    expect(approval.description).toBeTruthy();
    expect(approval.severity).toBe('critical'); // compliance rule → critical (OpenClaw enum)
    expect(approval.timeoutMs).toBe(60_000);
    expect(approval.timeoutBehavior).toBe('deny');
  });

  it('approval resolution propagates back to Decision Core audit', async () => {
    await policyRuleRepo.create(TENANT_ID, createApprovalRequiredRule());

    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
      approvalTimeoutMs: 60_000,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: { target: 'prod' },
    };

    const result = await hook(ctx);
    expect('requireApproval' in result).toBe(true);

    // Simulate approval resolution (as OpenCLAW would invoke it)
    const approval = (result as { requireApproval: { onResolution: (decision: string) => void } }).requireApproval;
    approval.onResolution('allow-once');

    // Verify audit entry was recorded
    expect(auditSink.entries.length).toBe(1);
    const entry = auditSink.entries[0];
    expect(entry.surfaceId).toBe(SURFACE_ID);
    expect(entry.toolName).toBe('deploy_production');
    expect(entry.operationType).toBe('approval_resolution');
    expect(entry.payload.approved).toBe(true);
    expect(entry.payload.verdict).toBe('approve_required');
    expect(entry.correlationId).toBeTruthy();

    // Verify resolution recorded in bridge
    const resolutions = approvalBridge.getResolutions();
    expect(resolutions.length).toBe(1);
    expect(resolutions[0].approved).toBe(true);
    expect(resolutions[0].toolName).toBe('deploy_production');
    expect(resolutions[0].correlationId).toBeTruthy();
    expect(resolutions[0].resolvedAt).toBeTruthy();
  });

  it('rejection resolution propagates back with approved=false', async () => {
    await policyRuleRepo.create(TENANT_ID, createApprovalRequiredRule());

    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: {},
    };

    const result = await hook(ctx);
    const approval = (result as { requireApproval: { onResolution: (decision: string) => void } }).requireApproval;
    approval.onResolution('deny');

    const entry = auditSink.entries[0];
    expect(entry.payload.approved).toBe(false);
    expect(entry.payload.verdict).toBe('approve_required');

    const resolutions = approvalBridge.getResolutions();
    expect(resolutions[0].approved).toBe(false);
  });

  it('deny verdict → plugin returns block with reason', async () => {
    await policyRuleRepo.create(TENANT_ID, createDenyRule());

    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
    });

    const ctx: ToolCallContext = {
      toolName: 'destroy_database',
      toolParams: { database: 'production', confidence: 0.5 },
    };

    const result = await hook(ctx);

    expect('block' in result).toBe(true);
    const block = result as { block: true; blockReason: string };
    expect(block.block).toBe(true);
    expect(block.blockReason).toBeTruthy();
  });

  it('allow verdict → plugin returns pass', async () => {
    await policyRuleRepo.create(TENANT_ID, createAllowRule());

    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
    });

    const ctx: ToolCallContext = {
      toolName: 'read_file',
      toolParams: { path: '/data/report.csv' },
    };

    const result = await hook(ctx);

    expect('pass' in result).toBe(true);
    expect((result as { pass: true }).pass).toBe(true);
  });

  it('fail-closed: evaluation error → plugin blocks', async () => {
    // Create a guard that throws
    const failingGuard: PolicyGuard = {
      async evaluate(): Promise<PolicyVerdict> {
        throw new Error('SDK connection failed');
      },
    };

    const hook = makeBeforeToolCallHook({
      guard: failingGuard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: {},
    };

    const result = await hook(ctx);

    expect('block' in result).toBe(true);
    const block = result as { block: true; blockReason: string };
    expect(block.blockReason).toContain('fail-closed');
  });

  it('fail-open: evaluation error → plugin passes', async () => {
    const failingGuard: PolicyGuard = {
      async evaluate(): Promise<PolicyVerdict> {
        throw new Error('SDK connection failed');
      },
    };

    const hook = makeBeforeToolCallHook({
      guard: failingGuard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'open',
      approvalBridge,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: {},
    };

    const result = await hook(ctx);

    expect('pass' in result).toBe(true);
  });

  it('evidence chain: matched policies carry ruleId, ruleName, verdict, reason', async () => {
    await policyRuleRepo.create(TENANT_ID, createApprovalRequiredRule());

    const verdict = await guard.evaluate(TENANT_ID, SURFACE_ID, 'deploy_staging');

    expect(verdict.verdict).toBe('approve_required');
    expect(verdict.matchedPolicies.length).toBeGreaterThan(0);
    for (const policy of verdict.matchedPolicies) {
      expect(policy.ruleId).toBeTruthy();
      expect(policy.ruleName).toBeTruthy();
      expect(policy.verdict).toBe('approve_required');
      expect(policy.reason).toBeTruthy();
    }
  });

  it('severity mapping: safety/compliance rules → critical (OpenClaw enum)', async () => {
    // Test with compliance rule
    await policyRuleRepo.create(TENANT_ID, createApprovalRequiredRule());
    const complianceVerdict = await guard.evaluate(TENANT_ID, SURFACE_ID, 'deploy_production');
    const complianceResult = mapVerdictToHookResult(complianceVerdict, 'deploy_production', approvalBridge, 300_000);
    expect('requireApproval' in complianceResult).toBe(true);
    const complianceApproval = (complianceResult as { requireApproval: { severity: string } }).requireApproval;
    expect(complianceApproval.severity).toBe('critical');

    // Create safety rule that requires approval
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Safety approval for nuke',
      description: 'Require approval before nuclear option',
      actionTypePattern: 'nuke_*',
      riskClass: 'A' as const,
      enforcementPoint: 'pre_decision' as const,
      policyType: 'safety' as const,
      priority: 100,
      requiredConstraints: [],
      requireApproval: true,
      enabled: true,
    });
    const safetyVerdict = await guard.evaluate(TENANT_ID, SURFACE_ID, 'nuke_site');
    const safetyResult = mapVerdictToHookResult(safetyVerdict, 'nuke_site', approvalBridge, 300_000);
    expect('requireApproval' in safetyResult).toBe(true);
    const safetyApproval = (safetyResult as { requireApproval: { severity: string } }).requireApproval;
    expect(safetyApproval.severity).toBe('critical');
  });
});
