/**
 * Evidence Chain Service
 *
 * Manages hash-linked evidence chains with tamper detection.
 * Each record's auditHash includes the previous record's hash,
 * creating a tamper-evident linked chain per D3 standard.
 */

import type {
  EvidenceRecord,
  EvidenceRecordCreateInput,
  EvidenceChain,
  ChainVerificationResult,
} from '../contracts/evidence.contracts.js';
import { hashCanonicalJson, hashChainEntry } from '../utils/audit-hash.js';
import { generateUuidV7 } from '../utils/uuid-v7.js';

export class EvidenceChainService {
  private chains: Map<string, Map<string, EvidenceChain>> = new Map();

  private getOrCreateChain(tenantId: string, correlationId: string): EvidenceChain {
    let tenantChains = this.chains.get(tenantId);
    if (!tenantChains) {
      tenantChains = new Map();
      this.chains.set(tenantId, tenantChains);
    }
    let chain = tenantChains.get(correlationId);
    if (!chain) {
      chain = { tenantId, correlationId, records: [], headHash: null };
      tenantChains.set(correlationId, chain);
    }
    return chain;
  }

  append(input: EvidenceRecordCreateInput): EvidenceRecord {
    const chain = this.getOrCreateChain(input.tenantId, input.correlationId);
    const sequence = chain.records.length;
    const previousHash = chain.headHash;

    const payloadHash = hashCanonicalJson(input.payload);
    const auditHash = hashChainEntry({
      sequence,
      previousHash,
      payloadHash,
      operationType: input.operationType,
      timestamp: input.timestamp,
    });

    const record: EvidenceRecord = {
      id: generateUuidV7(),
      correlationId: input.correlationId,
      timestamp: input.timestamp,
      tenantId: input.tenantId,
      auditHash,
      operationType: input.operationType,
      payload: input.payload,
      sequence,
      previousHash,
    };

    chain.records.push(record);
    chain.headHash = auditHash;
    return record;
  }

  getChain(tenantId: string, correlationId: string): EvidenceChain | null {
    const tenantChains = this.chains.get(tenantId);
    if (!tenantChains) return null;
    return tenantChains.get(correlationId) ?? null;
  }

  verify(tenantId: string, correlationId: string): ChainVerificationResult {
    const chain = this.getChain(tenantId, correlationId);
    if (!chain) {
      return {
        valid: false,
        recordCount: 0,
        brokenAt: null,
        brokenRecordId: null,
        expectedHash: null,
        actualHash: null,
        error: 'Chain not found',
      };
    }
    return this.verifyChain(chain);
  }

  verifyChain(chain: EvidenceChain): ChainVerificationResult {
    const { records } = chain;
    if (records.length === 0) {
      return {
        valid: true,
        recordCount: 0,
        brokenAt: null,
        brokenRecordId: null,
        expectedHash: null,
        actualHash: null,
        error: null,
      };
    }

    let expectedPreviousHash: string | null = null;

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Verify previousHash linkage
      if (record.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          recordCount: records.length,
          brokenAt: i,
          brokenRecordId: record.id,
          expectedHash: expectedPreviousHash,
          actualHash: record.previousHash,
          error: `Record at sequence ${i} has incorrect previousHash`,
        };
      }

      // Recompute the audit hash
      const payloadHash = hashCanonicalJson(record.payload);
      const expectedAuditHash = hashChainEntry({
        sequence: record.sequence,
        previousHash: record.previousHash,
        payloadHash,
        operationType: record.operationType,
        timestamp: record.timestamp,
      });

      if (record.auditHash !== expectedAuditHash) {
        return {
          valid: false,
          recordCount: records.length,
          brokenAt: i,
          brokenRecordId: record.id,
          expectedHash: expectedAuditHash,
          actualHash: record.auditHash,
          error: `Record at sequence ${i} has been tampered with (hash mismatch)`,
        };
      }

      expectedPreviousHash = record.auditHash;
    }

    return {
      valid: true,
      recordCount: records.length,
      brokenAt: null,
      brokenRecordId: null,
      expectedHash: null,
      actualHash: null,
      error: null,
    };
  }
}
