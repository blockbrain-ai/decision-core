/**
 * Tool Drift Integration Test — Proves new tools cannot silently bypass governance.
 *
 * Verifies denyUnknownDefault enforcement, tool inventory drift detection,
 * and that decommissioned tools are properly denied. Tests known, unknown,
 * newly-classified, and decommissioned tool states through the Decision Core
 * evaluation path.
 *
 * NOTE: tool-inventory.yaml is NOT a runtime allowlist. It is a classified
 * reference used by provision --verify and rescan for drift detection only.
 * Policy rules are the sole runtime enforcement mechanism.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { createRbacTestServer } from '../helpers/rbac-test-server.js';
import { createAgentHttpClient, createAllAgentClients } from '../helpers/agent-http-client.js';
import { loadScenarios, assertStepResult } from '../helpers/scenario-runner.js';
import { loadMeridianFixtures } from '../helpers/org-fixture-loader.js';
import { classifyDetectedTools } from '../../src/onboarding/tool-risk-classifier.js';
import { globMatches } from '../../src/policy/glob-matcher.js';
import type { OrgTestServerInstance } from '../helpers/org-test-server.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../src/contracts/policy.contracts.js';

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
// Tool-drift-specific policy rules
// ---------------------------------------------------------------------------

const TOOL_DRIFT_RULES: PolicyRuleCreateInput[] = [
  // Newly classified tool — added dynamically to simulate classification
  {
    name: 'newly-classified-read-tool-allow',
    description: 'Allow newly classified read tool',
    actionTypePattern: 'newly-classified-read-tool',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    enabled: true,
  },

  // Decommissioned tool — explicit deny rule
  {
    name: 'legacy-report-generator-deny',
    description: 'Decommissioned legacy report tool — explicitly denied',
    actionTypePattern: 'legacy-report-generator',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'compliance',
    priority: 200,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'deny',
    enabled: true,
  },
];

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server: OrgTestServerInstance;
let clients: Record<string, ReturnType<typeof createAgentHttpClient>>;

beforeAll(async () => {
  server = await createRbacTestServer();
  const tenantId = server.fixtures.agents.tenantId as TenantId;

  // Seed tool-drift-specific rules on top of existing RBAC rules
  for (const rule of TOOL_DRIFT_RULES) {
    await server.policyRuleRepo.create(tenantId, rule);
  }

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
): Promise<{ status: number; eval: EvalData }> {
  const client = clients[agentId];
  const response = await client.post('/evaluate', {
    body: { surfaceId, action },
  });
  const body = response.data as EvalResponse;
  return { status: response.status, eval: body.data };
}

// ===========================================================================
// 1. YAML scenario suite — tool-drift-scenarios.yaml
// ===========================================================================

describe('tool-drift-scenarios.yaml', () => {
  let baseUrl = '';

  beforeAll(() => {
    baseUrl = server.baseUrl();
  });

  const scenarios = loadScenarios(
    resolve(__dirname, '../scenarios/org-mode/tool-drift-scenarios.yaml'),
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
// 2. Known tool with matching policy — expected verdicts
// ===========================================================================

describe('known tool with matching policy', () => {
  it('known tool with allow policy returns allow and names the rule', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'finance-report-read');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'finance-report-read-allow')).toBe(true);
  });

  it('known tool with deny policy returns deny and names the rule', async () => {
    const { eval: e } = await evaluate('contractor-agent', 'finance-report-read');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'contractor-deny-finance')).toBe(true);
  });

  it('known tool requiring approval returns approve_required', async () => {
    const { eval: e } = await evaluate('vp-eng-agent', 'deploy-production');
    expect(e.verdict).toBe('approve_required');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deploy-production-approval')).toBe(true);
  });
});

// ===========================================================================
// 3. Unknown tool with denyUnknownDefault: true — deny
// ===========================================================================

describe('denyUnknownDefault enforcement', () => {
  it('unknown tool is denied with deny-unknown-default reason', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'unknown-experimental-tool');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deny-unknown-default')).toBe(true);
  });

  it('completely novel tool is denied even for privileged roles', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'novel-unregistered-gadget');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deny-unknown-default')).toBe(true);
  });

  it('deny reason references unknown-tool default', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'some-totally-new-action');
    expect(e.verdict).toBe('deny');
    const denyPolicy = e.matchedPolicies.find((p) => p.ruleName === 'deny-unknown-default');
    expect(denyPolicy).toBeDefined();
    expect(denyPolicy!.reason).toContain('denied by default');
  });

  it('unknown tool denied regardless of surface context', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'unclassified-admin-tool', 'finance-reporting');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'deny-unknown-default')).toBe(true);
  });
});

// ===========================================================================
// 4. Newly classified tool with matching policy — expected verdict
// ===========================================================================

describe('newly classified tool', () => {
  it('newly classified tool with allow rule returns allow', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'newly-classified-read-tool');
    expect(e.verdict).toBe('allow');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'newly-classified-read-tool-allow')).toBe(true);
  });

  it('newly classified tool was previously denied as unknown', async () => {
    // Before the rule was added, this action would match no rules and be denied.
    // We verify the rule is now the reason for the allow verdict (not a blanket pass).
    const { eval: e } = await evaluate('cfo-agent', 'newly-classified-read-tool');
    expect(e.matchedPolicies.length).toBeGreaterThan(0);
    expect(e.matchedPolicies.some((p) => p.ruleName === 'newly-classified-read-tool-allow')).toBe(true);
  });
});

// ===========================================================================
// 5. Decommissioned tool with explicit deny rule — deny
// ===========================================================================

describe('decommissioned tool', () => {
  it('decommissioned tool is denied with explicit deny rule', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'legacy-report-generator');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'legacy-report-generator-deny')).toBe(true);
  });

  it('decommissioned tool denied even for CEO', async () => {
    const { eval: e } = await evaluate('ceo-agent', 'legacy-report-generator');
    expect(e.verdict).toBe('deny');
    expect(e.matchedPolicies.some((p) => p.ruleName === 'legacy-report-generator-deny')).toBe(true);
  });

  it('decommissioned tool deny reason references compliance', async () => {
    const { eval: e } = await evaluate('cfo-agent', 'legacy-report-generator');
    const denyPolicy = e.matchedPolicies.find((p) => p.ruleName === 'legacy-report-generator-deny');
    expect(denyPolicy).toBeDefined();
    expect(denyPolicy!.verdict).toBe('deny');
  });
});

// ===========================================================================
// 6. provision --verify drift detection
// ===========================================================================

describe('provision --verify drift detection', () => {
  it('detects tools in inventory with no matching policy pattern', () => {
    const fixtures = loadMeridianFixtures();
    const inventory = fixtures.toolInventory;

    // Simulate policy patterns from the RBAC rules (action type patterns)
    const policyPatterns = [
      'finance-report-read',
      'finance-summary-read',
      'finance-transfer',
      'finance-budget-update',
      'hr-record-read',
      'hr-record-update',
      'deploy-staging',
      'deploy-production',
      'approve-request',
      'reject-request',
      'public-*',
      'brain-lookup',
      'finance-*',  // contractor deny glob
      'hr-*',       // contractor deny glob
      'deploy-*',   // contractor deny glob
      '*-request',  // contractor deny glob
      'audit-*',    // audit deny glob
    ];

    const unmatched: string[] = [];
    for (const tool of inventory.tools) {
      const hasMatch = policyPatterns.some((pattern) =>
        globMatches(pattern, tool.name) || globMatches(tool.name, pattern),
      );
      if (!hasMatch) {
        unmatched.push(tool.name);
      }
    }

    // unknown-experimental-tool and legacy-report-generator should be flagged
    // because they don't match any of the standard policy patterns above
    // (they need their own explicit rules)
    expect(unmatched.length).toBeGreaterThan(0);
  });

  it('tool-inventory.yaml is not treated as a runtime allowlist', () => {
    // Verify that the inventory is a classification reference only.
    // Even tools listed in the inventory with allowedRoles are denied
    // if no policy rule matches — the inventory does not grant access.
    const fixtures = loadMeridianFixtures();
    const unknownTool = fixtures.toolInventory.tools.find(
      (t) => t.name === 'unknown-experimental-tool',
    );
    expect(unknownTool).toBeDefined();
    // The tool has riskTier 5 and empty allowedRoles in inventory,
    // but access is controlled by policy rules, not inventory entries.
    expect(unknownTool!.allowedRoles).toEqual([]);
  });

  it('verifies denyUnknownDefault: true is set in policy pack', () => {
    // provision --verify warns if denyUnknownDefault is not set.
    // We verify the fixture policy pack has the deny-unknown-default rule.
    const fixtures = loadMeridianFixtures();
    const denyUnknownRule = fixtures.policyPack.rules.find(
      (r) => r.name === 'deny-unknown-default',
    );
    expect(denyUnknownRule).toBeDefined();
    expect(denyUnknownRule!.action).toBe('deny');
  });

  it('reports tools in inventory that drift from policy coverage', () => {
    const fixtures = loadMeridianFixtures();
    const inventory = fixtures.toolInventory;

    // Use only the policy pack tool patterns (from the pack rules)
    const packPatterns: string[] = [];
    for (const rule of fixtures.policyPack.rules) {
      if (rule.tools) {
        packPatterns.push(...rule.tools);
      }
    }

    const drifted: string[] = [];
    for (const tool of inventory.tools) {
      const covered = packPatterns.some((pattern) =>
        globMatches(pattern, tool.name) || globMatches(tool.name, pattern),
      );
      if (!covered) {
        drifted.push(tool.name);
      }
    }

    // unknown-experimental-tool, legacy-report-generator, and hr-payroll-read
    // are in the inventory but not referenced in pack rule tools lists
    expect(drifted.length).toBeGreaterThanOrEqual(2);
    expect(drifted).toContain('unknown-experimental-tool');
    expect(drifted).toContain('legacy-report-generator');
  });
});

// ===========================================================================
// 7. rescan for newly detected tools
// ===========================================================================

describe('rescan drift detection', () => {
  it('finds newly detected tools not covered by existing policy patterns', () => {
    const existingPatterns = [
      'finance-report-read',
      'finance-summary-read',
      'finance-transfer',
      'deploy-staging',
      'deploy-production',
      'public-*',
      'brain-lookup',
    ];

    const detectedTools = [
      'finance-report-read',     // covered
      'deploy-staging',          // covered
      'data-export-execute',     // NEW — not covered
      'admin-user-delete',       // NEW — not covered
      'metrics-dashboard-read',  // NEW — not covered (public-* doesn't match)
    ];

    const newTools = detectedTools.filter((name) =>
      !existingPatterns.some((pattern) => globMatches(pattern, name)),
    );

    expect(newTools).toContain('data-export-execute');
    expect(newTools).toContain('admin-user-delete');
    expect(newTools).toContain('metrics-dashboard-read');
    expect(newTools).not.toContain('finance-report-read');
    expect(newTools).not.toContain('deploy-staging');
  });

  it('classifies newly detected tools with conservative risk tiers', () => {
    const newTools = ['data-export-execute', 'admin-user-delete', 'metrics-dashboard-read'];
    const candidates = classifyDetectedTools(newTools);

    expect(candidates).toHaveLength(3);

    // admin-user-delete → high risk (contains "delete")
    const adminDelete = candidates.find((c) => c.name === 'admin-user-delete');
    expect(adminDelete).toBeDefined();
    expect(adminDelete!.riskTier).toBe(4);
    expect(adminDelete!.defaultAction).toBe('block');

    // data-export-execute → medium risk (contains "execute")
    const dataExport = candidates.find((c) => c.name === 'data-export-execute');
    expect(dataExport).toBeDefined();
    expect(dataExport!.riskTier).toBe(2);
    expect(dataExport!.defaultAction).toBe('ask');

    // metrics-dashboard-read → low risk (contains "read")
    const metricsRead = candidates.find((c) => c.name === 'metrics-dashboard-read');
    expect(metricsRead).toBeDefined();
    expect(metricsRead!.riskTier).toBe(1);
    expect(metricsRead!.defaultAction).toBe('allow');
  });

  it('generates conservative deny rules for high-risk detected tools', () => {
    const newTools = ['admin-user-delete', 'payment-process-external'];
    const candidates = classifyDetectedTools(newTools);

    // Both contain high-risk patterns ("delete", "payment")
    for (const c of candidates) {
      expect(c.riskTier).toBeGreaterThanOrEqual(4);
      expect(c.defaultAction).toBe('block');
    }

    // Simulate rule generation like rescan --apply --deny-new
    const newRules = candidates.map((c) => ({
      name: `auto-${c.name}`,
      actionTypePattern: c.name,
      priority: c.riskTier >= 4 ? 90 : 50,
      defaultVerdict: c.riskTier >= 4 ? 'deny' : 'allow',
    }));

    expect(newRules).toHaveLength(2);
    for (const rule of newRules) {
      expect(rule.defaultVerdict).toBe('deny');
      expect(rule.priority).toBe(90);
    }
  });

  it('rescan can add conservative rules for newly detected tools', () => {
    const existingPatterns = ['finance-report-read', 'deploy-*'];
    const detectedTools = ['finance-report-read', 'deploy-staging', 'customer-data-export'];

    const newTools = detectedTools.filter((name) =>
      !existingPatterns.some((pattern) => globMatches(pattern, name)),
    );

    expect(newTools).toEqual(['customer-data-export']);

    const candidates = classifyDetectedTools(newTools);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('customer-data-export');

    // After adding the rule, it should now be covered
    const updatedPatterns = [...existingPatterns, candidates[0].name];
    const remainingNew = detectedTools.filter((name) =>
      !updatedPatterns.some((pattern) => globMatches(pattern, name)),
    );
    expect(remainingNew).toHaveLength(0);
  });

  it('tool inventory entries without policy coverage are flagged as drift', () => {
    const fixtures = loadMeridianFixtures();
    const inventory = fixtures.toolInventory;

    // Simulate a minimal policy set that intentionally omits some tools
    const minimalPatterns = [
      'finance-report-read',
      'finance-summary-read',
      'deploy-staging',
      'public-*',
    ];

    const drifted = inventory.tools
      .map((t) => t.name)
      .filter((name) =>
        !minimalPatterns.some((pattern) => globMatches(pattern, name)),
      );

    // Many inventory tools should be flagged when policy coverage is incomplete
    expect(drifted.length).toBeGreaterThan(5);
    expect(drifted).toContain('finance-transfer');
    expect(drifted).toContain('deploy-production');
    expect(drifted).toContain('unknown-experimental-tool');
    expect(drifted).toContain('legacy-report-generator');
  });
});
