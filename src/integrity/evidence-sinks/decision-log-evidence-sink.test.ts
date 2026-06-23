import { describe, it, expect, beforeEach } from 'vitest';
import { DecisionLogEvidenceSink } from './decision-log-evidence-sink.js';
import { InMemoryDecisionLogRepository } from '../../persistence/memory/in-memory-decision-log.repository.js';
import type { TenantId } from '../../contracts/common.contracts.js';

const TENANT = 'default' as TenantId;

describe('DecisionLogEvidenceSink', () => {
  let repo: InMemoryDecisionLogRepository;
  let sink: DecisionLogEvidenceSink;

  beforeEach(() => {
    repo = new InMemoryDecisionLogRepository();
    sink = new DecisionLogEvidenceSink(repo);
  });

  it('records execution evidence visible via the audit query, preserving timing', async () => {
    await sink.recordExecution({
      tenantId: TENANT,
      surfaceId: 'hermes',
      host: 'hermes',
      action: 'read_file',
      correlationId: 'corr-exec-1',
      result: { ok: true },
      timingMs: 37,
    });

    const records = await repo.findAll(TENANT, {});
    expect(records).toHaveLength(1);
    expect(records[0].toolName).toBe('read_file');
    expect(records[0].latency).toBe(37);
    expect(records[0].output).toMatchObject({ executed: true });
    expect(records[0].auditHash.length).toBeGreaterThan(0);
  });

  it('records a denied evaluation with blocked status', async () => {
    await sink.recordEvaluation({
      tenantId: TENANT,
      surfaceId: 'hermes',
      host: 'hermes',
      action: 'payment_send',
      verdict: 'deny',
      correlationId: 'corr-eval-1',
      matchedPolicies: [{ ruleName: 'block-payments', verdict: 'deny' }],
    });

    const records = await repo.findByCorrelationId(TENANT, 'corr-eval-1');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('blocked');
    expect(records[0].output).toMatchObject({ verdict: 'deny' });
  });

  it('records an allowed evaluation with generated status', async () => {
    await sink.recordEvaluation({
      tenantId: TENANT,
      surfaceId: 'hermes',
      host: 'hermes',
      action: 'read_file',
      verdict: 'allow',
      correlationId: 'corr-eval-2',
    });

    const records = await repo.findByCorrelationId(TENANT, 'corr-eval-2');
    expect(records[0].status).toBe('generated');
  });
});
