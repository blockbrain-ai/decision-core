import type { DeterministicDecisionCandidate } from '../types/deterministic-candidate.js';

export interface ExtractorContext {
  tenantId: string;
  correlationId: string;
  surfaceId: string;
  ruleSetVersion: string;
  untrustedPayloadKeys: string[];
}

export interface DeterministicExtractor {
  readonly surfaceId: string;
  readonly extractorType: string;
  readonly ruleSetId: string;
  extract(payload: Record<string, unknown>, context: ExtractorContext): DeterministicDecisionCandidate;
}
