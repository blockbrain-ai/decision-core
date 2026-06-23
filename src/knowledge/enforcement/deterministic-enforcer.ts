/**
 * Deterministic Enforcer
 *
 * Evaluates the active compiled rule set against a decision context.
 * Returns which rules passed, which blocked, and the clause evidence for each.
 * Uses only the active compiled rule set — never directly evaluates clause text.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { CompiledRuleSet } from '../../contracts/clause.contracts.js';
import type {
  CompiledRule,
  DecisionContext,
  RuleEvalResult,
  RuleType,
} from '../compiler/policy-rule-expression.types.js';
import type { CompiledRuleEvaluator } from '../compiler/compiled-rule-evaluator.js';
import type { VersionedRuleSetRepository } from '../compiler/compiled-rule-set.repository.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('deterministic-enforcer');

// ===========================================================================
// Clause Evidence
// ===========================================================================

export interface ClauseEvidence {
  clauseId: string;
  clauseText: string;
  controlId: string | null;
  ruleId: string;
  ruleType: RuleType;
  inputFields: Record<string, unknown>;
  result: 'pass' | 'fail' | 'error';
  explanation: string;
  sourceLineRef?: { file: string; startLine: number; endLine: number };
  conditionHash?: string;
  authoringSchemaVersion?: string;
  surfaceId?: string;
}

// ===========================================================================
// Enforcement Result
// ===========================================================================

export interface EnforcementResult {
  passed: boolean;
  ruleSetId: string;
  ruleSetVersion: number;
  ruleSetHash?: string;
  ruleResults: RuleEvalResult[];
  blockedBy: CompiledRule[];
  evidence: ClauseEvidence[];
}

// ===========================================================================
// Deterministic Enforcer Interface
// ===========================================================================

export interface DeterministicEnforcer {
  enforce(
    tenantId: TenantId,
    ruleSetId: string,
    context: DecisionContext,
    clauseTextLookup: (clauseId: string) => string,
  ): Promise<EnforcementResult>;

  enforceActive(
    tenantId: TenantId,
    context: DecisionContext,
    clauseTextLookup: (clauseId: string) => string,
  ): Promise<EnforcementResult | null>;
}

// ===========================================================================
// Implementation
// ===========================================================================

export interface DeterministicEnforcerDeps {
  ruleSetRepository: VersionedRuleSetRepository;
  ruleEvaluator: CompiledRuleEvaluator;
}

export function createDeterministicEnforcer(
  deps: DeterministicEnforcerDeps,
): DeterministicEnforcer {
  const { ruleSetRepository, ruleEvaluator } = deps;

  function buildEnforcementResult(
    ruleSet: CompiledRuleSet,
    rules: CompiledRule[],
    context: DecisionContext,
    clauseTextLookup: (clauseId: string) => string,
  ): EnforcementResult {
    const ruleResults = ruleEvaluator.evaluateAll(rules, context);

    const blockedBy: CompiledRule[] = [];
    const evidence: ClauseEvidence[] = [];

    for (let i = 0; i < ruleResults.length; i++) {
      const evalResult = ruleResults[i];
      const rule = rules[i];

      if (!evalResult.passed) {
        blockedBy.push(rule);
      }

      evidence.push({
        clauseId: rule.clauseId,
        clauseText: clauseTextLookup(rule.clauseId),
        controlId: rule.controlId,
        ruleId: rule.id,
        ruleType: rule.ruleType,
        inputFields: evalResult.inputFields,
        result: evalResult.result,
        conditionHash: evalResult.conditionHash,
        sourceLineRef: rule.sourceLineRef,
        authoringSchemaVersion: rule.authoringSchemaVersion,
        surfaceId: rule.surfaceId,
        explanation: evalResult.result === 'error'
          ? `Rule evaluation error: ${evalResult.errorMessage}`
          : evalResult.passed
            ? `Rule passed: ${rule.description}`
            : `Rule failed: ${rule.description}`,
      });
    }

    const passed = blockedBy.length === 0;

    logger.info(
      {
        ruleSetId: ruleSet.id,
        version: ruleSet.version,
        totalRules: rules.length,
        passed,
        blockedCount: blockedBy.length,
      },
      'Enforcement evaluation complete',
    );

    return {
      passed,
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.version,
      ruleSetHash: ruleSet.auditHash,
      ruleResults,
      blockedBy,
      evidence,
    };
  }

  return {
    async enforce(
      tenantId: TenantId,
      ruleSetId: string,
      context: DecisionContext,
      clauseTextLookup: (clauseId: string) => string,
    ): Promise<EnforcementResult> {
      const ruleSet = await ruleSetRepository.getRuleSetById(tenantId, ruleSetId);
      if (!ruleSet) {
        throw new Error(`Rule set not found: ${ruleSetId}`);
      }

      const rules = ruleSetRepository.getRulesForSet(ruleSetId);
      if (rules.length === 0) {
        logger.warn({ ruleSetId }, 'Rule set has no compiled rules');
        return {
          passed: true,
          ruleSetId: ruleSet.id,
          ruleSetVersion: ruleSet.version,
          ruleSetHash: ruleSet.auditHash,
          ruleResults: [],
          blockedBy: [],
          evidence: [],
        };
      }

      return buildEnforcementResult(ruleSet, rules, context, clauseTextLookup);
    },

    async enforceActive(
      tenantId: TenantId,
      context: DecisionContext,
      clauseTextLookup: (clauseId: string) => string,
    ): Promise<EnforcementResult | null> {
      const activeRuleSet = await ruleSetRepository.getActiveRuleSet(tenantId);
      if (!activeRuleSet) {
        logger.debug({ tenantId }, 'No active rule set — skipping enforcement');
        return null;
      }

      const rules = ruleSetRepository.getRulesForSet(activeRuleSet.id);
      if (rules.length === 0) {
        return {
          passed: true,
          ruleSetId: activeRuleSet.id,
          ruleSetVersion: activeRuleSet.version,
          ruleSetHash: activeRuleSet.auditHash,
          ruleResults: [],
          blockedBy: [],
          evidence: [],
        };
      }

      return buildEnforcementResult(activeRuleSet, rules, context, clauseTextLookup);
    },
  };
}
