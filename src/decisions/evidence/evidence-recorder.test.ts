import { describe, it, expect } from 'vitest';
import { EvidenceRecorder } from './evidence-recorder.js';
import { NoOpEventService } from '../../adapters/event-service.js';
import type { TenantId, CorrelationId } from '../../contracts/common.contracts.js';

const TENANT_ID = 'tenant-test' as TenantId;
const CORRELATION_ID = 'corr-test-001' as CorrelationId;

describe('EvidenceRecorder', () => {
  it('builds a chain of evidence records', () => {
    const recorder = new EvidenceRecorder(TENANT_ID, CORRELATION_ID, new NoOpEventService());

    recorder.append({ operationType: 'step_one', payload: { key: 'value1' } });
    recorder.append({ operationType: 'step_two', payload: { key: 'value2' } });
    recorder.append({ operationType: 'step_three', payload: { key: 'value3' } });

    const result = recorder.getResult();
    expect(result.records.length).toBe(3);
    expect(result.headHash).not.toBeNull();
  });

  it('each record has correct sequence and previous hash', () => {
    const recorder = new EvidenceRecorder(TENANT_ID, CORRELATION_ID, new NoOpEventService());

    recorder.append({ operationType: 'first', payload: {} });
    recorder.append({ operationType: 'second', payload: {} });

    const result = recorder.getResult();
    expect(result.records[0].sequence).toBe(0);
    expect(result.records[0].previousHash).toBeNull();
    expect(result.records[1].sequence).toBe(1);
    expect(result.records[1].previousHash).toBe(result.records[0].auditHash);
  });

  it('records carry tenantId and correlationId', () => {
    const recorder = new EvidenceRecorder(TENANT_ID, CORRELATION_ID, new NoOpEventService());
    recorder.append({ operationType: 'test', payload: { data: true } });

    const result = recorder.getResult();
    expect(result.records[0].tenantId).toBe(TENANT_ID);
    expect(result.records[0].correlationId).toBe(CORRELATION_ID);
  });

  it('headHash matches the last record auditHash', () => {
    const recorder = new EvidenceRecorder(TENANT_ID, CORRELATION_ID, new NoOpEventService());
    recorder.append({ operationType: 'a', payload: {} });
    recorder.append({ operationType: 'b', payload: {} });

    const result = recorder.getResult();
    const lastRecord = result.records[result.records.length - 1];
    expect(result.headHash).toBe(lastRecord.auditHash);
  });
});
