import { describe, it, expect, beforeEach } from 'vitest';
import { ClauseVersionChainService } from './clause-version-chain.service.js';

describe('ClauseVersionChainService', () => {
  let service: ClauseVersionChainService;
  const tenantId = 'tenant-1';
  const clauseId = 'clause-001';
  const correlationId = 'corr-001';

  beforeEach(() => {
    service = new ClauseVersionChainService();
  });

  describe('appendVersion', () => {
    it('creates first version with null previousVersionHash', () => {
      const entry = service.appendVersion({
        clauseId,
        text: 'All deployments require dual authorization.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });

      expect(entry.version).toBe(1);
      expect(entry.previousVersionHash).toBeNull();
      expect(entry.chainHash).toBeDefined();
      expect(entry.normalizedHash).toBeDefined();
    });

    it('links subsequent versions', () => {
      const v1 = service.appendVersion({
        clauseId,
        text: 'All deployments require authorization.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      const v2 = service.appendVersion({
        clauseId,
        text: 'All deployments require dual authorization.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });

      expect(v2.version).toBe(2);
      expect(v2.previousVersionHash).toBe(v1.chainHash);
    });
  });

  describe('verify - valid chains', () => {
    it('verifies a single-version chain', () => {
      service.appendVersion({
        clauseId,
        text: 'Original clause text.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });

      const result = service.verify(tenantId, clauseId);
      expect(result.valid).toBe(true);
      expect(result.recordCount).toBe(1);
    });

    it('verifies a multi-version chain', () => {
      service.appendVersion({
        clauseId,
        text: 'Version 1 text.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 2 text with updates.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 3 text with further updates.',
        effectiveDate: '2025-01-01',
        tenantId,
        correlationId,
      });

      const result = service.verify(tenantId, clauseId);
      expect(result.valid).toBe(true);
      expect(result.recordCount).toBe(3);
    });
  });

  describe('tamper detection - negative controls', () => {
    it('detects tampered clause text', () => {
      service.appendVersion({
        clauseId,
        text: 'Original clause text that should not change.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 2.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });

      const chain = service.getChain(tenantId, clauseId)!;
      // Tamper with historical clause text
      chain.versions[0].text = 'Tampered clause text!';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
      expect(result.error).toContain('text has been tampered');
    });

    it('detects tampered chainHash', () => {
      service.appendVersion({
        clauseId,
        text: 'First version.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Second version.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });

      const chain = service.getChain(tenantId, clauseId)!;
      // Tamper with chain hash of first version
      chain.versions[0].chainHash = 'tampered-chain-hash';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      // Second version will fail because its previousVersionHash won't match
      expect(result.brokenAt).toBe(0);
    });

    it('detects broken version linkage', () => {
      service.appendVersion({
        clauseId,
        text: 'Version 1.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 2.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 3.',
        effectiveDate: '2025-01-01',
        tenantId,
        correlationId,
      });

      const chain = service.getChain(tenantId, clauseId)!;
      // Break version linkage
      chain.versions[2].previousVersionHash = 'wrong-previous-hash';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
      expect(result.error).toContain('incorrect previousVersionHash');
    });

    it('detects version deletion', () => {
      service.appendVersion({
        clauseId,
        text: 'Version 1.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 2.',
        effectiveDate: '2024-06-01',
        tenantId,
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Version 3.',
        effectiveDate: '2025-01-01',
        tenantId,
        correlationId,
      });

      const chain = service.getChain(tenantId, clauseId)!;
      // Delete middle version
      chain.versions.splice(1, 1);

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    it('detects tampered normalizedHash without changing text', () => {
      service.appendVersion({
        clauseId,
        text: 'Clause text.',
        effectiveDate: '2024-01-01',
        tenantId,
        correlationId,
      });

      const chain = service.getChain(tenantId, clauseId)!;
      // Tamper with normalizedHash (but leave text unchanged)
      chain.versions[0].normalizedHash = 'fake-hash';

      const result = service.verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(0);
      expect(result.error).toContain('text has been tampered');
    });
  });

  describe('multi-tenancy isolation', () => {
    it('maintains separate chains per tenant for same clauseId', () => {
      service.appendVersion({
        clauseId,
        text: 'Tenant A clause.',
        effectiveDate: '2024-01-01',
        tenantId: 'tenant-A',
        correlationId,
      });
      service.appendVersion({
        clauseId,
        text: 'Tenant B clause.',
        effectiveDate: '2024-01-01',
        tenantId: 'tenant-B',
        correlationId,
      });

      const chainA = service.getChain('tenant-A', clauseId)!;
      const chainB = service.getChain('tenant-B', clauseId)!;

      expect(chainA.versions).toHaveLength(1);
      expect(chainB.versions).toHaveLength(1);
      expect(chainA.headHash).not.toBe(chainB.headHash);
    });
  });
});
