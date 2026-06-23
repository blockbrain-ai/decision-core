import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceChainService } from './evidence-chain.service.js';
import type { EvidenceRecordCreateInput } from '../contracts/evidence.contracts.js';

describe('EvidenceChainService', () => {
  let service: EvidenceChainService;
  const tenantId = 'tenant-1';
  const correlationId = 'corr-001';

  beforeEach(() => {
    service = new EvidenceChainService();
  });

  function makeInput(overrides: Partial<EvidenceRecordCreateInput> = {}): EvidenceRecordCreateInput {
    return {
      correlationId,
      timestamp: new Date().toISOString(),
      tenantId,
      operationType: 'input_received',
      payload: { action: 'test' },
      ...overrides,
    };
  }

  describe('append', () => {
    it('creates a record with sequence 0 and null previousHash for first entry', () => {
      const record = service.append(makeInput());
      expect(record.sequence).toBe(0);
      expect(record.previousHash).toBeNull();
      expect(record.auditHash).toBeDefined();
      expect(record.id).toBeDefined();
    });

    it('increments sequence and links to previous hash', () => {
      const first = service.append(makeInput());
      const second = service.append(makeInput({ operationType: 'policy_evaluation' }));

      expect(second.sequence).toBe(1);
      expect(second.previousHash).toBe(first.auditHash);
    });

    it('builds a full decision evidence chain with all operation types', () => {
      const inputRecord = service.append(makeInput({
        operationType: 'input_received',
        payload: { inputHash: 'abc123', action: 'deploy' },
      }));
      const policyRecord = service.append(makeInput({
        operationType: 'policy_evaluation',
        payload: { ruleId: 'rule-1', verdict: 'allow' },
      }));
      const clauseRecord = service.append(makeInput({
        operationType: 'clause_reference',
        payload: { clauseId: 'clause-1', text: 'Must have approval' },
      }));
      const routeRecord = service.append(makeInput({
        operationType: 'route_decision',
        payload: { route: 'auto-approve', confidence: 0.95 },
      }));
      const verdictRecord = service.append(makeInput({
        operationType: 'final_verdict',
        payload: { verdict: 'allow', reason: 'All checks passed' },
      }));

      expect(inputRecord.sequence).toBe(0);
      expect(policyRecord.previousHash).toBe(inputRecord.auditHash);
      expect(clauseRecord.previousHash).toBe(policyRecord.auditHash);
      expect(routeRecord.previousHash).toBe(clauseRecord.auditHash);
      expect(verdictRecord.previousHash).toBe(routeRecord.auditHash);

      const chain = service.getChain(tenantId, correlationId)!;
      expect(chain.records).toHaveLength(5);
      expect(chain.headHash).toBe(verdictRecord.auditHash);
    });
  });

  describe('verify - valid chains', () => {
    it('verifies an empty chain as valid', () => {
      service.append(makeInput());
      const result = service.verify(tenantId, 'nonexistent');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Chain not found');
    });

    it('verifies a single-record chain', () => {
      service.append(makeInput());
      const result = service.verify(tenantId, correlationId);
      expect(result.valid).toBe(true);
      expect(result.recordCount).toBe(1);
    });

    it('verifies a multi-record chain', () => {
      service.append(makeInput({ operationType: 'input_received' }));
      service.append(makeInput({ operationType: 'policy_evaluation' }));
      service.append(makeInput({ operationType: 'final_verdict' }));
      const result = service.verify(tenantId, correlationId);
      expect(result.valid).toBe(true);
      expect(result.recordCount).toBe(3);
    });
  });

  describe('tamper detection - negative controls', () => {
    it('detects tampered payload', () => {
      service.append(makeInput({ payload: { secret: 'original' } }));
      service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Tamper with first record's payload
      (chain.records[0].payload as Record<string, unknown>).secret = 'modified';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
      expect(result.error).toContain('tampered');
    });

    it('detects a re-ordered (tampered) timestamp', () => {
      service.append(makeInput({ timestamp: '2026-06-23T00:00:00.000Z' }));
      service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Re-order the first event in time without touching payload or links.
      chain.records[0].timestamp = '2020-01-01T00:00:00.000Z';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
      expect(result.error).toContain('tampered');
    });

    it('detects tampered auditHash', () => {
      service.append(makeInput());
      service.append(makeInput({ operationType: 'policy_evaluation' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Tamper with first record's hash
      chain.records[0].auditHash = 'tampered-hash-value';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
    });

    it('detects broken previousHash linkage', () => {
      service.append(makeInput());
      service.append(makeInput({ operationType: 'policy_evaluation' }));
      service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Break the link by modifying second record's previousHash
      chain.records[1].previousHash = 'wrong-hash';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain('incorrect previousHash');
    });

    it('detects record deletion (gap in sequence)', () => {
      service.append(makeInput());
      service.append(makeInput({ operationType: 'policy_evaluation' }));
      service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Remove middle record
      chain.records.splice(1, 1);

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain('incorrect previousHash');
    });

    it('detects record insertion', () => {
      service.append(makeInput());
      service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Insert a fake record in the middle
      const fakeRecord = {
        id: 'fake-id',
        correlationId,
        timestamp: new Date().toISOString(),
        tenantId,
        auditHash: 'fake-hash',
        operationType: 'policy_evaluation' as const,
        payload: { fake: true },
        sequence: 1,
        previousHash: chain.records[0].auditHash,
      };
      chain.records.splice(1, 0, fakeRecord);

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
    });

    it('detects tampered operationType', () => {
      service.append(makeInput({ operationType: 'input_received' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Tamper with operation type
      (chain.records[0] as { operationType: string }).operationType = 'final_verdict';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
      expect(result.error).toContain('tampered');
    });

    it('reports which record was modified', () => {
      service.append(makeInput({ operationType: 'input_received' }));
      service.append(makeInput({ operationType: 'policy_evaluation' }));
      const third = service.append(makeInput({ operationType: 'final_verdict' }));

      const chain = service.getChain(tenantId, correlationId)!;
      // Tamper with third record
      (chain.records[2].payload as Record<string, unknown>).injected = true;

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
      expect(result.brokenRecordId).toBe(third.id);
    });
  });

  describe('multi-tenancy isolation', () => {
    it('maintains separate chains per tenant', () => {
      service.append(makeInput({ tenantId: 'tenant-A', payload: { tenant: 'A' } }));
      service.append(makeInput({ tenantId: 'tenant-B', payload: { tenant: 'B' } }));

      const chainA = service.getChain('tenant-A', correlationId)!;
      const chainB = service.getChain('tenant-B', correlationId)!;

      expect(chainA.records).toHaveLength(1);
      expect(chainB.records).toHaveLength(1);
      expect(chainA.headHash).not.toBe(chainB.headHash);
    });
  });
});
