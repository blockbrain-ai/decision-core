/**
 * DecisionLog Evidence Sink
 *
 * The default evidence sink for the HTTP/MCP surfaces: it writes both
 * evaluation and execution evidence into the DecisionLogRepository — the
 * same store the `/audit` endpoint reads from. Without this, agent adapters
 * (Hermes, OpenClaw) that POST to `/record-execution` would have their audit
 * records silently discarded unless an external sink (e.g. G-Brain) was
 * configured, making `/audit` return nothing on a fresh install.
 *
 * This keeps the out-of-the-box promise true: enforce a decision, then see
 * it in the audit trail — no external dependencies required.
 */

import type {
  DecisionEvidenceSink,
  EvaluationEvidence,
  ExecutionEvidence,
} from './decision-evidence-sink.js';
import type { DecisionLogRepository } from '../../persistence/interfaces/decision-log.repository.js';
import type { DecisionRecord } from '../../contracts/decision.contracts.js';
import type { TenantId } from '../../contracts/common.contracts.js';
import { generateUuidV7 } from '../../utils/uuid-v7.js';
import { hashCanonicalJson } from '../../utils/audit-hash.js';

export class DecisionLogEvidenceSink implements DecisionEvidenceSink {
  constructor(private readonly repo: DecisionLogRepository) {}

  async recordEvaluation(evidence: EvaluationEvidence): Promise<void> {
    const now = evidence.timestamp ?? new Date().toISOString();
    const status: DecisionRecord['status'] =
      evidence.verdict === 'deny' ? 'blocked' : 'generated';
    const record: DecisionRecord = {
      id: generateUuidV7(),
      surface: evidence.surfaceId,
      toolName: evidence.action,
      status,
      confidence: 1,
      latency: 0,
      input: { context: evidence.context ?? {}, agentId: evidence.agentId },
      output: { verdict: evidence.verdict, matchedPolicies: evidence.matchedPolicies ?? [] },
      correlationId: evidence.correlationId,
      tenantId: evidence.tenantId,
      auditHash: hashCanonicalJson({
        action: evidence.action,
        verdict: evidence.verdict,
        correlationId: evidence.correlationId,
      }),
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.append(evidence.tenantId as TenantId, record);
  }

  async recordExecution(evidence: ExecutionEvidence): Promise<void> {
    const now = evidence.timestamp ?? new Date().toISOString();
    const record: DecisionRecord = {
      id: generateUuidV7(),
      surface: evidence.surfaceId,
      toolName: evidence.action,
      status: 'generated',
      confidence: 1,
      latency: evidence.timingMs ?? 0,
      input: { agentId: evidence.agentId },
      output: { result: evidence.result ?? {}, executed: true },
      correlationId: evidence.correlationId,
      tenantId: evidence.tenantId,
      auditHash: hashCanonicalJson({
        action: evidence.action,
        result: evidence.result ?? {},
        correlationId: evidence.correlationId,
      }),
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.append(evidence.tenantId as TenantId, record);
  }
}
