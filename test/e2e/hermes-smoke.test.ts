/**
 * Hermes Smoke Test — Plugin blocks dangerous action
 *
 * Verifies the Hermes agent integration:
 *   - pre_tool_call with dangerous tool → Decision Core blocks
 *   - pre_tool_call with safe tool → Decision Core allows
 *   - post_tool_call → audit recorded
 *   - Evidence chain verified for blocked decision
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer, type HttpServerInstance } from '../../src/surfaces/http/http-server.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { HttpServerDeps } from '../../src/surfaces/http/types.js';

// ===========================================================================
// Fixtures
// ===========================================================================

const TENANT_ID = 'hermes-smoke-tenant' as TenantId;
const BEARER_TOKEN = 'smoke-hermes-token';
const SURFACE_ID = 'hermes';

// ===========================================================================
// Hermes Plugin Simulation
// ===========================================================================

interface HermesHookResult {
  action: 'pass' | 'block';
  message?: string;
}

interface AuditEntry {
  toolName: string;
  verdict: string;
  timestamp: string;
}

class HermesPluginSimulator {
  auditLog: AuditEntry[] = [];

  preToolCall(evaluation: { verdict: string; matchedPolicies: Array<{ reason?: string }> }): HermesHookResult {
    if (evaluation.verdict === 'allow') {
      return { action: 'pass' };
    }
    const reasons = evaluation.matchedPolicies
      .filter((p) => p.reason)
      .map((p) => p.reason);
    return { action: 'block', message: reasons.join('; ') || 'policy denied' };
  }

  postToolCall(toolName: string, verdict: string): void {
    this.auditLog.push({
      toolName,
      verdict,
      timestamp: new Date().toISOString(),
    });
  }
}

// ===========================================================================
// HTTP Evaluate Helper
// ===========================================================================

async function httpEvaluate(
  baseUrl: string,
  action: string,
  context?: Record<string, unknown>,
): Promise<{ verdict: string; matchedPolicies: Array<{ ruleId: string; ruleName: string; verdict: string; reason: string }> }> {
  const payload: Record<string, unknown> = { surfaceId: SURFACE_ID, action };
  if (context) payload.context = context;

  const resp = await fetch(`${baseUrl}/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BEARER_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (resp.status !== 200) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  const body = await resp.json() as { data: { verdict: string; matchedPolicies: Array<{ ruleId: string; ruleName: string; verdict: string; reason: string }> } };
  return body.data;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Hermes Smoke Test', () => {
  let server: HttpServerInstance;
  let baseUrl: string;
  let policyRuleRepo: InMemoryPolicyRuleRepository;
  let plugin: HermesPluginSimulator;

  beforeEach(async () => {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    plugin = new HermesPluginSimulator();
    const eventService = new NoOpEventService();
    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

    const deps: HttpServerDeps = {
      tenantId: TENANT_ID,
      policyEvaluator: {
        async evaluate(tenantId, _surfaceId, action, context) {
          return pdp.evaluate(tenantId as TenantId, {
            enforcementPoint: 'pre_decision',
            actionType: action,
            confidence: context?.confidence as number | undefined,
          });
        },
      },
      policyRuleRepo,
      decisionLogRepo: {
        async findAll() { return []; },
        async findByCorrelationId() { return []; },
      },
    };

    server = await createHttpServer(deps, { bearerToken: BEARER_TOKEN, port: 0 });
    const addr = server.address()!;
    baseUrl = `http://${addr.host}:${addr.port}`;

    // Seed rules: block file_delete, allow file_read
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Block dangerous file ops',
      description: 'Deny file_delete actions',
      actionTypePattern: 'file_delete*',
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
      name: 'Allow file reads',
      description: 'Allow all file_read actions',
      actionTypePattern: 'file_read*',
      riskClass: 'C',
      enforcementPoint: 'pre_decision',
      policyType: 'business',
      priority: 50,
      requiredConstraints: [],
      requireApproval: false,
      enabled: true,
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('pre_tool_call blocks dangerous action (file_delete)', async () => {
    const result = await httpEvaluate(baseUrl, 'file_delete', { confidence: 0.5 });

    expect(result.verdict).toBe('deny');
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
    expect(result.matchedPolicies[0].ruleName).toBe('Block dangerous file ops');

    const hookResult = plugin.preToolCall(result);
    expect(hookResult.action).toBe('block');
    expect(hookResult.message).toBeTruthy();
  });

  it('pre_tool_call allows safe action (file_read)', async () => {
    const result = await httpEvaluate(baseUrl, 'file_read');

    expect(result.verdict).toBe('allow');

    const hookResult = plugin.preToolCall(result);
    expect(hookResult.action).toBe('pass');
  });

  it('post_tool_call records audit entry', async () => {
    const result = await httpEvaluate(baseUrl, 'file_delete', { confidence: 0.5 });

    // Simulate post_tool_call audit recording
    plugin.postToolCall('file_delete', result.verdict);

    expect(plugin.auditLog.length).toBe(1);
    expect(plugin.auditLog[0].toolName).toBe('file_delete');
    expect(plugin.auditLog[0].verdict).toBe('deny');
    expect(plugin.auditLog[0].timestamp).toBeTruthy();
  });

  it('evidence chain verified for blocked decision', async () => {
    const result = await httpEvaluate(baseUrl, 'file_delete', { confidence: 0.5 });

    // Verify evidence completeness
    expect(result.verdict).toBe('deny');
    for (const policy of result.matchedPolicies) {
      expect(policy.ruleId).toBeTruthy();
      expect(policy.ruleName).toBeTruthy();
      expect(policy.verdict).toBe('deny');
      expect(policy.reason).toBeTruthy();
    }
  });
});
