import type { EvidenceDelta } from '../types/comparison-result.js';

export interface EvidenceComparatorInput {
  deterministicMissingEvidence: string[];
  a5MissingEvidence: string[];
}

export function compareEvidence(input: EvidenceComparatorInput): EvidenceDelta {
  return {
    deterministicMissingEvidence: input.deterministicMissingEvidence,
    a5MissingEvidence: input.a5MissingEvidence,
    deterministicEvidenceComplete: input.deterministicMissingEvidence.length === 0,
    a5EvidenceComplete: input.a5MissingEvidence.length === 0,
  };
}
