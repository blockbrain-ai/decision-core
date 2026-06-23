import { hashCanonicalJson } from '../../utils/audit-hash.js';
import type { DeterministicDecisionCandidate, CandidateConfidenceTier } from '../types/deterministic-candidate.js';
import type { RouteClass } from '../types/route-class.js';

export type ConfidenceTier = 'production' | 'provider' | 'deployer' | 'directional';

export interface DeterministicEvidenceBridgeInput {
  tenantId: string;
  decisionLogId: string;
  correlationId: string;
  templateId: string;
  decisionType: string;
  candidate: DeterministicDecisionCandidate;
  inputPayload: Record<string, unknown>;
}

export interface DeterministicCandidateSummary {
  candidateHash: string;
  routeClass: RouteClass;
  safeToExecuteWithoutModel: boolean;
  ruleSetId: string;
  confidenceTier: string;
}

export interface RouteEvidenceRecord {
  tenantId: string;
  decisionLogId: string;
  correlationId: string;
  templateId: string;
  decisionType: string;
  inputHash: string;
  outputHash: string | null;
  policyEvidenceHash: string | null;
  policyEvidence: {
    completeness: 'complete' | 'partial';
    missingDocumentIds: string[];
  };
  confidenceTier: ConfidenceTier;
  deterministicCandidate: DeterministicCandidateSummary;
}

const CONFIDENCE_TIER_MAP: Record<CandidateConfidenceTier, ConfidenceTier> = {
  hard_rule: 'production',
  high: 'provider',
  medium: 'deployer',
  low: 'directional',
  no_decision: 'directional',
};

export function mapCandidateToConfidenceTier(tier: CandidateConfidenceTier): ConfidenceTier {
  return CONFIDENCE_TIER_MAP[tier];
}

export function buildCandidateSummary(candidate: DeterministicDecisionCandidate): DeterministicCandidateSummary {
  return {
    candidateHash: hashCanonicalJson({
      surfaceId: candidate.surfaceId,
      decision: candidate.decision,
      confidence: candidate.confidence,
      ruleSetId: candidate.ruleSetId,
      ruleSetHash: candidate.ruleSetHash,
      rulesFired: candidate.rulesFired.map(r => r.ruleId),
    }),
    routeClass: candidate.routeClass,
    safeToExecuteWithoutModel: candidate.safeToExecuteWithoutModel,
    ruleSetId: candidate.ruleSetId,
    confidenceTier: candidate.confidenceTier,
  };
}

export function bridgeDeterministicToEvidence(input: DeterministicEvidenceBridgeInput): RouteEvidenceRecord {
  const { candidate, inputPayload } = input;
  const inputHash = hashCanonicalJson(inputPayload);
  const outputHash = candidate.decision !== null ? hashCanonicalJson({ decision: candidate.decision }) : null;

  return {
    tenantId: input.tenantId,
    decisionLogId: input.decisionLogId,
    correlationId: input.correlationId,
    templateId: input.templateId,
    decisionType: input.decisionType,
    inputHash,
    outputHash,
    policyEvidenceHash: candidate.rulesFired.length > 0
      ? hashCanonicalJson(candidate.rulesFired.flatMap(r => r.policyRefs))
      : null,
    policyEvidence: {
      completeness: candidate.missingEvidence.length === 0 ? 'complete' : 'partial',
      missingDocumentIds: candidate.missingEvidence,
    },
    confidenceTier: mapCandidateToConfidenceTier(candidate.confidenceTier),
    deterministicCandidate: buildCandidateSummary(candidate),
  };
}
