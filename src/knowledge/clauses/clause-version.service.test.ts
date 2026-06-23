/**
 * Tests for ClauseVersionService
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import { ClauseVersionService, tamperVersionForTest } from './clause-version.service.js';

const TENANT = 'test-tenant' as TenantId;

function makeClause(overrides?: Partial<PolicyClause>): PolicyClause {
  return {
    id: 'clause-1',
    tenantId: TENANT,
    clauseKey: 'policy/section/clause-1',
    text: 'All transactions over $10,000 must be reviewed.',
    normalizedHash: 'hash-1',
    clauseType: 'obligation',
    sectionId: 'sec-1',
    sourceDocumentId: 'doc-1',
    status: 'draft',
    effectiveDate: null,
    expiryDate: null,
    correlationId: 'corr-1',
    auditHash: 'audit-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ClauseVersionService', () => {
  let service: ClauseVersionService;

  beforeEach(() => {
    service = new ClauseVersionService();
  });

  describe('recordVersion', () => {
    it('records the first version with sequence 1', () => {
      const clause = makeClause();
      const version = service.recordVersion(TENANT, clause);

      expect(version.sequence).toBe(1);
      expect(version.previousChainHash).toBeNull();
      expect(version.chainHash).toBeTruthy();
      expect(version.textHash).toBeTruthy();
    });

    it('records subsequent versions with incrementing sequence', () => {
      const v1 = makeClause();
      const v2 = makeClause({ id: 'clause-2', text: 'Updated text for review.' });

      service.recordVersion(TENANT, v1);
      const version2 = service.recordVersion(TENANT, v2);

      expect(version2.sequence).toBe(2);
      expect(version2.previousChainHash).toBeTruthy();
    });

    it('links each version to the previous hash', () => {
      const v1 = makeClause();
      const v2 = makeClause({ id: 'clause-2', text: 'Second version text.' });

      const version1 = service.recordVersion(TENANT, v1);
      const version2 = service.recordVersion(TENANT, v2);

      expect(version2.previousChainHash).toBe(version1.chainHash);
    });
  });

  describe('getHistory', () => {
    it('returns empty array for unknown clauseKey', () => {
      const history = service.getHistory(TENANT, 'unknown-key');
      expect(history).toEqual([]);
    });

    it('returns versions ordered by sequence', () => {
      const v1 = makeClause({ text: 'Version 1' });
      const v2 = makeClause({ id: 'c2', text: 'Version 2' });
      const v3 = makeClause({ id: 'c3', text: 'Version 3' });

      service.recordVersion(TENANT, v1);
      service.recordVersion(TENANT, v2);
      service.recordVersion(TENANT, v3);

      const history = service.getHistory(TENANT, 'policy/section/clause-1');
      expect(history).toHaveLength(3);
      expect(history[0].sequence).toBe(1);
      expect(history[1].sequence).toBe(2);
      expect(history[2].sequence).toBe(3);
    });
  });

  describe('verifyChain', () => {
    it('returns valid for empty chain', () => {
      const result = service.verifyChain(TENANT, 'unknown-key');
      expect(result.valid).toBe(true);
      expect(result.chainLength).toBe(0);
    });

    it('returns valid for intact chain', () => {
      service.recordVersion(TENANT, makeClause({ text: 'V1' }));
      service.recordVersion(TENANT, makeClause({ id: 'c2', text: 'V2' }));
      service.recordVersion(TENANT, makeClause({ id: 'c3', text: 'V3' }));

      const result = service.verifyChain(TENANT, 'policy/section/clause-1');
      expect(result.valid).toBe(true);
      expect(result.chainLength).toBe(3);
    });

    it('detects tampering when a version textHash is modified', () => {
      service.recordVersion(TENANT, makeClause({ text: 'V1' }));
      service.recordVersion(TENANT, makeClause({ id: 'c2', text: 'V2' }));
      service.recordVersion(TENANT, makeClause({ id: 'c3', text: 'V3' }));

      // Tamper with version 2
      tamperVersionForTest(service, TENANT, 'policy/section/clause-1', 2);

      const result = service.verifyChain(TENANT, 'policy/section/clause-1');
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
      expect(result.reason).toContain('hash mismatch');
    });

    it('detects tampering when the first version is modified', () => {
      service.recordVersion(TENANT, makeClause({ text: 'V1' }));
      service.recordVersion(TENANT, makeClause({ id: 'c2', text: 'V2' }));

      tamperVersionForTest(service, TENANT, 'policy/section/clause-1', 1);

      const result = service.verifyChain(TENANT, 'policy/section/clause-1');
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });
  });
});
