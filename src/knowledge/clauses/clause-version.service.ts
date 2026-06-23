/**
 * Clause Version Service
 *
 * Tracks version history by clauseKey. Each version's hash includes
 * the previous version's hash for tamper-detectable chain integrity.
 */

import type { TenantId } from '../../contracts/common.contracts.js';
import type { PolicyClause } from '../../contracts/clause.contracts.js';
import { computeClauseHash } from './clause.entity.js';
import { hashChainEntry } from '../../utils/audit-hash.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('clause-version-service');

export interface ClauseVersion {
  clauseId: string;
  clauseKey: string;
  sequence: number;
  textHash: string;
  chainHash: string;
  previousChainHash: string | null;
  timestamp: string;
}

export interface VerificationResult {
  valid: boolean;
  chainLength: number;
  brokenAt?: number;
  reason?: string;
}

export class ClauseVersionService {
  private versionStore = new Map<string, ClauseVersion[]>();

  private getKey(tenantId: TenantId, clauseKey: string): string {
    return `${tenantId}:${clauseKey}`;
  }

  /**
   * Record a new version in the chain for a given clauseKey.
   */
  recordVersion(tenantId: TenantId, clause: PolicyClause): ClauseVersion {
    const key = this.getKey(tenantId, clause.clauseKey);
    const chain = this.versionStore.get(key) ?? [];

    const sequence = chain.length + 1;
    const previousChainHash = chain.length > 0 ? chain[chain.length - 1].chainHash : null;
    const textHash = computeClauseHash(clause.text);

    const chainHash = hashChainEntry({
      sequence,
      previousHash: previousChainHash,
      payloadHash: textHash,
      operationType: 'clause_version',
    });

    const version: ClauseVersion = {
      clauseId: clause.id,
      clauseKey: clause.clauseKey,
      sequence,
      textHash,
      chainHash,
      previousChainHash,
      timestamp: new Date().toISOString(),
    };

    chain.push(version);
    this.versionStore.set(key, chain);

    logger.info(
      { tenantId, clauseKey: clause.clauseKey, sequence },
      'Version recorded',
    );

    return version;
  }

  /**
   * Get full version history for a clauseKey, ordered by sequence.
   */
  getHistory(tenantId: TenantId, clauseKey: string): ClauseVersion[] {
    const key = this.getKey(tenantId, clauseKey);
    const chain = this.versionStore.get(key) ?? [];
    return [...chain].sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Verify the hash chain for a clauseKey.
   * Recomputes each link from stored textHash + previousChainHash and
   * compares against stored chainHash.
   */
  verifyChain(tenantId: TenantId, clauseKey: string): VerificationResult {
    const history = this.getHistory(tenantId, clauseKey);

    if (history.length === 0) {
      return { valid: true, chainLength: 0 };
    }

    for (let i = 0; i < history.length; i++) {
      const version = history[i];
      const expectedPrevious = i === 0 ? null : history[i - 1].chainHash;

      if (version.previousChainHash !== expectedPrevious) {
        logger.warn(
          { tenantId, clauseKey, sequence: version.sequence },
          'Chain broken: previous hash mismatch',
        );
        return {
          valid: false,
          chainLength: history.length,
          brokenAt: version.sequence,
          reason: `Previous hash mismatch at sequence ${version.sequence}`,
        };
      }

      const expectedChainHash = hashChainEntry({
        sequence: version.sequence,
        previousHash: version.previousChainHash,
        payloadHash: version.textHash,
        operationType: 'clause_version',
      });

      if (version.chainHash !== expectedChainHash) {
        logger.warn(
          { tenantId, clauseKey, sequence: version.sequence },
          'Chain broken: chain hash mismatch',
        );
        return {
          valid: false,
          chainLength: history.length,
          brokenAt: version.sequence,
          reason: `Chain hash mismatch at sequence ${version.sequence}`,
        };
      }
    }

    return { valid: true, chainLength: history.length };
  }
}

/**
 * Tamper with a version's textHash to simulate data corruption (test helper only).
 */
export function tamperVersionForTest(
  service: ClauseVersionService,
  tenantId: TenantId,
  clauseKey: string,
  sequence: number,
): void {
  const history = service.getHistory(tenantId, clauseKey);
  const version = history.find((v) => v.sequence === sequence);
  if (version) {
    version.textHash = 'tampered_' + version.textHash;
  }
}
