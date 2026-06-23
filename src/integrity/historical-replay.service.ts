/**
 * Historical Replay Service
 *
 * Given a decision ID, reconstructs which policy version was active
 * at decision time and replays the evidence chain with verification.
 */

import type {
  HistoricalReplayRequest,
  HistoricalReplayResult,
  PolicySnapshot,
  EvidenceChain,
} from '../contracts/evidence.contracts.js';
import type { CompiledRuleSet } from '../contracts/clause.contracts.js';
import { hashCanonicalJson } from '../utils/audit-hash.js';
import { EvidenceChainService } from './evidence-chain.service.js';

export interface DecisionRecord {
  id: string;
  tenantId: string;
  correlationId: string;
  timestamp: string;
  ruleSetId: string;
}

export interface HistoricalReplayDependencies {
  findDecision: (tenantId: string, decisionId: string) => DecisionRecord | null;
  findRuleSet: (tenantId: string, ruleSetId: string) => CompiledRuleSet | null;
}

export class HistoricalReplayService {
  constructor(
    private readonly evidenceChainService: EvidenceChainService,
    private readonly deps: HistoricalReplayDependencies,
  ) {}

  replay(request: HistoricalReplayRequest): HistoricalReplayResult {
    const decision = this.deps.findDecision(request.tenantId, request.decisionId);
    if (!decision) {
      throw new Error(`Decision not found: ${request.decisionId}`);
    }

    const ruleSet = this.deps.findRuleSet(request.tenantId, decision.ruleSetId);
    if (!ruleSet) {
      throw new Error(`Rule set not found: ${decision.ruleSetId}`);
    }

    const policySnapshot: PolicySnapshot = {
      ruleSetId: ruleSet.id,
      ruleSetVersion: ruleSet.version,
      clauseIds: ruleSet.clauseIds,
      activatedAt: ruleSet.activatedAt ?? ruleSet.compiledAt,
      snapshotHash: hashCanonicalJson({
        ruleSetId: ruleSet.id,
        version: ruleSet.version,
        clauseIds: ruleSet.clauseIds,
        activatedAt: ruleSet.activatedAt ?? ruleSet.compiledAt,
      }),
    };

    const evidenceChain: EvidenceChain = this.evidenceChainService.getChain(
      request.tenantId,
      decision.correlationId,
    ) ?? {
      tenantId: request.tenantId,
      correlationId: decision.correlationId,
      records: [],
      headHash: null,
    };

    const chainVerification = this.evidenceChainService.verifyChain(evidenceChain);

    return {
      decisionId: request.decisionId,
      tenantId: request.tenantId,
      correlationId: decision.correlationId,
      timestamp: decision.timestamp,
      policySnapshot,
      evidenceChain,
      chainVerification,
    };
  }
}
