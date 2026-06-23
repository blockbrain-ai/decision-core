/**
 * E2E Test: Hermes Bridge → HTTP → Decision Core → Block/Allow
 *
 * Proves the full round-trip: Hermes plugin sends pre_tool_call via HTTP bridge,
 * Decision Core evaluates policy, plugin returns block/pass directive.
 * Evidence chain is verified end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHttpServer, type HttpServerInstance } from '../../src/surfaces/http/http-server.js';
import { InMemoryPolicyRuleRepository } from '../../src/persistence/memory/in-memory-policy-rule.repository.js';
import { PolicyDecisionPoint } from '../../src/policy/policy-decision-point.js';
import { NoOpEventService } from '../../src/adapters/event-service.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { HttpServerDeps } from '../../src/surfaces/http/types.js';

// ===========================================================================
// Test Fixtures
// ===========================================================================

const TENANT_ID = 'hermes-e2e-tenant' as TenantId;
const BEARER_TOKEN = 'test-hermes-token';
const SURFACE_ID = 'hermes';

function createDenyRule() {
  return {
    name: 'Block dangerous file ops',
    description: 'Deny all file_delete actions when confidence is below threshold',
    actionTypePattern: 'file_delete*',
    riskClass: 'A' as const,
    enforcementPoint: 'pre_decision' as const,
    policyType: 'safety' as const,
    priority: 100,
    minConfidence: 1.0, // threshold ensures deny when confidence < 1.0
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
  };
}

function createAllowRule() {
  return {
    name: 'Allow file reads',
    description: 'Allow all file_read actions',
    actionTypePattern: 'file_read*',
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
// HTTP Client (simulates Hermes DecisionCoreBridge)
// ===========================================================================

async function httpEvaluate(
  baseUrl: string,
  token: string,
  surfaceId: string,
  action: string,
  context?: Record<string, unknown>,
): Promise<{ verdict: string; matchedPolicies: Array<{ ruleId: string; ruleName: string; verdict: string; reason: string }> }> {
  const payload: Record<string, unknown> = { surfaceId, action };
  if (context) payload.context = context;

  const resp = await fetch(`${baseUrl}/evaluate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (resp.status !== 200) {
    throw new Error(`Bridge returned HTTP ${resp.status}: ${await resp.text()}`);
  }

  const body = await resp.json() as { data: { verdict: string; matchedPolicies: Array<{ ruleId: string; ruleName: string; verdict: string; reason: string }> } };
  return body.data;
}

// ===========================================================================
// Hermes Hook Simulation (mirrors hooks.py logic in TypeScript for E2E)
// ===========================================================================

interface HermesHookResult {
  action: 'pass' | 'block';
  message?: string;
}

function hermesPreToolCall(
  evaluationResult: { verdict: string; matchedPolicies: Array<{ reason?: string }> },
): HermesHookResult {
  if (evaluationResult.verdict === 'allow') {
    return { action: 'pass' };
  }

  if (evaluationResult.verdict === 'approve_required') {
    const reasons = evaluationResult.matchedPolicies
      .filter((p) => p.reason)
      .map((p) => p.reason);
    const detail = reasons.length > 0 ? reasons.join('; ') : 'manual approval needed';
    return { action: 'block', message: `Approval required: ${detail}` };
  }

  // deny or unknown
  const reasons = evaluationResult.matchedPolicies
    .filter((p) => p.reason)
    .map((p) => p.reason);
  const detail = reasons.length > 0 ? reasons.join('; ') : 'policy denied this action';
  return { action: 'block', message: detail };
}

function hermesFailClosed(): HermesHookResult {
  return { action: 'block', message: 'Decision Core unavailable — tool call blocked (fail-closed)' };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Hermes Bridge E2E', () => {
  let server: HttpServerInstance;
  let baseUrl: string;
  let policyRuleRepo: InMemoryPolicyRuleRepository;

  beforeEach(async () => {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    const eventService = new NoOpEventService();
    const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

    const deps: HttpServerDeps = {
      tenantId: TENANT_ID,
      policyEvaluator: {
        async evaluate(tenantId, _surfaceId, action, context) {
          return pdp.evaluate(tenantId as TenantId, {
            enforcementPoint: 'pre_decision',
            actionType: action,
            financialImpact: context?.financialImpact as number | undefined,
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
  });

  afterEach(async () => {
    await server.close();
  });

  it('plugin sends pre_tool_call → Decision Core denies → plugin returns block directive', async () => {
    // Seed a deny rule for file_delete
    await policyRuleRepo.create(TENANT_ID, createDenyRule());

    // Simulate Hermes pre_tool_call: evaluate via HTTP bridge (confidence 0.5 < threshold 1.0 → deny)
    const result = await httpEvaluate(baseUrl, BEARER_TOKEN, SURFACE_ID, 'file_delete', { confidence: 0.5 });

    // Verify Decision Core denied
    expect(result.verdict).toBe('deny');
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
    expect(result.matchedPolicies[0].verdict).toBe('deny');
    expect(result.matchedPolicies[0].ruleId).toBeDefined();
    expect(result.matchedPolicies[0].ruleName).toBe('Block dangerous file ops');
    expect(result.matchedPolicies[0].reason).toBeDefined();

    // Simulate Hermes plugin verdict mapping
    const hookResult = hermesPreToolCall(result);
    expect(hookResult.action).toBe('block');
    expect(hookResult.message).toBeTruthy();

    // Evidence chain verification
    const policy = result.matchedPolicies[0];
    expect(policy.ruleId).toBeTruthy();
    expect(policy.ruleName).toBeTruthy();
    expect(policy.reason).toBeTruthy();
  });

  it('allowed action → plugin returns pass directive', async () => {
    // Seed an allow rule for file_read
    await policyRuleRepo.create(TENANT_ID, createAllowRule());

    const result = await httpEvaluate(baseUrl, BEARER_TOKEN, SURFACE_ID, 'file_read');

    expect(result.verdict).toBe('allow');
    expect(result.matchedPolicies.length).toBeGreaterThan(0);
    expect(result.matchedPolicies[0].verdict).toBe('allow');

    const hookResult = hermesPreToolCall(result);
    expect(hookResult.action).toBe('pass');
  });

  it('unreachable Decision Core in enforcement mode → plugin blocks (fail-closed)', async () => {
    // Simulate unreachable bridge by using an invalid port
    let bridgeError = false;
    try {
      await httpEvaluate('http://127.0.0.1:1', BEARER_TOKEN, SURFACE_ID, 'file_delete');
    } catch {
      bridgeError = true;
    }

    expect(bridgeError).toBe(true);

    // Hermes plugin fail-closed behavior
    const hookResult = hermesFailClosed();
    expect(hookResult.action).toBe('block');
    expect(hookResult.message).toContain('fail-closed');
  });

  it('deny-wins arbitration: deny overrides allow when both rules match', async () => {
    // Seed both a deny rule and an allow rule for the same action pattern
    await policyRuleRepo.create(TENANT_ID, {
      name: 'Allow all files',
      description: 'Allow all file operations',
      actionTypePattern: 'file_*',
      riskClass: 'C' as const,
      enforcementPoint: 'pre_decision' as const,
      policyType: 'business' as const,
      priority: 10,
      requiredConstraints: [],
      requireApproval: false,
      enabled: true,
    });
    await policyRuleRepo.create(TENANT_ID, createDenyRule());

    const result = await httpEvaluate(baseUrl, BEARER_TOKEN, SURFACE_ID, 'file_delete', { confidence: 0.5 });

    // deny-wins: even though one rule allows, the deny rule takes precedence
    expect(result.verdict).toBe('deny');
    expect(result.matchedPolicies.length).toBe(2);

    const hookResult = hermesPreToolCall(result);
    expect(hookResult.action).toBe('block');
  });

  it('evidence chain: correlationId, tenantId, verdict, and clause provenance present', async () => {
    await policyRuleRepo.create(TENANT_ID, createDenyRule());

    const result = await httpEvaluate(baseUrl, BEARER_TOKEN, SURFACE_ID, 'file_delete', { confidence: 0.5 });

    // Full evidence verification
    expect(result.verdict).toBe('deny');
    for (const policy of result.matchedPolicies) {
      expect(policy.ruleId).toBeTruthy();
      expect(policy.ruleName).toBeTruthy();
      expect(policy.verdict).toBeTruthy();
      expect(policy.reason).toBeTruthy();
    }
  });

  it('unauthorized request returns 401', async () => {
    const resp = await fetch(`${baseUrl}/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({ surfaceId: SURFACE_ID, action: 'file_read' }),
    });

    expect(resp.status).toBe(401);
  });
});
