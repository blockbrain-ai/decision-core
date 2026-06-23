/**
 * Clause Evidence Recorder
 *
 * Records which clauses, controls, and rules participated in each decision.
 * Extends the Phase 1 evidence chain with clause provenance: which clause text,
 * which control parameters, which compiled rule, and what input fields were evaluated.
 */

import type { ClauseEvidence, EnforcementResult } from './deterministic-enforcer.js';
import type { ProvenanceMetadata } from './provenance-metadata.js';
import type { EvidenceRecorder } from '../../decisions/evidence/evidence-recorder.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('clause-evidence-recorder');

// ===========================================================================
// Clause Provenance Record (appended to evidence chain)
// ===========================================================================

export interface ClauseProvenancePayload {
  ruleSetId: string;
  ruleSetVersion: number;
  enforcementPassed: boolean;
  totalRules: number;
  passedRules: number;
  failedRules: number;
  clauseEvidence: ClauseEvidence[];
  blockedByRuleIds: string[];
  compilerVersion?: string;
  policyFileHash?: string;
  linterStatus?: { errorCount: number; warningCount: number; lintedAt: string };
  ruleSetHash?: string;
  sourceDocumentId?: string;
}

// ===========================================================================
// Clause Evidence Recorder Interface
// ===========================================================================

export interface ClauseEvidenceRecorder {
  recordEnforcement(
    evidenceRecorder: EvidenceRecorder,
    result: EnforcementResult,
    provenanceMetadata?: ProvenanceMetadata,
  ): void;
}

// ===========================================================================
// Implementation
// ===========================================================================

export function createClauseEvidenceRecorder(): ClauseEvidenceRecorder {
  return {
    recordEnforcement(
      evidenceRecorder: EvidenceRecorder,
      result: EnforcementResult,
      provenanceMetadata?: ProvenanceMetadata,
    ): void {
      const passedRules = result.ruleResults.filter((r) => r.passed).length;
      const failedRules = result.ruleResults.filter((r) => !r.passed).length;

      const payload: ClauseProvenancePayload = {
        ruleSetId: result.ruleSetId,
        ruleSetVersion: result.ruleSetVersion,
        enforcementPassed: result.passed,
        totalRules: result.ruleResults.length,
        passedRules,
        failedRules,
        clauseEvidence: result.evidence,
        blockedByRuleIds: result.blockedBy.map((r) => r.id),
        compilerVersion: provenanceMetadata?.compilerVersion,
        policyFileHash: provenanceMetadata?.policyFileHash,
        linterStatus: provenanceMetadata?.linterStatus,
        ruleSetHash: provenanceMetadata?.ruleSetHash ?? result.ruleSetHash,
        sourceDocumentId: provenanceMetadata?.sourceDocumentId,
      };

      evidenceRecorder.append({
        operationType: 'clause_enforcement_evaluated',
        payload: payload as unknown as Record<string, unknown>,
      });

      logger.info(
        {
          ruleSetId: result.ruleSetId,
          ruleSetVersion: result.ruleSetVersion,
          passed: result.passed,
          passedRules,
          failedRules,
        },
        'Clause enforcement evidence recorded',
      );
    },
  };
}
