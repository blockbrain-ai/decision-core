/**
 * Clause Version Chain Service
 *
 * Manages hash-linked version chains for policy clauses.
 * Each clause version's chainHash includes the previous version's hash,
 * ensuring tamper-evident versioning per D3 standard.
 */

import type {
  ClauseVersionEntry,
  ClauseVersionChain,
  ChainVerificationResult,
} from '../contracts/evidence.contracts.js';
import { hashCanonicalJson, hashNormalizedText } from '../utils/audit-hash.js';

export class ClauseVersionChainService {
  private chains: Map<string, Map<string, ClauseVersionChain>> = new Map();

  private getOrCreateChain(tenantId: string, clauseId: string): ClauseVersionChain {
    let tenantChains = this.chains.get(tenantId);
    if (!tenantChains) {
      tenantChains = new Map();
      this.chains.set(tenantId, tenantChains);
    }
    let chain = tenantChains.get(clauseId);
    if (!chain) {
      chain = { clauseId, tenantId, versions: [], headHash: null };
      tenantChains.set(clauseId, chain);
    }
    return chain;
  }

  appendVersion(input: {
    clauseId: string;
    text: string;
    effectiveDate: string;
    tenantId: string;
    correlationId: string;
  }): ClauseVersionEntry {
    const chain = this.getOrCreateChain(input.tenantId, input.clauseId);
    const version = chain.versions.length + 1;
    const previousVersionHash = chain.headHash;
    const normalizedHash = hashNormalizedText(input.text);

    const chainHash = hashCanonicalJson({
      clauseId: input.clauseId,
      version,
      normalizedHash,
      previousVersionHash,
    });

    const entry: ClauseVersionEntry = {
      clauseId: input.clauseId,
      version,
      text: input.text,
      normalizedHash,
      previousVersionHash,
      chainHash,
      effectiveDate: input.effectiveDate,
      tenantId: input.tenantId,
      correlationId: input.correlationId,
    };

    chain.versions.push(entry);
    chain.headHash = chainHash;
    return entry;
  }

  getChain(tenantId: string, clauseId: string): ClauseVersionChain | null {
    const tenantChains = this.chains.get(tenantId);
    if (!tenantChains) return null;
    return tenantChains.get(clauseId) ?? null;
  }

  verify(tenantId: string, clauseId: string): ChainVerificationResult {
    const chain = this.getChain(tenantId, clauseId);
    if (!chain) {
      return {
        valid: false,
        recordCount: 0,
        brokenAt: null,
        brokenRecordId: null,
        expectedHash: null,
        actualHash: null,
        error: 'Clause version chain not found',
      };
    }
    return this.verifyChain(chain);
  }

  verifyChain(chain: ClauseVersionChain): ChainVerificationResult {
    const { versions } = chain;
    if (versions.length === 0) {
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

    for (let i = 0; i < versions.length; i++) {
      const entry = versions[i];

      // Verify previous version hash linkage
      if (entry.previousVersionHash !== expectedPreviousHash) {
        return {
          valid: false,
          recordCount: versions.length,
          brokenAt: i,
          brokenRecordId: entry.clauseId,
          expectedHash: expectedPreviousHash,
          actualHash: entry.previousVersionHash,
          error: `Clause version ${entry.version} has incorrect previousVersionHash`,
        };
      }

      // Recompute the normalized text hash
      const expectedNormalizedHash = hashNormalizedText(entry.text);
      if (entry.normalizedHash !== expectedNormalizedHash) {
        return {
          valid: false,
          recordCount: versions.length,
          brokenAt: i,
          brokenRecordId: entry.clauseId,
          expectedHash: expectedNormalizedHash,
          actualHash: entry.normalizedHash,
          error: `Clause version ${entry.version} text has been tampered with`,
        };
      }

      // Recompute the chain hash
      const expectedChainHash = hashCanonicalJson({
        clauseId: entry.clauseId,
        version: entry.version,
        normalizedHash: entry.normalizedHash,
        previousVersionHash: entry.previousVersionHash,
      });

      if (entry.chainHash !== expectedChainHash) {
        return {
          valid: false,
          recordCount: versions.length,
          brokenAt: i,
          brokenRecordId: entry.clauseId,
          expectedHash: expectedChainHash,
          actualHash: entry.chainHash,
          error: `Clause version ${entry.version} chain hash has been tampered with`,
        };
      }

      expectedPreviousHash = entry.chainHash;
    }

    return {
      valid: true,
      recordCount: versions.length,
      brokenAt: null,
      brokenRecordId: null,
      expectedHash: null,
      actualHash: null,
      error: null,
    };
  }
}
