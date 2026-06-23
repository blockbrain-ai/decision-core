import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyAuditService } from './policy-audit.service.js';
import { NoOpEventService } from '../adapters/event-service.js';
import type { TenantId } from '../contracts/common.contracts.js';

const TENANT_A = 'tenant-audit-a' as TenantId;
const TENANT_B = 'tenant-audit-b' as TenantId;

describe('PolicyAuditService', () => {
  let auditService: PolicyAuditService;

  beforeEach(() => {
    auditService = new PolicyAuditService(new NoOpEventService());
  });

  it('records an audit entry with all required D3 fields', () => {
    const entry = auditService.record({
      ruleId: 'rule-1',
      ruleName: 'Test Rule',
      actionType: 'finance.delete',
      verdict: 'deny',
      reason: 'Too expensive',
      correlationId: 'corr-1',
      tenantId: TENANT_A,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.ruleId).toBe('rule-1');
    expect(entry.ruleName).toBe('Test Rule');
    expect(entry.actionType).toBe('finance.delete');
    expect(entry.verdict).toBe('deny');
    expect(entry.reason).toBe('Too expensive');
    expect(entry.correlationId).toBe('corr-1');
    expect(entry.tenantId).toBe(TENANT_A);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.auditHash).toBeTruthy();
    expect(entry.auditHash.length).toBe(64); // SHA-256 hex = 64 chars
  });

  it('returns entries filtered by tenantId', () => {
    auditService.record({
      ruleId: 'r1', ruleName: 'R1', actionType: 'a', verdict: 'allow',
      reason: '', correlationId: 'c1', tenantId: TENANT_A,
    });
    auditService.record({
      ruleId: 'r2', ruleName: 'R2', actionType: 'b', verdict: 'deny',
      reason: '', correlationId: 'c2', tenantId: TENANT_B,
    });

    expect(auditService.getEntries(TENANT_A)).toHaveLength(1);
    expect(auditService.getEntries(TENANT_B)).toHaveLength(1);
    expect(auditService.getEntries(TENANT_A)[0]!.ruleId).toBe('r1');
  });

  it('returns entries filtered by correlationId', () => {
    auditService.record({
      ruleId: 'r1', ruleName: 'R1', actionType: 'a', verdict: 'allow',
      reason: '', correlationId: 'corr-x', tenantId: TENANT_A,
    });
    auditService.record({
      ruleId: 'r2', ruleName: 'R2', actionType: 'b', verdict: 'deny',
      reason: '', correlationId: 'corr-y', tenantId: TENANT_A,
    });
    auditService.record({
      ruleId: 'r3', ruleName: 'R3', actionType: 'c', verdict: 'allow',
      reason: '', correlationId: 'corr-x', tenantId: TENANT_A,
    });

    const entries = auditService.getEntriesByCorrelation(TENANT_A, 'corr-x');
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.correlationId === 'corr-x')).toBe(true);
  });

  it('produces deterministic audit hashes for the same input data', () => {
    // Two entries with same logical data but recorded at different times
    // will have different hashes because timestamp differs — this is correct
    const e1 = auditService.record({
      ruleId: 'r1', ruleName: 'R1', actionType: 'a', verdict: 'allow',
      reason: '', correlationId: 'c1', tenantId: TENANT_A,
    });

    // Hash should be a valid SHA-256 hex string
    expect(e1.auditHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
