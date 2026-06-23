/**
 * Decision Runner Tests
 *
 * Tests the full pipeline: deny, approve_required, deterministic,
 * safe-block, evidence chain completeness, and audit logging.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionRunner } from './decision-runner.js';
import type { DecisionRunnerDeps } from './decision-runner.js';
import { ActionApprovalDecision } from './examples/action-approval.decision.js';
import { PolicyDecisionPoint } from '../policy/policy-decision-point.js';
import { SurfaceResolver } from '../trust/surface-resolver.js';
import { TrustPolicyLoader } from '../trust/trust-policy.js';
import { RuntimeRouteResolver } from '../routing/runtime/runtime-route-resolver.js';
import { InMemoryDecisionLogRepository } from '../persistence/memory/in-memory-decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../persistence/memory/in-memory-policy-rule.repository.js';
import { NoOpEventService } from '../adapters/event-service.js';
import { hashCanonicalJson } from '../utils/audit-hash.js';
import type { TenantId } from '../contracts/common.contracts.js';
import type { PolicyRule } from '../contracts/policy.contracts.js';
import type { RuntimeSurfaceRoute } from '../routing/types/runtime-config.js';

const TENANT_ID = 'tenant-test-001' as TenantId;

function createDenyRule(): Omit<PolicyRule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Block all actions',
    description: 'Deny rule for testing — time window impossible',
    actionTypePattern: 'workflow.*',
    riskClass: 'C',
    enforcementPoint: 'pre_decision',
    policyType: 'safety',
    priority: 100,
    timeWindowStart: '25:00',
    timeWindowEnd: '25:01',
    requiredConstraints: [],
    requireApproval: false,
    enabled: true,
    tenantId: TENANT_ID,
  };
}

function createApprovalRule(): Omit<PolicyRule, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: 'Require approval for actions',
    description: 'Approval required rule for testing',
    actionTypePattern: 'workflow.*',
    riskClass: 'B',
    enforcementPoint: 'pre_decision',
    policyType: 'business',
    priority: 50,
    requiredConstraints: [],
    requireApproval: true,
    enabled: true,
    tenantId: TENANT_ID,
  };
}

function buildRouteConfig(surfaces: RuntimeSurfaceRoute[]): string {
  const body = {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    enterpriseId: 'test',
    configHash: '',
    optimizerVersion: '1.0.0',
    surfaces,
  };
  body.configHash = hashCanonicalJson({
    version: body.version,
    enterpriseId: body.enterpriseId,
    optimizerVersion: body.optimizerVersion,
    surfaces: body.surfaces,
  });
  return JSON.stringify(body);
}

function buildDeps(overrides?: Partial<DecisionRunnerDeps>): DecisionRunnerDeps {
  const eventService = new NoOpEventService();
  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
  const trustLoader = new TrustPolicyLoader();
  const surfaceResolver = new SurfaceResolver(trustLoader);
  const routeResolver = new RuntimeRouteResolver();
  const decisionLog = new InMemoryDecisionLogRepository();

  return {
    pdp,
    surfaceResolver,
    routeResolver,
    decisionLog,
    eventService,
    ...overrides,
  };
}

describe('DecisionRunner', () => {
  let deps: DecisionRunnerDeps;
  let runner: DecisionRunner;
  let decision: ActionApprovalDecision;

  beforeEach(() => {
    deps = buildDeps();
    runner = new DecisionRunner(deps);
    decision = new ActionApprovalDecision();
    decision.withInputProvider(() => ({
      actionName: 'send_email',
      actionParams: { to: 'user@example.com' },
      requestedBy: 'agent-001',
      riskIndicators: [],
    }));
  });

  describe('Policy deny → blocked', () => {
    it('blocks the decision when policy denies', async () => {
      // Set up a deny rule
      const policyRuleRepo = new InMemoryPolicyRuleRepository();
      await policyRuleRepo.create(TENANT_ID, createDenyRule());
      const eventService = new NoOpEventService();
      const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

      const localDeps = buildDeps({ pdp, eventService });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('blocked');
      expect(result.output).toBeNull();
      expect(result.explanation).toContain('Policy denied');
      expect(result.policyVerdict?.verdict).toBe('deny');
    });
  });

  describe('Policy approve_required → approval needed', () => {
    it('pauses the decision when approval is required', async () => {
      const policyRuleRepo = new InMemoryPolicyRuleRepository();
      await policyRuleRepo.create(TENANT_ID, createApprovalRule());
      const eventService = new NoOpEventService();
      const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

      const localDeps = buildDeps({ pdp, eventService });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('approval_required');
      expect(result.output).toBeNull();
      expect(result.explanation).toContain('Approval required');
      expect(result.policyVerdict?.verdict).toBe('approve_required');
    });
  });

  describe('Deterministic route → completed without model', () => {
    it('completes without model call when route resolver is not loaded', async () => {
      // When route config is NOT loaded, the runner falls through to decision.evaluate()
      const localDeps = buildDeps();
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('completed');
      expect(result.output).not.toBeNull();
      expect(result.output!.approved).toBe(true);
      // Route resolution is null when config not loaded
      expect(result.routeResolution).toBeNull();
    });

    it('safe-blocks when deterministic route has no extractor and no gateway', async () => {
      const routeResolver = new RuntimeRouteResolver();
      routeResolver.loadConfigFromJson(buildRouteConfig([
        {
          surfaceId: 'workflow.action_approval',
          routeClass: 'deterministic_only',
          deterministicExtractorId: null,
          confidenceThreshold: 0.8,
          fallbackPattern: 'single_model',
          frontierShadow: false,
          humanReviewOnDisagreement: false,
          policyEvidenceRequired: false,
          scoreSummary: { weightedTotal: 0.9, hardBlockerCount: 0 },
        },
      ]));

      // Without a registered extractor, the route resolver returns skipModelCall=false
      // Route config is loaded so model IS required → safe-block
      const localDeps = buildDeps({ routeResolver, modelGateway: undefined });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('safe_block');
      expect(result.output).toBeNull();
    });
  });

  describe('Model-required route without gateway → safe-block', () => {
    it('safe-blocks when model is required but gateway unavailable', async () => {
      const routeResolver = new RuntimeRouteResolver();
      routeResolver.loadConfigFromJson(buildRouteConfig([
        {
          surfaceId: 'workflow.action_approval',
          routeClass: 'a5_default_with_deterministic_validator',
          deterministicExtractorId: null,
          confidenceThreshold: 0.8,
          fallbackPattern: 'single_model',
          frontierShadow: false,
          humanReviewOnDisagreement: false,
          policyEvidenceRequired: false,
          scoreSummary: { weightedTotal: 0.7, hardBlockerCount: 0 },
        },
      ]));

      const localDeps = buildDeps({ routeResolver, modelGateway: undefined });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('safe_block');
      expect(result.output).toBeNull();
      expect(result.explanation).toContain('Model gateway required but not available');
    });
  });

  describe('Evidence chain completeness', () => {
    it('every result has correlationId, tenantId, auditHash, verdict, evidence chain', async () => {
      const result = await runner.execute(TENANT_ID, decision);

      expect(result.correlationId).toBeDefined();
      expect(result.correlationId.length).toBeGreaterThan(0);
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.auditHash).toBeDefined();
      expect(result.auditHash.length).toBe(64); // SHA-256 hex
      expect(result.verdict).toBeDefined();
      expect(result.evidenceChain.recordCount).toBeGreaterThan(0);
      expect(result.evidenceChain.headHash).not.toBeNull();
    });

    it('includes timing information', async () => {
      const result = await runner.execute(TENANT_ID, decision);

      expect(result.timing.startedAt).toBeDefined();
      expect(result.timing.completedAt).toBeDefined();
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
      expect(result.timing.policyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Decision logged to DecisionLogRepository', () => {
    it('logs the decision regardless of outcome (allow)', async () => {
      const decisionLog = new InMemoryDecisionLogRepository();
      const localDeps = buildDeps({ decisionLog });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      const records = await decisionLog.findByCorrelationId(TENANT_ID, result.correlationId);
      expect(records.length).toBe(1);
      expect(records[0].status).toBe('generated');
      expect(records[0].surface).toBe('workflow.action_approval');
    });

    it('logs the decision when blocked', async () => {
      const decisionLog = new InMemoryDecisionLogRepository();
      const policyRuleRepo = new InMemoryPolicyRuleRepository();
      await policyRuleRepo.create(TENANT_ID, createDenyRule());
      const eventService = new NoOpEventService();
      const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

      const localDeps = buildDeps({ decisionLog, pdp, eventService });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      const records = await decisionLog.findByCorrelationId(TENANT_ID, result.correlationId);
      expect(records.length).toBe(1);
      expect(records[0].status).toBe('blocked');
    });

    it('logs the decision when safe-blocked', async () => {
      const decisionLog = new InMemoryDecisionLogRepository();
      const routeResolver = new RuntimeRouteResolver();
      routeResolver.loadConfigFromJson(buildRouteConfig([
        {
          surfaceId: 'workflow.action_approval',
          routeClass: 'a5_default_with_deterministic_validator',
          deterministicExtractorId: null,
          confidenceThreshold: 0.8,
          fallbackPattern: 'single_model',
          frontierShadow: false,
          humanReviewOnDisagreement: false,
          policyEvidenceRequired: false,
          scoreSummary: { weightedTotal: 0.7, hardBlockerCount: 0 },
        },
      ]));

      const localDeps = buildDeps({ decisionLog, routeResolver, modelGateway: undefined });
      const localRunner = new DecisionRunner(localDeps);

      const result = await localRunner.execute(TENANT_ID, decision);

      const records = await decisionLog.findByCorrelationId(TENANT_ID, result.correlationId);
      expect(records.length).toBe(1);
      expect(records[0].status).toBe('blocked');
    });
  });

  describe('Example decision template', () => {
    it('demonstrates the full framework with ActionApprovalDecision', async () => {
      const result = await runner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('completed');
      expect(result.output).toEqual({
        approved: true,
        reason: 'Action send_email approved with low risk',
        conditions: [],
        riskLevel: 'low',
      });
    });

    it('handles high-risk input', async () => {
      decision.withInputProvider(() => ({
        actionName: 'delete_all_data',
        actionParams: {},
        requestedBy: 'agent-rogue',
        riskIndicators: ['destructive', 'irreversible', 'no_backup'],
      }));

      const result = await runner.execute(TENANT_ID, decision);

      expect(result.verdict).toBe('completed');
      const output = result.output;
      expect(output).not.toBeNull();
      expect(output!.approved).toBe(false);
      expect(output!.riskLevel).toBe('high');
    });
  });
});
