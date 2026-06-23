/**
 * Enforcement Flow
 *
 * Wires the full enforcement pipeline:
 *   hard-block check → deterministic enforcer → model routing (if needed) → validate → evidence recording
 *
 * The enforcement flow is invoked as a pipeline stage within the DecisionRunner.
 * When no active rule set exists, it falls through to the Phase 1 policy engine.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import type { DecisionContext } from '../compiler/policy-rule-expression.types.js';
import type { DeterministicEnforcer, EnforcementResult } from './deterministic-enforcer.js';
import type { ClauseEvidenceRecorder } from './clause-evidence-recorder.js';
import type { EvidenceRecorder } from '../../decisions/evidence/evidence-recorder.js';
import type { ClauseRepository } from '../../persistence/interfaces/clause.repository.js';
import type { ProvenanceMetadata } from './provenance-metadata.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('enforcement-flow');

// ===========================================================================
// Enforcement Flow Result
// ===========================================================================

export type EnforcementFlowOutcome = 'passed' | 'blocked' | 'skipped';

export interface EnforcementFlowResult {
  outcome: EnforcementFlowOutcome;
  enforcementResult: EnforcementResult | null;
  explanation: string;
}

// ===========================================================================
// Enforcement Flow Interface
// ===========================================================================

export interface EnforcementFlow {
  execute(
    tenantId: TenantId,
    context: DecisionContext,
    evidenceRecorder: EvidenceRecorder,
  ): Promise<EnforcementFlowResult>;
}

// ===========================================================================
// Implementation
// ===========================================================================

export interface EnforcementFlowDeps {
  enforcer: DeterministicEnforcer;
  clauseEvidenceRecorder: ClauseEvidenceRecorder;
  clauseRepository: ClauseRepository;
  provenanceMetadata?: ProvenanceMetadata;
}

export function createEnforcementFlow(deps: EnforcementFlowDeps): EnforcementFlow {
  const { enforcer, clauseEvidenceRecorder, clauseRepository, provenanceMetadata } = deps;

  // Cache clause text lookups within a single enforcement execution
  function createClauseTextLookup(clauses: Map<string, string>): (clauseId: string) => string {
    return (clauseId: string) => clauses.get(clauseId) ?? `[clause ${clauseId}]`;
  }

  return {
    async execute(
      tenantId: TenantId,
      context: DecisionContext,
      evidenceRecorder: EvidenceRecorder,
    ): Promise<EnforcementFlowResult> {
      logger.info({ tenantId }, 'Enforcement flow started');

      // Attempt enforcement with the active rule set
      // If no active rule set exists, skip — Phase 1 policy engine handles it
      const result = await enforcer.enforceActive(
        tenantId,
        context,
        // Context provider returns empty until clause identification enriches it
        () => '',
      );

      if (result === null) {
        logger.info({ tenantId }, 'No active rule set — enforcement skipped (fallback to Phase 1 policy)');
        return {
          outcome: 'skipped',
          enforcementResult: null,
          explanation: 'No active compiled rule set — enforcement delegated to Phase 1 policy engine',
        };
      }

      // Enrich with clause text: look up all referenced clause IDs
      const clauseIds = [...new Set(result.evidence.map((e) => e.clauseId))];
      const clauseTextMap = new Map<string, string>();

      for (const clauseId of clauseIds) {
        const clause: PolicyClause | null = await clauseRepository.findById(tenantId, clauseId);
        if (clause) {
          clauseTextMap.set(clauseId, clause.text);
        }
      }

      // Re-run enforcement with actual clause text for provenance
      const lookup = createClauseTextLookup(clauseTextMap);
      for (const evidence of result.evidence) {
        evidence.clauseText = lookup(evidence.clauseId);
      }

      // Record enforcement evidence in the chain
      clauseEvidenceRecorder.recordEnforcement(evidenceRecorder, result, provenanceMetadata);

      if (!result.passed) {
        const blockedDescriptions = result.blockedBy
          .map((r) => r.description)
          .join('; ');

        logger.warn(
          { tenantId, ruleSetId: result.ruleSetId, blockedCount: result.blockedBy.length },
          'Decision blocked by compiled rules',
        );

        return {
          outcome: 'blocked',
          enforcementResult: result,
          explanation: `Blocked by compiled rules: ${blockedDescriptions}`,
        };
      }

      logger.info(
        { tenantId, ruleSetId: result.ruleSetId, ruleCount: result.ruleResults.length },
        'All compiled rules passed',
      );

      return {
        outcome: 'passed',
        enforcementResult: result,
        explanation: `All ${result.ruleResults.length} compiled rules passed`,
      };
    },
  };
}
