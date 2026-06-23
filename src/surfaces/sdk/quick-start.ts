/**
 * QuickStart API — One-function setup for Decision Core
 *
 * Provides `quickStart()` for minimal config, `fromPolicyPack()` for
 * industry starters, and an enhanced `explain()` for human-readable
 * decision explanations.
 */

import type { TenantId, CorrelationId } from '../../contracts/common.contracts.js';
import type { PolicyRuleCreateInput } from '../../contracts/policy.contracts.js';
import type { DecisionRunnerResult, DecisionContext } from '../../decisions/decision-runner.js';
import type { BaseDecision } from '../../decisions/base-decision.js';
import { DecisionRunner } from '../../decisions/decision-runner.js';
import { PolicyDecisionPoint } from '../../policy/policy-decision-point.js';
import { wrapPdpDenyUnknown } from '../../policy/deny-unknown-wrapper.js';
import { contractsPackToRules } from '../../packs/pack-rule-converter.js';
import { SurfaceResolver } from '../../trust/surface-resolver.js';
import { TrustPolicyLoader } from '../../trust/trust-policy.js';
import { RuntimeRouteResolver } from '../../routing/runtime/runtime-route-resolver.js';
import type { PolicyRuleRepository } from '../../persistence/interfaces/policy-rule.repository.js';
import type { DecisionLogRepository } from '../../persistence/interfaces/decision-log.repository.js';
import { InMemoryPolicyRuleRepository } from '../../persistence/memory/in-memory-policy-rule.repository.js';
import { InMemoryDecisionLogRepository } from '../../persistence/memory/in-memory-decision-log.repository.js';
import { NoOpEventService } from '../../adapters/event-service.js';
import {
  loadBundledPack,
  AVAILABLE_PACKS,
  type AvailablePackName,
} from '../../packs/pack-loader.js';
import type {
  DecisionCoreWithExplain,
  QuickStartOptions,
  DecisionExplanation,
  DecisionCoreConfig,
} from './types.js';
import { QuickStartOptionsSchema } from './types.js';
import { SurfaceContractRegistry } from '../../knowledge/surfaces/surface-contract-registry.service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('quick-start');

// ===========================================================================
// Configuration Validation
// ===========================================================================

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly suggestions: string[],
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

function validateQuickStartOptions(options?: QuickStartOptions): QuickStartOptions {
  if (options === undefined || options === null) {
    return {};
  }

  const result = QuickStartOptionsSchema.safeParse(options);
  if (!result.success) {
    const issues = result.error.issues;
    const suggestions: string[] = [];

    for (const issue of issues) {
      const path = issue.path.join('.');
      if (path === 'profile') {
        suggestions.push(
          `Invalid profile "${(options as Record<string, unknown>).profile}". ` +
          `Available profiles: personal, team, enterprise`,
        );
      } else if (path === 'providerMode') {
        suggestions.push(
          `Invalid providerMode "${(options as Record<string, unknown>).providerMode}". ` +
          `Available modes: host, disabled, direct, local`,
        );
      } else if (path === 'storage') {
        suggestions.push(
          `Invalid storage "${(options as Record<string, unknown>).storage}". ` +
          `Available options: memory, sqlite`,
        );
      } else {
        suggestions.push(`${path}: ${issue.message}`);
      }
    }

    throw new ConfigValidationError(
      `Invalid QuickStart options: ${suggestions.join('; ')}`,
      suggestions,
    );
  }

  // Validate sqlite requires sqlitePath
  if (result.data?.storage === 'sqlite' && !result.data?.sqlitePath) {
    throw new ConfigValidationError(
      'SQLite storage requires a sqlitePath option',
      ['Provide sqlitePath: quickStart({ storage: "sqlite", sqlitePath: "./decisions.db" })'],
    );
  }

  return result.data ?? {};
}

// Pack-to-Rules conversion extracted to ../../packs/pack-rule-converter.ts

// ===========================================================================
// Profile Defaults
// ===========================================================================

function generateProfileRules(
  profile: 'personal' | 'team' | 'enterprise',
  tools?: string[],
): PolicyRuleCreateInput[] {
  const rules: PolicyRuleCreateInput[] = [];

  if (tools && tools.length > 0) {
    // Generate allow rules for declared tools
    for (const tool of tools) {
      rules.push({
        name: `allow-${tool}`,
        description: `Allow declared tool: ${tool}`,
        actionTypePattern: tool,
        riskClass: 'B',
        enforcementPoint: 'pre_decision',
        policyType: 'business',
        priority: 50,
        requireApproval: false,
        enabled: true,
      });
    }
    // Deny-unknown is handled by the PDP wrapper (denyUnknownDefault),
    // not via a catch-all rule, because deny-wins arbitration would
    // make a deny-all rule override every specific allow rule.
  }

  // Profile-specific additions
  if (profile === 'team') {
    rules.push({
      name: 'team-destructive-approval',
      description: 'Team mode: destructive operations require approval',
      actionTypePattern: 'delete_*',
      riskClass: 'B',
      enforcementPoint: 'pre_decision',
      policyType: 'safety',
      priority: 80,
      requireApproval: true,
      enabled: true,
    });
  }

  if (profile === 'enterprise') {
    rules.push(
      {
        name: 'enterprise-destructive-deny',
        description: 'Enterprise mode: destructive operations denied',
        actionTypePattern: 'delete_*',
        riskClass: 'A',
        enforcementPoint: 'pre_decision',
        policyType: 'safety',
        priority: 90,
        requireApproval: false,
        defaultVerdict: 'deny',
        enabled: true,
      },
      {
        name: 'enterprise-admin-approval',
        description: 'Enterprise mode: admin operations require approval',
        actionTypePattern: 'admin_*',
        riskClass: 'A',
        enforcementPoint: 'pre_decision',
        policyType: 'compliance',
        priority: 85,
        requireApproval: true,
        enabled: true,
      },
    );
  }

  return rules;
}

// Deny-unknown wrapper extracted to ../../policy/deny-unknown-wrapper.ts

// ===========================================================================
// Explanation Formatting
// ===========================================================================

function verdictToExplainVerdict(
  verdict: string,
): 'allow' | 'deny' | 'approve_required' {
  switch (verdict) {
    case 'completed':
      return 'allow';
    case 'blocked':
    case 'safe_block':
    case 'failed':
      return 'deny';
    case 'approval_required':
      return 'approve_required';
    default:
      return 'deny';
  }
}

function formatExplanation(
  correlationId: string,
  result: DecisionRunnerResult,
): DecisionExplanation {
  const explainVerdict = verdictToExplainVerdict(result.verdict);

  const rulesEvaluated = (result.policyVerdict?.matchedPolicies ?? []).map((mp) => ({
    ruleId: mp.ruleId,
    ruleName: mp.ruleName,
    result: mp.verdict as 'allow' | 'deny' | 'approve_required' | 'not_applicable',
    reason: mp.reason,
  }));

  const summary = buildSummary(result);
  const evidenceSummary = buildEvidenceSummary(result);

  return {
    decisionId: correlationId,
    timestamp: result.timing.startedAt,
    surface: result.routeResolution?.surfaceId ?? 'unknown',
    toolName: result.policyVerdict?.matchedPolicies?.[0]?.ruleName ?? 'unknown',
    verdict: explainVerdict,
    summary,
    rulesEvaluated,
    trustTier: result.routeResolution?.routeClass ?? 'default',
    evidenceSummary,
  };
}

function buildSummary(result: DecisionRunnerResult): string {
  const verdict = verdictToExplainVerdict(result.verdict);

  if (verdict === 'allow') {
    const ruleCount = result.policyVerdict?.matchedPolicies?.length ?? 0;
    return ruleCount > 0
      ? `Decision allowed after evaluating ${ruleCount} policy rule(s).`
      : 'Decision allowed — no policy rules matched.';
  }

  if (verdict === 'approve_required') {
    const approvalRules = result.policyVerdict?.matchedPolicies
      ?.filter((mp) => mp.verdict === 'approve_required')
      .map((mp) => mp.ruleName) ?? [];
    return `Approval required by: ${approvalRules.join(', ') || 'policy'}.`;
  }

  // deny
  const denyRules = result.policyVerdict?.matchedPolicies
    ?.filter((mp) => mp.verdict === 'deny')
    .map((mp) => mp.ruleName) ?? [];
  if (denyRules.length > 0) {
    return `Decision denied by policy rule(s): ${denyRules.join(', ')}.`;
  }
  return result.explanation;
}

function buildEvidenceSummary(result: DecisionRunnerResult): string {
  const parts: string[] = [];
  parts.push(`${result.evidenceChain.recordCount} evidence record(s) in chain`);
  parts.push(`total latency: ${result.timing.totalMs}ms`);
  if (result.timing.policyMs > 0) {
    parts.push(`policy evaluation: ${result.timing.policyMs}ms`);
  }
  if (result.evidenceChain.headHash) {
    parts.push(`head hash: ${result.evidenceChain.headHash.slice(0, 12)}...`);
  }
  return parts.join('; ');
}

// ===========================================================================
// QuickStart Factory
// ===========================================================================

export async function quickStart(options?: QuickStartOptions): Promise<DecisionCoreWithExplain> {
  const opts = validateQuickStartOptions(options);
  const profile = opts?.profile ?? 'personal';
  const tenantId = 'default' as TenantId;

  logger.info({ profile, tools: opts?.tools, agent: opts?.agent }, 'QuickStart initializing');

  // --- Persistence ---
  let policyRuleRepo: PolicyRuleRepository;
  let decisionLogRepo: DecisionLogRepository;

  if (opts?.storage === 'sqlite' && opts?.sqlitePath) {
    const { createSqliteConnection } = await import('../../persistence/sqlite/sqlite-connection.js');
    const { SqlitePolicyRuleRepository } = await import('../../persistence/sqlite/sqlite-policy-rule.repository.js');
    const { SqliteDecisionLogRepository } = await import('../../persistence/sqlite/sqlite-decision-log.repository.js');
    const db = createSqliteConnection({ path: opts.sqlitePath });
    policyRuleRepo = new SqlitePolicyRuleRepository(db);
    decisionLogRepo = new SqliteDecisionLogRepository(db);
  } else {
    policyRuleRepo = new InMemoryPolicyRuleRepository();
    decisionLogRepo = new InMemoryDecisionLogRepository();
  }

  const eventService = new NoOpEventService();

  // --- Policy Decision Point ---
  const innerPdp = new PolicyDecisionPoint(policyRuleRepo, eventService);
  // Deny-unknown: when no rules match, deny instead of allow (security-first default)
  const pdp = wrapPdpDenyUnknown(innerPdp);

  // --- Seed profile rules ---
  const rules = generateProfileRules(profile, opts?.tools);
  for (const rule of rules) {
    await policyRuleRepo.create(tenantId, rule);
  }

  // --- Trust & Routing ---
  const trustPolicyLoader = new TrustPolicyLoader();
  const surfaceResolver = new SurfaceResolver(trustPolicyLoader);
  const routeResolver = new RuntimeRouteResolver();

  // --- Decision Runner ---
  const runner = new DecisionRunner({
    pdp,
    surfaceResolver,
    routeResolver,
    decisionLog: decisionLogRepo,
    eventService,
  });

  logger.info(
    { profile, toolCount: opts?.tools?.length ?? 0, ruleCount: rules.length },
    'QuickStart instance created',
  );

  // Cache results for enhanced explain
  const resultCache = new Map<string, DecisionRunnerResult>();

  return buildEnhancedAPI(tenantId, runner, decisionLogRepo, resultCache);
}

// ===========================================================================
// fromPolicyPack Factory
// ===========================================================================

export async function fromPolicyPack(
  packName: string,
  overrides?: Partial<DecisionCoreConfig>,
): Promise<DecisionCoreWithExplain> {
  // Validate pack name
  if (!AVAILABLE_PACKS.includes(packName as AvailablePackName)) {
    throw new ConfigValidationError(
      `Unknown policy pack "${packName}"`,
      [
        `Available packs: ${AVAILABLE_PACKS.join(', ')}`,
        `Example: fromPolicyPack('${AVAILABLE_PACKS[0]}')`,
      ],
    );
  }

  const pack = loadBundledPack(packName as AvailablePackName);
  const tenantId = (overrides?.tenantId ?? 'default') as TenantId;

  logger.info({ packName, tenantId, ruleCount: pack.rules.length }, 'Loading policy pack');

  // --- Persistence ---
  const policyRuleRepo = new InMemoryPolicyRuleRepository();
  const decisionLogRepo = new InMemoryDecisionLogRepository();
  const eventService = new NoOpEventService();

  // --- Policy Decision Point ---
  const pdp = new PolicyDecisionPoint(policyRuleRepo, eventService);

  // --- Seed pack rules ---
  const policyRules = contractsPackToRules(pack);
  for (const rule of policyRules) {
    await policyRuleRepo.create(tenantId, rule);
  }

  // --- Trust & Routing ---
  const trustPolicyLoader = new TrustPolicyLoader();
  const surfaceResolver = new SurfaceResolver(trustPolicyLoader);
  const routeResolver = new RuntimeRouteResolver();

  // --- Decision Runner ---
  const runner = new DecisionRunner({
    pdp,
    surfaceResolver,
    routeResolver,
    decisionLog: decisionLogRepo,
    eventService,
  });

  logger.info(
    { packName, profile: pack.profile, seededRules: policyRules.length },
    'Policy pack instance created',
  );

  const resultCache = new Map<string, DecisionRunnerResult>();

  return buildEnhancedAPI(tenantId, runner, decisionLogRepo, resultCache);
}

// ===========================================================================
// Shared API Builder
// ===========================================================================

function buildEnhancedAPI(
  tenantId: TenantId,
  runner: DecisionRunner,
  decisionLogRepo: DecisionLogRepository,
  resultCache: Map<string, DecisionRunnerResult>,
  registry?: SurfaceContractRegistry,
): DecisionCoreWithExplain {
  return {
    tenantId,
    surfaceContractRegistry: registry ?? new SurfaceContractRegistry(),

    async evaluate<TInput, TOutput>(
      decision: BaseDecision<TInput, TOutput>,
      context?: DecisionContext,
    ): Promise<DecisionRunnerResult<TOutput>> {
      const result = await runner.execute(tenantId, decision, context);
      resultCache.set(result.correlationId, result as DecisionRunnerResult);
      return result;
    },

    async explain(decisionId: string): Promise<DecisionExplanation> {
      // Check result cache first (has full policy verdict detail)
      const cached = resultCache.get(decisionId);
      if (cached) {
        return formatExplanation(decisionId, cached);
      }

      // Fallback: reconstruct from decision log
      const records = await decisionLogRepo.findByCorrelationId(
        tenantId,
        decisionId as CorrelationId,
      );

      if (records.length === 0) {
        throw new Error(
          `No decision found for ID "${decisionId}". ` +
          'The decision may have been made by a different instance or the ID may be incorrect.',
        );
      }

      const record = records[0];
      const explainVerdict = record.status === 'generated' ? 'allow'
        : record.status === 'pending' ? 'approve_required'
          : 'deny';

      return {
        decisionId,
        timestamp: record.createdAt,
        surface: record.surface,
        toolName: record.toolName,
        verdict: explainVerdict,
        summary: `Decision ${explainVerdict === 'allow' ? 'allowed' : explainVerdict === 'deny' ? 'denied' : 'requires approval'}.`,
        rulesEvaluated: [],
        trustTier: 'default',
        evidenceSummary: `audit hash: ${record.auditHash.slice(0, 12)}...`,
      };
    },
  };
}
