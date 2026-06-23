/**
 * RBAC Test Server — Org-mode HTTP server with role-scoped policy rules.
 *
 * Extends the standard org test server by replacing the default policy rules
 * with role-scoped RBAC rules and adding deny-unknown-default behaviour.
 */

import { createOrgTestServer, type OrgTestServerInstance } from './org-test-server.js';
import type { TenantId } from '../../src/contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../src/contracts/policy.contracts.js';

/**
 * Role-scoped RBAC policy rules.
 *
 * Every rule has explicit requiredRoles so the PDP differentiates
 * verdicts based on the caller's token-resolved roles.
 */
export const RBAC_RULES: PolicyRuleCreateInput[] = [
  // ---- Finance: read access for finance + finance_analyst ----
  {
    name: 'finance-report-read-allow',
    description: 'Allow finance roles to read financial reports',
    actionTypePattern: 'finance-report-read',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['finance', 'finance_analyst'],
    roleMatchMode: 'any',
    enabled: true,
  },
  {
    name: 'finance-summary-read-allow',
    description: 'Allow finance roles to read financial summaries',
    actionTypePattern: 'finance-summary-read',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['finance', 'finance_analyst'],
    roleMatchMode: 'any',
    enabled: true,
  },

  // ---- Finance: write access for finance only ----
  {
    name: 'finance-transfer-allow',
    description: 'Allow finance role to initiate transfers',
    actionTypePattern: 'finance-transfer',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['finance'],
    enabled: true,
  },
  {
    name: 'finance-budget-update-allow',
    description: 'Allow finance role to update budgets',
    actionTypePattern: 'finance-budget-update',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['finance'],
    enabled: true,
  },

  // ---- HR: read for hr/people_ops, write for people_ops only ----
  {
    name: 'hr-record-read-allow',
    description: 'Allow HR roles to read personnel records',
    actionTypePattern: 'hr-record-read',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['hr', 'people_ops'],
    roleMatchMode: 'any',
    enabled: true,
  },
  {
    name: 'hr-record-update-allow',
    description: 'Allow people_ops to update personnel records',
    actionTypePattern: 'hr-record-update',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['people_ops'],
    enabled: true,
  },

  // ---- Engineering: deploy for deployer role ----
  {
    name: 'deploy-staging-allow',
    description: 'Allow deployer role to deploy to staging',
    actionTypePattern: 'deploy-staging',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['deployer'],
    enabled: true,
  },
  {
    name: 'deploy-production-approval',
    description: 'Production deployment requires approval',
    actionTypePattern: 'deploy-production',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: true,
    requiredRoles: ['deployer'],
    enabled: true,
  },

  // ---- Executive: roleMatchMode "all" — requires executive AND approver ----
  {
    name: 'executive-approve-allow',
    description: 'Executive+approver can approve requests',
    actionTypePattern: 'approve-request',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['executive', 'approver'],
    roleMatchMode: 'all',
    enabled: true,
  },
  {
    name: 'executive-reject-allow',
    description: 'Executive+approver can reject requests',
    actionTypePattern: 'reject-request',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['executive', 'approver'],
    roleMatchMode: 'all',
    enabled: true,
  },

  // ---- Audit: roleMatchMode "all" — requires executive AND audit_admin ----
  {
    name: 'audit-review-allow',
    description: 'Executive+audit_admin can review audits',
    actionTypePattern: 'audit-review',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 100,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    requiredRoles: ['executive', 'audit_admin'],
    roleMatchMode: 'all',
    enabled: true,
  },

  // ---- Contractor deny rules (explicit per-surface-category) ----
  {
    name: 'contractor-deny-finance',
    description: 'Contractors cannot access finance operations',
    actionTypePattern: 'finance-*',
    riskClass: 'B',
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
    name: 'contractor-deny-hr',
    description: 'Contractors cannot access HR operations',
    actionTypePattern: 'hr-*',
    riskClass: 'B',
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
    name: 'contractor-deny-deploy',
    description: 'Contractors cannot trigger deployments',
    actionTypePattern: 'deploy-*',
    riskClass: 'B',
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
    name: 'contractor-deny-approval',
    description: 'Contractors cannot access approval queue',
    actionTypePattern: '*-request',
    riskClass: 'B',
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
    name: 'contractor-deny-audit',
    description: 'Contractors cannot review audits',
    actionTypePattern: 'audit-*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 200,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'deny',
    requiredRoles: ['contractor'],
    enabled: true,
  },

  // ---- Public: open to all authenticated agents ----
  {
    name: 'public-read-allow',
    description: 'All authenticated agents can read public data',
    actionTypePattern: 'public-*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 50,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    enabled: true,
  },

  // ---- Brain lookup: open to all authenticated agents ----
  {
    name: 'brain-lookup-allow',
    description: 'All authenticated agents can look up brain data',
    actionTypePattern: 'brain-lookup',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 80,
    requiredConstraints: [],
    requireApproval: false,
    defaultVerdict: 'allow',
    enabled: true,
  },
];

/**
 * Create an org-mode test server with role-scoped RBAC policy rules.
 *
 * Replaces the standard policy-pack rules with explicit RBAC rules and
 * adds deny-unknown-default: if no rules match an action the evaluator
 * returns deny instead of the PDP's default allow.
 */
export async function createRbacTestServer(): Promise<OrgTestServerInstance> {
  const server = await createOrgTestServer();
  const tenantId = server.fixtures.agents.tenantId as TenantId;

  // Clear the pack-seeded rules
  const existing = await server.policyRuleRepo.findAll(tenantId);
  for (const rule of existing) {
    await server.policyRuleRepo.delete(tenantId, rule.id);
  }

  // Seed role-scoped RBAC rules
  for (const rule of RBAC_RULES) {
    await server.policyRuleRepo.create(tenantId, rule);
  }

  // Wrap evaluator with deny-unknown-default
  const originalEvaluate = server.deps.policyEvaluator.evaluate.bind(
    server.deps.policyEvaluator,
  );
  server.deps.policyEvaluator.evaluate = async (
    tid: string,
    surfaceId: string,
    action: string,
    context?: Record<string, unknown>,
  ) => {
    const result = await originalEvaluate(tid, surfaceId, action, context);
    if (result.verdict === 'allow' && result.matchedPolicies.length === 0) {
      return {
        verdict: 'deny' as const,
        matchedPolicies: [
          {
            ruleId: 'deny-unknown',
            ruleName: 'deny-unknown-default',
            verdict: 'deny' as const,
            reason: 'No policy rules matched — denied by default',
          },
        ],
      };
    }
    return result;
  };

  return server;
}
