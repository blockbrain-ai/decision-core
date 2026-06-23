import { createLogger } from '../../utils/logger.js';
import type { GBrainStoreAdapter } from '../../adapters/gbrain/gbrain-store.js';
import type { DecisionEvidenceSink, EvaluationEvidence, ExecutionEvidence } from './decision-evidence-sink.js';

const logger = createLogger('gbrain-evidence-sink');

export class GBrainDecisionEvidenceSink implements DecisionEvidenceSink {
  readonly writtenSlugs: string[] = [];

  constructor(private readonly store: GBrainStoreAdapter) {}

  async recordEvaluation(ev: EvaluationEvidence): Promise<void> {
    const decisionId = ev.correlationId;
    try {
      const stored = await this.store.storeDecision(
        ev.tenantId,
        ev.surfaceId,
        decisionId,
        {
          surface: ev.surfaceId,
          toolName: ev.action,
          status: ev.verdict === 'allow' ? 'allowed' : ev.verdict === 'deny' ? 'denied' : 'approval-required',
          agentId: ev.agentId,
          verdict: ev.verdict,
          host: ev.host,
          evidenceType: 'policy-evaluation',
          timestamp: ev.timestamp ?? new Date().toISOString(),
        },
        {
          correlationId: ev.correlationId,
          matchedRules: ev.matchedPolicies?.map((p) => p.ruleName ?? p.ruleId ?? 'unknown') ?? [],
          matchedPolicies: ev.matchedPolicies,
        },
        [ev.agentId, ev.action, ev.host, ev.surfaceId].filter(Boolean) as string[],
      );
      this.writtenSlugs.push(stored.slug);
      logger.debug({ correlationId: ev.correlationId, verdict: ev.verdict, slug: stored.slug }, 'evaluation evidence recorded');
    } catch (err) {
      logger.error({ err, correlationId: ev.correlationId }, 'failed to record evaluation evidence');
    }
  }

  async recordExecution(ev: ExecutionEvidence): Promise<void> {
    const decisionId = `exec-${ev.correlationId}`;
    try {
      const stored = await this.store.storeDecision(
        ev.tenantId,
        ev.surfaceId,
        decisionId,
        {
          surface: ev.surfaceId,
          toolName: ev.action,
          status: 'executed',
          agentId: ev.agentId,
          host: ev.host,
          evidenceType: 'post-tool-execution',
          timingMs: ev.timingMs,
          timestamp: ev.timestamp ?? new Date().toISOString(),
        },
        {
          correlationId: ev.correlationId,
          result: ev.result,
        },
        [ev.agentId, ev.action, ev.host, ev.surfaceId].filter(Boolean) as string[],
      );
      this.writtenSlugs.push(stored.slug);
      logger.debug({ correlationId: ev.correlationId, slug: stored.slug }, 'execution evidence recorded');
    } catch (err) {
      logger.error({ err, correlationId: ev.correlationId }, 'failed to record execution evidence');
    }
  }
}
