/**
 * OpenCLAW Smoke Test — Plugin block/approve mapping
 *
 * Verifies the OpenCLAW agent integration:
 *   - before_tool_call → block for denied actions
 *   - before_tool_call → requireApproval for approval-required actions
 *   - before_tool_call → pass for allowed actions
 *   - after_tool_call → audit recorded via approval bridge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import {
  makeBeforeToolCallHook,
  type ToolCallContext,
} from '../../integrations/openclaw/before-tool-call.js';
import { ApprovalBridge, type AuditSink } from '../../integrations/openclaw/approval-bridge.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyGuard } from '../../src/surfaces/sdk/types.js';
import type { PolicyVerdict } from '../../src/contracts/policy.contracts.js';

// ===========================================================================
// Fixtures
// ===========================================================================

const TENANT_ID = 'openclaw-smoke-tenant' as TenantId;
const SURFACE_ID = 'openclaw';

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

describe('OpenCLAW Smoke Test', () => {
  let policyRuleRepo: InMemoryPolicyRuleRepository;
  let guard: PolicyGuard;
  let auditSink: MockAuditSink;
  let approvalBridge: ApprovalBridge;

  beforeEach(async () => {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    const eventService = new NoOpEventService();
    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
    auditSink = new MockAuditSink();
    approvalBridge = new ApprovalBridge(SURFACE_ID, auditSink);

    guard = {
      async evaluate(tenantId: string, _surfaceId: string, action: string, context?: Record<string, unknown>): Promise<PolicyVerdict> {
        const args = context?.args as Record<string, unknown> | undefined;
        return pdp.evaluate(tenantId as TenantId, {
          enforcementPoint: 'pre_decision',
          actionType: action,
          confidence: (args?.confidence ?? context?.confidence) as number | undefined,
        });
      },
    };

    // Seed rules
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Block destructive ops',
      description: 'Deny destroy actions',
      actionTypePattern: 'destroy_*',
      riskClass: 'A',
      enforcementPoint: 'pre_decision',
      policyType: 'safety',
      priority: 100,
      minConfidence: 1.0,
      requiredConstraints: [],
      requireApproval: false,
      enabled: true,
    });
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Compliance approval for deploy',
      description: 'Require approval for deploy actions',
      actionTypePattern: 'deploy_*',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'compliance',
      priority: 80,
      requiredConstraints: [],
      requireApproval: true,
      enabled: true,
    });
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Allow reads',
      description: 'Allow read actions',
      actionTypePattern: 'read_*',
      riskClass: 'C',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: 50,
      requiredConstraints: [],
      requireApproval: false,
      enabled: true,
    });
  });

  it('blocks dangerous action (destroy_database)', async () => {
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

  it('requires approval for deploy action', async () => {
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
      approvalTimeoutMs: 30_000,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_production',
      toolParams: { target: 'prod' },
    };

    const result = await hook(ctx);

    expect('requireApproval' in result).toBe(true);
    const approval = (result as { requireApproval: { title: string; severity: string; timeoutMs: number; timeoutBehavior: string } }).requireApproval;
    expect(approval.title).toContain('deploy_production');
    expect(approval.severity).toBe('critical'); // OpenClaw enum: info|warning|critical
    expect(approval.timeoutMs).toBe(30_000);
    expect(approval.timeoutBehavior).toBe('deny');
  });

  it('allows safe action (read_file)', async () => {
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

  it('after_tool_call records audit via approval bridge', async () => {
    const hook = makeBeforeToolCallHook({
      guard,
      tenantId: TENANT_ID,
      surfaceId: SURFACE_ID,
      failMode: 'closed',
      approvalBridge,
      approvalTimeoutMs: 60_000,
    });

    const ctx: ToolCallContext = {
      toolName: 'deploy_staging',
      toolParams: { target: 'staging' },
    };

    const result = await hook(ctx);
    expect('requireApproval' in result).toBe(true);

    // Simulate approval resolution (OpenClaw resolves with an enum, not a boolean)
    const approval = (result as { requireApproval: { onResolution: (decision: string) => void } }).requireApproval;
    approval.onResolution('allow-once');

    // Verify audit was recorded
    expect(auditSink.entries.length).toBe(1);
    expect(auditSink.entries[0].surfaceId).toBe(SURFACE_ID);
    expect(auditSink.entries[0].toolName).toBe('deploy_staging');
    expect(auditSink.entries[0].operationType).toBe('approval_resolution');
    expect(auditSink.entries[0].payload.approved).toBe(true);
    expect(auditSink.entries[0].correlationId).toBeTruthy();
  });
});
